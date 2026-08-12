/**
 * SERVIDOR — recebe webhooks do WAHA e responde via máquina de estados.
 * Configure no WAHA: webhook -> https://SEU-DOMINIO/webhook (evento "message").
 */
require('dotenv').config();
const express = require('express');
const { processar } = require('./flow');
const waha = require('./waha');

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.redirect('/orcamento')); // raiz → wizard do cliente

// ===== ÁREA INTERNA (painel + PDFs) — protegida por senha =====
// Os orçamentos têm nome, telefone e endereço de clientes: nunca deixar público.
const PAINEL_SENHA = process.env.PAINEL_SENHA || '';
function exigirSenha(req, res, next) {
  if (!PAINEL_SENHA) {
    return res.status(503).send('Painel desativado: defina PAINEL_SENHA nas variáveis de ambiente.');
  }
  const h = req.headers.authorization || '';
  const [tipo, dados] = h.split(' ');
  if (tipo === 'Basic' && dados) {
    const [, senha] = Buffer.from(dados, 'base64').toString().split(':');
    if (senha === PAINEL_SENHA) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Painel 4A"');
  return res.status(401).send('Acesso restrito.');
}

// ===== SIMULADOR LOCAL (testes sem WhatsApp) =====
// Abra /simulador — conversa com o mesmo flow.js do WhatsApp.
const path = require('path');
const orcamentosDb = require('./orcamentos');

// PDFs: SEM senha — o cliente precisa baixar o próprio orçamento na hora.
// A proteção é o nome do arquivo, que leva um token aleatório: o link só é
// conhecido por quem gerou (e pela empresa, pelo painel). Sem listagem de
// diretório, não dá pra descobrir os orçamentos dos outros.
app.use('/out', express.static(path.join(__dirname, 'out'), { index: false }));

app.get('/simulador', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'simulador.html')));

