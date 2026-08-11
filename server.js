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
  res.json({ produtos: c.telhas || [], familias: [...new Set((c.telhas || []).map((t) => t.familia))] });
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
      comprimento_maximo_m: Number(p.comprimento_maximo_m),
      comprimento_minimo_m: Number(p.comprimento_minimo_m) || 0.5,
      transpasse_m: Number(p.transpasse_m) || null,
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

app.get('/api/catalogo', async (_req, res) => {
  try {
    const c = await getCatalogo();
    res.json({
      empresa: { razao_social: c.empresa.razao_social, site: c.empresa.site },
      telhas: c.telhas.map((t) => ({
        id: t.id, familia: t.familia, nome: t.nome, preco: t.preco,
        imagem: t.imagem || null, atributos: t.atributos || {},
        largura_util_m: t.largura_util_m, comprimento_maximo_m: t.comprimento_maximo_m,
        forro_integrado: t.forro_integrado,
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
    const grupos = Array.isArray(pedido?.grupos) && pedido.grupos.length
      ? pedido.grupos
      : [{ telhaId: pedido?.telhaId, cortes: pedido?.cortes }];
    if (!grupos.length || grupos.some((g) => !catalogo.telhas.some((t) => t.id === g.telhaId))) {
      return res.status(400).json({ error: 'Produto inválido.' });
    }

    // frete é cobrado À PARTE: calculado aqui e somado como linha própria
    const { calcularFrete } = require('./frete');
    const previa = calcularOrcamento({
      grupos, perfis: pedido.perfis || [], complementos: pedido.complementos || [],
    }, catalogo);
    const frete = await calcularFrete(
      { cep: cliente.cep, cidade: cliente.cidade, uf: cliente.estado },
      {
        metragemTotal: previa.metragemTotal,
        totalProdutos: previa.totalProdutos,
        codigos: grupos.map((g) => catalogo.telhas.find((t) => t.id === g.telhaId)?.codigo).filter(Boolean),
      },
      catalogo
    );
    // Fora do raio de entrega: NÃO conclui — registra e encaminha à equipe
    if (frete.foraDoRaio) {
      const numeroP = 'PROP-' + Date.now().toString(36).toUpperCase();
      orcamentosDb.salvar({
        numero: numeroP, canal: 'web',
        origem: req.body?.vendedor ? 'vendedor' : 'cliente',
        vendedor: req.body?.vendedor || null,
        cliente, orcamento: { ...previa, frete, escalarParaVendedor: true },
        grupos, pdfPath: null,
      });
      require('./clientes').salvar(cliente);
      console.log(`[WEB] ⚠️ Fora do raio (${frete.km} km) — ${numeroP} — ${cliente.nome} (${cliente.telefone})`);
      return res.json({
        foraDoRaio: true, numero: numeroP, km: frete.km,
        mensagem: frete.mensagemCliente,
        resumo: {
          metragemTotal: previa.metragemTotal, totalPecas: previa.totalPecas,
          produtos: previa.resumoPorProduto,
        },
      });
    }

    const orcamento = calcularOrcamento({
      grupos, perfis: pedido.perfis || [], complementos: pedido.complementos || [], frete,
    }, catalogo);

    const numero = 'WEB-' + Date.now().toString(36).toUpperCase();
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

    // registra no histórico para o painel
    orcamentosDb.salvar({
      numero, canal: 'web',
      origem: req.body?.vendedor ? 'vendedor' : 'cliente',
      vendedor: req.body?.vendedor || null,
      cliente, orcamento, grupos, pdfPath,
    });

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
    console.error('Erro /api/orcamento:', e);
    res.status(500).json({ error: e.message });
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