// Design system do painel (compartilhado pelas páginas internas)
app.get('/painel/ui.css', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-ui.css')));
app.get('/painel/ui.js', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-ui.js')));

// ── PAINEL ────────────────────────────────────────────────────────────
app.get('/painel', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel.html')));

app.get('/api/painel/orcamentos', exigirSenha, (req, res) => {
  const { de, ate, canal, origem, status, busca } = req.query;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let lista = orcamentosDb.listar();

  if (de) lista = lista.filter((o) => o.criadoEm >= de);
  if (ate) lista = lista.filter((o) => o.criadoEm <= ate + 'T23:59:59');
  if (canal) lista = lista.filter((o) => o.canal === canal);
  if (origem) lista = lista.filter((o) => (o.origem || 'cliente') === origem);
  if (status) lista = lista.filter((o) => o.status === status);
  if (busca) {
    const b = norm(busca);
    lista = lista.filter((o) =>
      norm(o.numero).includes(b) || norm(o.cliente?.nome).includes(b) ||
      norm(o.cliente?.telefone).includes(b) || norm(o.cliente?.cidade).includes(b));
  }
  res.json({ orcamentos: lista, estatisticas: orcamentosDb.estatisticas(lista) });
});

// ── PAINEL › CLIENTES ─────────────────────────────────────────────────
// O cadastro nasce do próprio orçamento: para orçar, o cliente informa nome,
// telefone, cidade e endereço — e isso já fica gravado aqui.
app.get('/painel/clientes', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-clientes.html')));

app.get('/api/painel/clientes', exigirSenha, (req, res) => {
  const clientesDb = require('./clientes');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const orcs = orcamentosDb.listar();

  let lista = clientesDb.listar().map((c) => {
    const meus = orcs.filter((o) => String(o.cliente?.telefone || '').replace(/\D/g, '') === c.telefone);
    const fechados = meus.filter((o) => o.status === 'fechado');
    return {
      ...c,
      orcamentosGerados: meus.length,
      valorTotal: Math.round(meus.reduce((s, o) => s + (Number(o.totalAvista) || 0), 0) * 100) / 100,
      valorFechado: Math.round(fechados.reduce((s, o) => s + (Number(o.totalAvista) || 0), 0) * 100) / 100,
      fechados: fechados.length,
      completo: clientesDb.completo(c),
      pendencias: clientesDb.pendencias(c),
    };
  });

  const { busca, situacao } = req.query;
  if (busca) {
    const b = norm(busca);
    lista = lista.filter((c) => norm(c.nome).includes(b) || norm(c.cidade).includes(b) ||
      String(c.telefone || '').includes(b.replace(/\D/g, '')) || norm(c.documento).includes(b));
  }
  if (situacao === 'incompletos') lista = lista.filter((c) => c.pendencias.length);
  if (situacao === 'compraram') lista = lista.filter((c) => c.fechados > 0);

  res.json({
    clientes: lista,
    estatisticas: {
      quantidade: lista.length,
      comCompra: lista.filter((c) => c.fechados > 0).length,
      incompletos: lista.filter((c) => c.pendencias.length).length,
      valorTotal: Math.round(lista.reduce((s, c) => s + c.valorTotal, 0) * 100) / 100,
    },
  });
});

/** Orçamentos de um cliente — abre na ficha dele. */
app.get('/api/painel/cliente/:telefone', exigirSenha, (req, res) => {
  const clientesDb = require('./clientes');
  const tel = String(req.params.telefone).replace(/\D/g, '');
  const c = clientesDb.carregar(tel);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const orcamentos = orcamentosDb.listar()
    .filter((o) => String(o.cliente?.telefone || '').replace(/\D/g, '') === tel)
    .map((o) => ({ numero: o.numero, criadoEm: o.criadoEm, status: o.status, canal: o.canal,
      origem: o.origem, totalAvista: o.totalAvista, metragemTotal: o.metragemTotal, pdf: o.pdf }));
  res.json({ cliente: { ...c, pendencias: clientesDb.pendencias(c) }, orcamentos });
});

app.post('/api/painel/cliente', exigirSenha, (req, res) => {
  try {
    const clientesDb = require('./clientes');
    const { telefone, ...dados } = req.body || {};
    if (!telefone) return res.status(400).json({ error: 'Telefone é a chave do cadastro.' });
    if (dados.nome !== undefined && !String(dados.nome).trim()) {
      return res.status(400).json({ error: 'O nome não pode ficar em branco.' });
    }
    const r = clientesDb.atualizar(telefone, dados);
    if (!r) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json({ ok: true, cliente: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PAINEL › CADASTRO DE DADOS (upload das planilhas) ─────────────────
app.get('/painel/dados', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-dados.html')));

/** Baixa o modelo de planilha (em branco ou com o que já está cadastrado). */
app.get('/api/painel/modelo/:qual', exigirSenha, (req, res) => {
  const mapa = { produtos: '1-produtos.csv', fretes: '2-fretes.csv', unidades: '3-unidades.csv' };
  const arq = mapa[req.params.qual];
  if (!arq) return res.status(404).send('Modelo não encontrado.');
  res.download(path.join(__dirname, 'planilhas', arq));
});

/** Valida os CSVs enviados. Só grava quando "aplicar" vem true. */
app.post('/api/painel/importar', exigirSenha, async (req, res) => {
  try {
    const { produtosCsv, fretesCsv, unidadesCsv, aplicar: confirmar } = req.body || {};
    if (!produtosCsv && !fretesCsv && !unidadesCsv) {
      return res.status(400).json({ error: 'Envie ao menos uma planilha.' });
    }
    const { processar, aplicar: montar } = require('./importador');
    const arquivoCat = path.join(__dirname, 'catalogo.json');
    const catalogo = JSON.parse(require('fs').readFileSync(arquivoCat, 'utf8'));

    const r = processar({ produtosCsv, fretesCsv, unidadesCsv }, catalogo);

    if (confirmar && r.ok) {
      // guarda uma cópia antes de sobrescrever — dá pra voltar atrás
      const backup = path.join(__dirname, 'catalogo.backup.json');
      require('fs').writeFileSync(backup, JSON.stringify(catalogo, null, 2));
      require('fs').writeFileSync(arquivoCat, JSON.stringify(montar(catalogo, r), null, 2));
      limparCacheCatalogo();
      console.log(`[PAINEL] Catálogo atualizado: ${r.resumo.produtos} produtos, ${r.resumo.faixasFrete} faixas de frete`);
      return res.json({ ...r, aplicado: true });
    }
    res.json({ ...r, aplicado: false });
  } catch (e) {
    console.error('Erro /api/painel/importar:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PAINEL › CADASTRO DE PRODUTOS (formulário) ────────────────────────
const fsp = require('fs');
const ARQ_CAT = path.join(__dirname, 'catalogo.json');
const lerCat = () => JSON.parse(fsp.readFileSync(ARQ_CAT, 'utf8'));
const gravarCat = (c) => {
  fsp.writeFileSync(path.join(__dirname, 'catalogo.backup.json'), fsp.readFileSync(ARQ_CAT));
  fsp.writeFileSync(ARQ_CAT, JSON.stringify(c, null, 2));
  limparCacheCatalogo();
};

app.get('/painel/produtos', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-produtos.html')));

app.get('/api/painel/produtos', exigirSenha, (_req, res) => {
  const c = lerCat();
  res.json({
    produtos: c.telhas || [],
    familias: [...new Set((c.telhas || []).map((t) => t.familia))],
    complementos: c.complementos || [],
    perfis: c.perfis || [],
  });
});

/**
 * CONFERÊNCIA DO CADASTRO — o que está faltando ou desvinculado.
 * "problemas" travam ou distorcem orçamento; "alertas" são para olhar depois.
 */
app.get('/api/painel/diagnostico', exigirSenha, (_req, res) => {
  const { validarCatalogo } = require('./pricing');
  const r = validarCatalogo(lerCat());
  res.json({ problemas: r.problemas || [], alertas: r.alertas || [] });
});

/** Cadastro de perfis de estrutura (terças, vigas). */
app.post('/api/painel/perfil', exigirSenha, (req, res) => {
  try {
    const p = req.body || {};
    if (!p.nome) return res.status(400).json({ error: 'Informe o nome do perfil.' });
    if (!(Number(p.preco) > 0)) return res.status(400).json({ error: 'Informe o preço por metro.' });
    if (!(Number(p.vao_maximo_m) > 0)) return res.status(400).json({ error: 'Informe o vão máximo — é ele que define quantas terças o telhado precisa.' });

    const c = lerCat();
    c.perfis = c.perfis || [];
    const id = p.id || 'PF-' + Date.now().toString(36).toUpperCase();
    const registro = {
      id, codigo: p.codigo || null, gc_id: null,
      tipo: p.tipo || 'terca',
      nome: p.nome,
      unidade: 'M',
      preco: Number(p.preco),
      barra_m: Number(p.barra_m) || 6,
      vao_maximo_m: Number(p.vao_maximo_m),
      peso_kg_m: Number(p.peso_kg_m) || null,
      ativo: p.ativo !== false,
    };
    const i = c.perfis.findIndex((x) => x.id === id);
    if (i >= 0) c.perfis[i] = { ...c.perfis[i], ...registro, _confirmar: false };
    else c.perfis.push(registro);
    gravarCat(c);
    res.json({ ok: true, perfil: registro });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/painel/perfil/:id', exigirSenha, (req, res) => {
  try {
    const c = lerCat();
    const antes = (c.perfis || []).length;
    c.perfis = (c.perfis || []).filter((x) => x.id !== req.params.id);
    if (c.perfis.length === antes) return res.status(404).json({ error: 'Perfil não encontrado.' });
    gravarCat(c);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Cadastro de complementos — acabamentos e fixação.
 * Os dois vínculos que fazem o cálculo automático funcionar:
 *   acabamento → aplica_em (cumeeira, frontal, lateral, interno)
 *   fixação    → consumo_por_m2
 * Sem eles o item existe, mas nunca entra sozinho num orçamento.
 */
app.post('/api/painel/complemento', exigirSenha, (req, res) => {
  try {
    const p = req.body || {};
    if (!p.nome) return res.status(400).json({ error: 'Informe o nome do complemento.' });
    if (!(Number(p.preco) > 0)) return res.status(400).json({ error: 'Informe o preço.' });

    const tipo = p.tipo === 'fixacao' ? 'fixacao' : 'acabamento';
    const vendaPor = ['metro', 'barra', 'unidade'].includes(p.venda_por) ? p.venda_por : 'unidade';

    if (tipo === 'acabamento' && !p.aplica_em) {
      return res.status(400).json({ error: 'Escolha onde o acabamento se aplica (cumeeira, frontal, lateral ou interno) — é isso que faz o sistema calcular a quantidade sozinho.' });
    }
    if (tipo === 'fixacao' && !(Number(p.consumo_por_m2) > 0)) {
      return res.status(400).json({ error: 'Informe o consumo por m² — é o que define quantas peças entram no orçamento.' });
    }
    if (vendaPor === 'barra' && !(Number(p.comprimento_barra_m) > 0)) {
      return res.status(400).json({ error: 'Vendido por barra: informe o tamanho da barra em metros.' });
    }

    const c = lerCat();
    c.complementos = c.complementos || [];
    const id = p.id || (p.codigo ? 'C' + String(p.codigo).toUpperCase().replace(/[^A-Z0-9]/g, '') : 'C' + Date.now().toString(36).toUpperCase());

    const registro = {
      id,
      codigo: p.codigo || null,
      gc_id: p.gc_id || null,
      tipo,
      nome: p.nome,
      unidade: p.unidade || (vendaPor === 'metro' ? 'M' : vendaPor === 'barra' ? 'PC' : 'UN'),
      preco: Number(p.preco),
      venda_por: vendaPor,
      comprimento_barra_m: vendaPor === 'barra' ? Number(p.comprimento_barra_m) : null,
      aplica_em: tipo === 'acabamento' ? p.aplica_em : null,
      rendimento_m: Number(p.rendimento_m) > 0 ? Number(p.rendimento_m) : null,
      consumo_por_m2: tipo === 'fixacao' ? Number(p.consumo_por_m2) : null,
      imagem: p.imagem || null,
      observacao: p.observacao || null,
      ativo: p.ativo !== false,
    };

    const i = c.complementos.findIndex((x) => x.id === id);
    if (i >= 0) c.complementos[i] = { ...c.complementos[i], ...registro };
    else c.complementos.push(registro);

    gravarCat(c);
    res.json({ ok: true, complemento: registro });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/painel/complemento/:id', exigirSenha, (req, res) => {
  try {
    const c = lerCat();
    const antes = (c.complementos || []).length;
    c.complementos = (c.complementos || []).filter((x) => x.id !== req.params.id);
    if (c.complementos.length === antes) return res.status(404).json({ error: 'Complemento não encontrado.' });
    gravarCat(c);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Sugere os campos a partir da descrição do ERP (o usuário confirma). */
app.post('/api/painel/desmembrar', exigirSenha, (req, res) => {
  const { desmembrar } = require('./parser-produto');
  res.json(desmembrar(req.body?.descricao || ''));
});

app.post('/api/painel/produto', exigirSenha, (req, res) => {
  try {
    const p = req.body || {};
    if (!p.nome) return res.status(400).json({ error: 'Informe o nome do produto.' });
    if (!(Number(p.largura_util_m) > 0)) return res.status(400).json({ error: 'Largura útil é obrigatória — sem ela não dá pra calcular a quantidade de peças.' });
    if (!(Number(p.comprimento_maximo_m) > 0)) return res.status(400).json({ error: 'Informe o comprimento máximo de fabricação.' });

    if (Number(p.largura_total_m) > 0 && Number(p.largura_util_m) >= Number(p.largura_total_m)) {
      return res.status(400).json({ error: 'A largura útil precisa ser menor que a largura total.' });
    }

    const faixas = (p.faixas_preco || [])
      .map((f) => ({ ate_m2: f.ate_m2 === '' || f.ate_m2 == null ? null : Number(f.ate_m2), preco: Number(f.preco) }))
      .filter((f) => Number.isFinite(f.preco) && f.preco > 0);
    if (!faixas.length) return res.status(400).json({ error: 'Informe ao menos um preço.' });

    const c = lerCat();
    c.telhas = c.telhas || [];
    const id = p.id || (p.codigo ? 'P' + String(p.codigo).toUpperCase().replace(/[^A-Z0-9]/g, '') : 'P' + Date.now().toString(36).toUpperCase());

    const registro = {
      id,
      codigo: p.codigo || null,
      gc_id: p.gc_id || null,
      familia: p.familia || 'Outros',
      nome: p.nome,
      descricao_completa: p.descricao_completa || null,
      atributos: p.atributos || {},
      unidade: 'M²',
      preco: faixas[0].preco,          // compatibilidade / preço de referência
      faixas_preco: faixas,
      largura_util_m: Number(p.largura_util_m),
      largura_total_m: Number(p.largura_total_m) || null,
      comprimento_maximo_m: Number(p.comprimento_maximo_m),
      comprimento_minimo_m: Number(p.comprimento_minimo_m) || 0.5,
      transpasse_m: Number(p.transpasse_m) || null,
      comprimentos_padrao: null,   // não existe tamanho padrão: corte é livre
      promocao_ate_m: Number(p.promocao_ate_m) || null,
      vao_maximo_m: Number(p.vao_maximo_m) || 1.8,
      inclinacao_minima_pct: Number(p.inclinacao_minima_pct) || 10,
      forro_integrado: !!p.forro_integrado,
      imagem: p.imagem || null,
      ativo: p.ativo !== false,
      observacao: p.observacao || null,
    };

    const i = c.telhas.findIndex((t) => t.id === id);
    if (i >= 0) c.telhas[i] = { ...c.telhas[i], ...registro };
    else c.telhas.push(registro);

    gravarCat(c);
    res.json({ ok: true, produto: registro });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/painel/produto/:id', exigirSenha, (req, res) => {
  try {
    const c = lerCat();
    const antes = (c.telhas || []).length;
    c.telhas = (c.telhas || []).filter((t) => t.id !== req.params.id);
    if (c.telhas.length === antes) return res.status(404).json({ error: 'Produto não encontrado.' });
    gravarCat(c);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/painel/status', exigirSenha, (req, res) => {
  const { numero, status, nota } = req.body || {};
  const r = orcamentosDb.atualizarStatus(numero, status, nota);
  if (!r) return res.status(400).json({ error: 'Orçamento ou status inválido.' });
  res.json({ ok: true, orcamento: r });
});

// ===== ORÇAMENTO SELF-SERVICE (wizard web) =====
// Mesmo catálogo + mesmo motor determinístico do WhatsApp, em formato de "slides".
const { getCatalogo, limparCache: limparCacheCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { calcularRomaneio, opcoesDeCorte, corteComTamanho } = require('./romaneio');
const { gerarPDF } = require('./pdf');

app.get('/orcamento', (_req, res) => res.sendFile(path.join(__dirname, 'orcamento.html')));
// canal experimental com visualização 3D — não substitui o wizard simples
app.get('/orcamento3d', (_req, res) => res.sendFile(path.join(__dirname, 'orcamento3d.html')));

app.get('/api/catalogo', async (_req, res) => {
  try {
    const c = await getCatalogo();
    res.json({
      empresa: { razao_social: c.empresa.razao_social, site: c.empresa.site },
      ilustracoes: c.ilustracoes || {},
      telhas: c.telhas.filter((t) => t.ativo !== false).map((t) => ({
        id: t.id, codigo: t.codigo || null, familia: t.familia, nome: t.nome,
        preco: t.preco, faixas_preco: t.faixas_preco || null,
        imagem: t.imagem || null, atributos: t.atributos || {},
        largura_util_m: t.largura_util_m,
        comprimento_maximo_m: t.comprimento_maximo_m,
        comprimento_minimo_m: t.comprimento_minimo_m,
        promocao_ate_m: t.promocao_ate_m || null,
        forro_integrado: t.forro_integrado,
      })),
      regras: {
        faixa_preco_por: c.regras?.faixa_preco_por || 'produto',
        faixa_tolerancia_pct: c.regras?.faixa_tolerancia_pct || 0,
      },
      complementos: (c.complementos || []).filter((x) => x.ativo !== false).map((x) => ({
        id: x.id, codigo: x.codigo, nome: x.nome, familia: x.familia, tipo: x.tipo,
        preco: x.preco, venda_por: x.venda_por, comprimento_barra_m: x.comprimento_barra_m || null,
        consumo_por_m2: x.consumo_por_m2 || null, aplica_em: x.aplica_em || null, imagem: x.imagem || null,
      })),
      perfis: (c.perfis || []).map((p) => ({
        id: p.id, nome: p.nome, tipo: p.tipo, preco: p.preco,
        unidade: p.unidade, barra_m: p.barra_m || null,
      })),
      temEstrutura: (c.perfis || []).some((p) => p.tipo === 'terca'),
      engenharia: {
        comprimento_minimo_fabricacao_m: c.engenharia.comprimento_minimo_fabricacao_m,
        comprimento_maximo_fabricacao_m: c.engenharia.comprimento_maximo_fabricacao_m,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Prévia do romaneio: ambiente → lista de cortes (sem gerar PDF) */
app.post('/api/romaneio', async (req, res) => {
  try {
    const { telhaId, comprimentoGalpaoM, larguraGalpaoM, quedas, comEstrutura, opcaoCorte, tamanhoPreferidoM } = req.body || {};
    const catalogo = await getCatalogo();
    const telha = catalogo.telhas.find((t) => t.id === telhaId);
    if (!telha) return res.status(400).json({ error: 'Telha inválida.' });
    const rom = calcularRomaneio(
      { comprimentoGalpaoM, larguraGalpaoM, quedas, comEstrutura, opcaoCorte, tamanhoPreferidoM }, telha, catalogo
    );
    res.json(rom);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/**
 * Sugestões para quem trouxe a LISTA DE CORTES pronta: informando o comprimento
 * do galpão e as quedas, calculamos acabamentos (perímetro) e estrutura.
 */
app.post('/api/sugestoes', async (req, res) => {
  try {
    const { telhaIds, comprimentoGalpaoM, quedas, maiorCorteM, comEstrutura } = req.body || {};
    const catalogo = await getCatalogo();
    const telhas = (telhaIds || []).map((id) => catalogo.telhas.find((t) => t.id === id)).filter(Boolean);
    if (!telhas.length) return res.status(400).json({ error: 'Informe ao menos um produto.' });
    const L = Number(comprimentoGalpaoM);
    const maior = Number(maiorCorteM);
    if (!(L > 0)) return res.status(400).json({ error: 'Informe o comprimento do galpão.' });

    const { complementosPorPerimetro, calcularEstruturaPerfis } = require('./romaneio');
    const { complementos, perimetro } = complementosPorPerimetro(L, maior, quedas, catalogo);
    const estrutura = comEstrutura
      ? calcularEstruturaPerfis(maior, L, telhas, catalogo)
      : { perfis: [], descricao: null };

    res.json({ complementos, perimetro, perfis: estrutura.perfis, estruturaDescricao: estrutura.descricao });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/** Opções de divisão para um comprimento maior que o máximo de fábrica.
 *  Se vier "tamanhoPreferidoM", devolve também a divisão nesse tamanho. */
app.post('/api/opcoes-corte', async (req, res) => {
  try {
    const { telhaId, comprimentoM, tamanhoPreferidoM } = req.body || {};
    const catalogo = await getCatalogo();
    const telha = catalogo.telhas.find((t) => t.id === telhaId);
    if (!telha) return res.status(400).json({ error: 'Telha inválida.' });
    const comp = Number(comprimentoM);
    if (!Number.isFinite(comp) || comp <= 0) return res.status(400).json({ error: 'Comprimento inválido.' });

    const opcoes = opcoesDeCorte(comp, telha, catalogo);
    let personalizada = null;
    if (tamanhoPreferidoM) {
      personalizada = corteComTamanho(comp, tamanhoPreferidoM, telha, catalogo);
    }
    res.json({ opcoes, personalizada, maximoM: telha.comprimento_maximo_m });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/** CEP → cidade/UF. A distância até a unidade sai daqui. */
app.get('/api/cep/:cep', async (req, res) => {
  try {
    const { cidadeDoCep } = require('./distancia');
    const info = await cidadeDoCep(req.params.cep);
    if (!info) return res.status(404).json({ error: 'CEP não encontrado.' });
    res.json(info);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Erro de preenchimento (vira 400 e a mensagem vai para a tela do cliente). */
function erroCliente(msg) { const e = new Error(msg); e.publico = true; return e; }

/**
 * TRADUZ O QUE VEIO DA TELA para o formato do motor.
 * Fonte única: usada pelo /api/orcamento (que gera o PDF) e pelo /api/lista
 * (que mostra a lista sem preço para o cliente conferir). Assim a tela de
 * conferência mostra exatamente o que vai ser cobrado.
 */
function montarPedido(pedido, catalogo) {
  let grupos = [], complementos = [], perfis = [];

  if (pedido?.modo === 'auto') {
    // O cliente só deu as medidas: o sistema monta a lista inteira.
    const telha = catalogo.telhas.find((t) => t.id === pedido.telhaId);
    if (!telha) throw erroCliente('Telha inválida.');

    const rom = calcularRomaneio({
      comprimentoGalpaoM: pedido.comprimentoGalpaoM,
      larguraGalpaoM: pedido.larguraGalpaoM,
      quedas: pedido.quedas,
      comEstrutura: !!pedido.querEstrutura,
      // emenda escolhida pelo cliente quando a água passa do máximo de fábrica
      opcaoCorte: pedido.opcaoCorte || null,
      tamanhoPreferidoM: pedido.tamanhoPreferidoM || null,
    }, telha, catalogo);

    grupos = [{ telhaId: telha.id, nome: telha.nome, cortes: rom.cortes,
      ambiente: { comprimentoGalpaoM: pedido.comprimentoGalpaoM, larguraGalpaoM: pedido.larguraGalpaoM, quedas: pedido.quedas } }];

    // O cliente escolheu item a item na tela (tudo vem marcado por padrão).
    // Sem lista? Cai no comportamento antigo (querAcabamento/querEstrutura).
    const idsComp = Array.isArray(pedido.complementosIds) ? pedido.complementosIds : null;
    const idsPerf = Array.isArray(pedido.perfisIds) ? pedido.perfisIds : null;

    const querComp = idsComp || (pedido.querAcabamento
      ? (catalogo.complementos || []).filter((c) => c.ativo !== false).map((c) => c.id) : []);

    for (const id of querComp) {
      const item = (catalogo.complementos || []).find((c) => c.id === id);
      if (!item) continue;
      const sug = (rom.complementos || []).find((c) => c.produtoId === id);
      if (sug) complementos.push({ produtoId: id, metros: sug.metros });      // pelo perímetro
      else if (item.consumo_por_m2) complementos.push({ produtoId: id });     // por m²
    }

    const querPerf = idsPerf || (pedido.querEstrutura && pedido.perfilId ? [pedido.perfilId] : []);
    if (querPerf.length) {
      const { calcularEstruturaPerfis } = require('./romaneio');
      const maior = Math.max(...rom.cortes.map((c) => c.comprimentoM));
      for (const id of querPerf) {
        const est = calcularEstruturaPerfis(maior, pedido.comprimentoGalpaoM, [telha], catalogo, id);
        perfis.push(...(est.perfis || []));
      }
    }

  } else if (pedido?.modo === 'itens') {
    // O cliente já sabe o que quer (ou conferiu e ajustou a lista):
    // cada item vem com a quantidade final. Mesma conversão do WhatsApp.
    const { aplicarLista } = require('./lista');
    const r = aplicarLista(
      (pedido.itens || []).map((it) => ({ id: it.id, qtd: it.qtd, comp: it.comp })),
      catalogo, pedido.ambiente || null
    );
    grupos = r.grupos; complementos = r.complementos; perfis = r.perfis;

  } else {
    // formato antigo (grupos prontos)
    grupos = Array.isArray(pedido?.grupos) && pedido.grupos.length
      ? pedido.grupos : [{ telhaId: pedido?.telhaId, cortes: pedido?.cortes }];
    complementos = pedido?.complementos || [];
    perfis = pedido?.perfis || [];
  }

  // Telha NÃO é obrigatória — dá pra orçar só acabamento, parafuso ou
  // estrutura. Obrigatório é ter pelo menos um item de qualquer tipo.
  if (!grupos.length && !complementos.length && !perfis.length) {
    throw erroCliente('Coloque ao menos um produto com quantidade.');
  }
  if (grupos.some((g) => !catalogo.telhas.some((t) => t.id === g.telhaId))) {
    throw erroCliente('Produto inválido.');
  }
  return { grupos, complementos, perfis };
}

/**
 * LISTA PARA CONFERÊNCIA — o que o cliente vai levar, SEM PREÇO.
 * Serve aos dois caminhos: devolve linhas editáveis (quantidade, tamanho) que
 * voltam para o /api/orcamento em modo "itens". Não mexeu em nada? O total é
 * exatamente o mesmo, porque a regra de quantidade é a mesma dos dois lados.
 */
app.post('/api/lista', async (req, res) => {
  try {
    const { montarLista } = require('./lista');
    const catalogo = await getCatalogo();
    const pedidoMotor = montarPedido(req.body?.pedido, catalogo);
    res.json(montarLista(pedidoMotor, catalogo));
  } catch (e) {
    res.status(e.publico ? 400 : 500).json({ error: e.message });
  }
});

app.post('/api/orcamento', async (req, res) => {
  try {
    const { pedido, cliente } = req.body || {};
    // REGRA: sem endereço não existe orçamento (entrega/frete dependem dele)
    if (!cliente?.nome || !cliente?.cidade || !cliente?.endereco || !/\d/.test(cliente.endereco)) {
      return res.status(400).json({ error: 'Nome, cidade e endereço completo (rua, número e bairro) são obrigatórios.' });
    }
    if (!cliente?.telefone || String(cliente.telefone).replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Informe um telefone/WhatsApp válido com DDD.' });
    }
    const catalogo = await getCatalogo();

    // ── Traduz o que veio da tela para o formato do motor ─────────────
    const { grupos, complementos, perfis } = montarPedido(pedido, catalogo);

    // frete é cobrado À PARTE: calculado aqui e somado como linha própria
    const { calcularFrete } = require('./frete');
    const previa = calcularOrcamento({ grupos, perfis, complementos }, catalogo);
    const frete = await calcularFrete(
      { cep: cliente.cep, cidade: cliente.cidade, uf: cliente.estado },
      {
        metragemTotal: previa.metragemTotal,
        totalProdutos: previa.totalProdutos,
        codigos: grupos.map((g) => catalogo.telhas.find((t) => t.id === g.telhaId)?.codigo).filter(Boolean),
      },
      catalogo
    );
    const orcamento = calcularOrcamento({ grupos, perfis, complementos, frete }, catalogo);

    // ── QUANDO O VALOR NÃO É MOSTRADO AO CLIENTE ──────────────────────
    // Obra além do raio da fábrica OU pedido grande: o orçamento é gerado
    // e fica no painel, mas o cliente é direcionado ao comercial.
    const limiteM2 = catalogo.regras?.metragem_maxima_autoatendimento_m || Infinity;
    const grande = orcamento.metragemTotal > limiteM2;
    const encaminhar = frete.foraDoRaio || grande;

    const numero = (encaminhar ? 'PROP-' : 'WEB-') + Date.now().toString(36).toUpperCase();
    // token aleatório no nome: deixa o link do PDF impossível de adivinhar
    const token = require('crypto').randomBytes(8).toString('hex');
    const pdfPath = path.join(__dirname, 'out', `orcamento-${numero}-${token}.pdf`);
    await gerarPDF({
      cliente,
      pedido: { numero, vendedor: catalogo.empresa.vendedor_padrao },
      orcamento, catalogo,
    }, pdfPath);

    // grava o cadastro (mesma base do WhatsApp — chave é o telefone)
    require('./clientes').salvar(cliente);

    // registra no histórico para o painel (com o motivo, quando encaminhado)
    orcamentosDb.salvar({
      numero, canal: 'web',
      origem: req.body?.vendedor ? 'vendedor' : 'cliente',
      vendedor: req.body?.vendedor || null,
      cliente,
      orcamento: {
        ...orcamento,
        escalarParaVendedor: orcamento.escalarParaVendedor || encaminhar,
        avisos: encaminhar
          ? [...orcamento.avisos, frete.foraDoRaio
              ? `ENCAMINHADO AO COMERCIAL: obra a ${frete.km} km da fábrica (limite ${catalogo.fretes.raio_maximo_km} km). Valor não exibido ao cliente.`
              : `ENCAMINHADO AO COMERCIAL: ${orcamento.metragemTotal} m² acima do limite de ${limiteM2} m². Valor não exibido ao cliente.`]
          : orcamento.avisos,
      },
      grupos, pdfPath,
    });

    if (encaminhar) {
      const motivo = frete.foraDoRaio
        ? `obra a ${frete.km} km da fábrica` : `${orcamento.metragemTotal} m² (acima de ${limiteM2})`;
      console.log(`[WEB] 📞 Encaminhado ao comercial — ${numero} — ${motivo} — ${cliente.nome} (${cliente.telefone}) — valor interno R$ ${orcamento.totalAvista}`);

      const zap = (catalogo.empresa.whatsapp || '').replace(/\D/g, '');
      const texto = encodeURIComponent(
        `Olá! Montei um pedido pelo site (protocolo ${numero}) e gostaria de receber a proposta.\n` +
        `${orcamento.totalPecas} peças · ${orcamento.metragemTotal} mts\n${cliente.nome}`
      );
      // ⚠️ NÃO devolve valores: o cliente fala com o comercial
      return res.json({
        encaminhado: true,
        motivo: frete.foraDoRaio ? 'distancia' : 'volume',
        numero,
        km: frete.km || null,
        mensagem: frete.foraDoRaio
          ? (frete.mensagemCliente || 'Sua obra está fora da nossa área de entrega automática.')
          : 'Seu pedido tem um volume que rende condição especial — nosso comercial monta a melhor proposta pra você.',
        whatsapp: zap ? `https://wa.me/${zap}?text=${texto}` : null,
        resumo: {
          metragemTotal: orcamento.metragemTotal,
          totalPecas: orcamento.totalPecas,
          produtos: orcamento.resumoPorProduto,
        },
      });
    }

    console.log(`[WEB] Orçamento ${numero} — ${cliente.nome} (${cliente.telefone}) — ${orcamento.metragemTotal}mts — R$ ${orcamento.totalAvista}`);
    res.json({
      numero,
      totalProdutos: orcamento.totalProdutos,
      totalFrete: orcamento.totalFrete,
      totalAvista: orcamento.totalAvista,
      frete: orcamento.frete,
      metragemTotal: orcamento.metragemTotal,
      totalPecas: orcamento.totalPecas,
      pagamentos: orcamento.pagamentos,
      avisos: orcamento.avisos,
      pdf: '/out/' + path.basename(pdfPath),
    });
  } catch (e) {
    if (!e.publico) console.error('Erro /api/orcamento:', e);
    res.status(e.publico ? 400 : 500).json({ error: e.message });
  }
});
// ===== fim do wizard =====

app.post('/simulate', async (req, res) => {
  try {
    const { chatId, texto } = req.body || {};
    if (!chatId) return res.status(400).json({ error: 'chatId obrigatório' });
    const acoes = await processar(chatId + '@simulador', texto || '');
    // converte caminho do PDF em URL baixável
    for (const a of acoes) {
      if (a.type === 'pdf') a.url = '/out/' + path.basename(a.filePath);
    }
    res.json({ acoes });
  } catch (err) {
    console.error('Erro no /simulate:', err);
    res.status(500).json({ error: err.message });
  }
});
// ===== fim do simulador =====

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responde já — processa em background
  try {
    const { event, payload } = req.body || {};
    if (event !== 'message' || !payload) return;
    if (payload.fromMe) return;                    // ignora mensagens enviadas por nós
    const chatId = payload.from;
    if (!chatId || chatId.endsWith('@g.us')) return; // ignora grupos
    let texto = payload.body || '';

    // Cliente enviou FOTO/mídia → anexa na ficha (pro vendedor) e avisa a conversa.
    // Regra: foto NUNCA vira dado técnico automático — humano avalia.
    if (payload.hasMedia && payload.media?.url) {
      const state = require('./state');
      const ficha = state.carregar(chatId);
      ficha.anexos = ficha.anexos || [];
      ficha.anexos.push({ url: payload.media.url, mimetype: payload.media.mimetype || '', em: new Date().toISOString() });
      state.salvar(ficha);
      texto = `[cliente enviou uma foto${texto ? ': ' + texto : ''}]`;
    }

    const acoes = await processar(chatId, texto);
    for (const acao of acoes) {
      await waha.typing(chatId, 800 + Math.random() * 1200); // ritmo humano
      if (acao.type === 'text') await waha.sendText(chatId, acao.text);
      if (acao.type === 'image') await waha.sendImage(chatId, acao.url, acao.caption);
      if (acao.type === 'pdf') await waha.sendPdf(chatId, acao.filePath, acao.caption);
      if (acao.type === 'handoff') {
        console.log(`[HANDOFF] ${chatId}: ${acao.motivo}`);
        // TODO: notificar o vendedor (ex: mandar msg pro número interno da equipe)
        // TODO: notificar o vendedor (ex: mandar msg pro número interno da equipe)
      }
    }
  } catch (err) {
    console.error('Erro no webhook:', err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🤖 Bot de orçamentos ouvindo na porta ${port}`));
