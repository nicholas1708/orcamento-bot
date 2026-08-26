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
//
// Continua sendo Basic auth, agora com USUÁRIO além da senha. O navegador já
// pede os dois no mesmo popup, então nada muda para quem usa:
//
//   admin  + PAINEL_SENHA  → vê tudo, cadastra produto, cadastra vendedor
//   fulano + senha dele    → vê só os orçamentos que saíram pelo link dele
//
// Sem nenhum vendedor cadastrado o sistema se comporta exatamente como antes.
const PAINEL_SENHA = process.env.PAINEL_SENHA || '';
const vendedoresDb = require('./vendedores');

/**
 * Qualquer pessoa da equipe: admin ou vendedor.
 * Deixa a sessão em req.usuario = { id, nome, papel, slug, telhas }.
 */
function exigirLogin(req, res, next) {
  if (!PAINEL_SENHA) {
    return res.status(503).send('Painel desativado: defina PAINEL_SENHA nas variáveis de ambiente.');
  }
  const h = req.headers.authorization || '';
  const [tipo, dados] = h.split(' ');
  if (tipo === 'Basic' && dados) {
    const bruto = Buffer.from(dados, 'base64').toString();
    const i = bruto.indexOf(':');                 // senha pode conter ':'
    const usuario = i >= 0 ? bruto.slice(0, i) : '';
    const senha = i >= 0 ? bruto.slice(i + 1) : bruto;
    const sessao = vendedoresDb.autenticar(usuario, senha);
    if (sessao) { req.usuario = sessao; return next(); }
  }
  res.set('WWW-Authenticate', 'Basic realm="Painel 4A"');
  return res.status(401).send('Acesso restrito.');
}

/** Só o dono. Cadastro de produto, de vendedor e diagnóstico moram aqui. */
function exigirAdmin(req, res, next) {
  exigirLogin(req, res, () => {
    if (req.usuario.papel === 'admin') return next();
    // 'error' é a chave que o painel inteiro já lê (ver enviar() em painel-ui.js)
    res.status(403).json({ error: 'Só o administrador pode fazer isso.' });
  });
}

// Nome antigo mantido para não quebrar rota nenhuma enquanto migra.
const exigirSenha = exigirLogin;

// ===== SIMULADOR LOCAL (testes sem WhatsApp) =====
// Abra /simulador — conversa com o mesmo flow.js do WhatsApp.
const path = require('path');
const orcamentosDb = require('./orcamentos');

// PDFs: SEM senha — o cliente precisa baixar o próprio orçamento na hora.
// A proteção é o nome do arquivo, que leva um token aleatório: o link só é
// conhecido por quem gerou (e pela empresa, pelo painel). Sem listagem de
// diretório, não dá pra descobrir os orçamentos dos outros.
app.use('/out', express.static(path.join(__dirname, 'out'), { index: false }));

// FOTOS PRÓPRIAS DOS PRODUTOS — alternativa ao CDN da 4A.
// Basta jogar o arquivo em img/ e apontar "imagem": "/img/arquivo.jpg" no
// catálogo. Vale para o site E para o PDF (ver imagens.js). São fotos de
// catálogo, sem dado de cliente: público de propósito.
app.use('/img', express.static(path.join(__dirname, 'img'), { index: false, maxAge: '7d' }));

app.get('/simulador', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'simulador.html')));

// Design system do painel (compartilhado pelas páginas internas)
app.get('/painel/ui.css', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-ui.css')));
app.get('/painel/ui.js', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-ui.js')));

// ── PAINEL ────────────────────────────────────────────────────────────
app.get('/painel', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel.html')));

/** Quem está logado — o painel usa para esconder o que o vendedor não pode ver. */
app.get('/api/painel/eu', exigirLogin, (req, res) => {
  res.json({ ...req.usuario, vendedores: req.usuario.papel === 'admin'
    ? vendedoresDb.listar().map((v) => ({ id: v.id, nome: v.nome, ativo: v.ativo })) : [] });
});

app.get('/api/painel/orcamentos', exigirLogin, (req, res) => {
  const { de, ate, canal, origem, status, busca, vendedor } = req.query;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let lista = orcamentosDb.listar();

  // ⚠️ O CORTE POR VENDEDOR VEM PRIMEIRO e não é opcional. O vendedor nunca
  // enxerga orçamento de outro — nem os antigos, sem dono. Filtro de tela é
  // conveniência; isto aqui é a regra.
  if (req.usuario.papel !== 'admin') {
    lista = lista.filter((o) => o.vendedorId === req.usuario.id);
  } else if (vendedor) {
    lista = vendedor === 'sem'
      ? lista.filter((o) => !o.vendedorId)
      : lista.filter((o) => o.vendedorId === vendedor);
  }

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

// ── PAINEL › VENDEDORES (só admin) ────────────────────────────────────
// Cada vendedor tem seu link (/orcamento?v=slug) e a lista de telhas que
// pode vender. Preço não muda por vendedor — o motor é o mesmo para todos.
app.get('/painel/vendedores', exigirAdmin, (_req, res) =>
  res.sendFile(path.join(__dirname, 'painel-vendedores.html')));

app.get('/api/painel/vendedores', exigirAdmin, (_req, res) => {
  const catalogo = lerCat();
  const totais = {};
  for (const o of orcamentosDb.listar()) {
    if (o.vendedorId) totais[o.vendedorId] = (totais[o.vendedorId] || 0) + 1;
  }
  res.json({
    vendedores: vendedoresDb.listar().map((v) => ({ ...v, orcamentos: totais[v.id] || 0 })),
    telhas: (catalogo.telhas || []).filter((t) => t.ativo !== false)
      .map((t) => ({ id: t.id, nome: t.nome, codigo: t.codigo || null })),
  });
});

app.post('/api/painel/vendedor', exigirAdmin, (req, res) => {
  try {
    res.json({ ok: true, vendedor: vendedoresDb.salvar(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Desativa, não apaga: orçamento antigo precisa continuar com dono.
app.delete('/api/painel/vendedor/:id', exigirAdmin, (req, res) => {
  try {
    res.json({ ok: true, vendedor: vendedoresDb.desativar(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── PAINEL › CLIENTES ─────────────────────────────────────────────────
// O cadastro nasce do próprio orçamento: para orçar, o cliente informa nome,
// telefone, cidade e endereço — e isso já fica gravado aqui.
app.get('/painel/clientes', exigirSenha, (_req, res) => res.sendFile(path.join(__dirname, 'painel-clientes.html')));

/**
 * Telefones que este usuário pode ver.
 * O cadastro de cliente nasce do orçamento, então a regra é a mesma: o
 * vendedor só alcança quem passou pelo link dele. Admin recebe null = tudo.
 */
function telefonesVisiveis(usuario) {
  if (!usuario || usuario.papel === 'admin') return null;
  const so = new Set();
  for (const o of orcamentosDb.listar()) {
    if (o.vendedorId === usuario.id) so.add(String(o.cliente?.telefone || '').replace(/\D/g, ''));
  }
  return so;
}

app.get('/api/painel/clientes', exigirLogin, (req, res) => {
  const clientesDb = require('./clientes');
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const meusTelefones = telefonesVisiveis(req.usuario);
  // ⚠️ O vendedor também não pode ver o VALOR de orçamento que não é dele:
  // sem este corte, a coluna "valor gerado" somaria a venda dos colegas.
  const orcs = orcamentosDb.listar()
    .filter((o) => !meusTelefones || o.vendedorId === req.usuario.id);

  let lista = clientesDb.listar()
    .filter((c) => !meusTelefones || meusTelefones.has(c.telefone))
    .map((c) => {
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
app.get('/api/painel/cliente/:telefone', exigirLogin, (req, res) => {
  const clientesDb = require('./clientes');
  const tel = String(req.params.telefone).replace(/\D/g, '');
  const meusTelefones = telefonesVisiveis(req.usuario);
  // 404, não 403: quem não é dono do cliente não fica sabendo que ele existe
  if (meusTelefones && !meusTelefones.has(tel)) {
    return res.status(404).json({ error: 'Cliente não encontrado.' });
  }
  const c = clientesDb.carregar(tel);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const orcamentos = orcamentosDb.listar()
    .filter((o) => String(o.cliente?.telefone || '').replace(/\D/g, '') === tel)
    .filter((o) => !meusTelefones || o.vendedorId === req.usuario.id)
    .map((o) => ({ numero: o.numero, criadoEm: o.criadoEm, status: o.status, canal: o.canal,
      origem: o.origem, totalAvista: o.totalAvista, metragemTotal: o.metragemTotal, pdf: o.pdf }));
  res.json({ cliente: { ...c, pendencias: clientesDb.pendencias(c) }, orcamentos });
});

app.post('/api/painel/cliente', exigirLogin, (req, res) => {
  try {
    const clientesDb = require('./clientes');
    const { telefone, ...dados } = req.body || {};
    if (!telefone) return res.status(400).json({ error: 'Telefone é a chave do cadastro.' });

    // vendedor só edita cliente que passou pelo link dele
    const meusTelefones = telefonesVisiveis(req.usuario);
    if (meusTelefones && !meusTelefones.has(String(telefone).replace(/\D/g, ''))) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    if (dados.nome !== undefined && !String(dados.nome).trim()) {
      return res.status(400).json({ error: 'O nome não pode ficar em branco.' });
    }
    const r = clientesDb.atualizar(telefone, dados);
    if (!r) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json({ ok: true, cliente: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PAINEL › CADASTRO DE DADOS (upload das planilhas) ─────────────────
app.get('/painel/dados', exigirAdmin, (_req, res) => res.sendFile(path.join(__dirname, 'painel-dados.html')));

/** Baixa o modelo de planilha (em branco ou com o que já está cadastrado). */
app.get('/api/painel/modelo/:qual', exigirSenha, (req, res) => {
  const mapa = { produtos: '1-produtos.csv', fretes: '2-fretes.csv', unidades: '3-unidades.csv' };
  const arq = mapa[req.params.qual];
  if (!arq) return res.status(404).send('Modelo não encontrado.');
  res.download(path.join(__dirname, 'planilhas', arq));
});

/** Valida os CSVs enviados. Só grava quando "aplicar" vem true. */
app.post('/api/painel/importar', exigirAdmin, async (req, res) => {
  try {
    const { produtosCsv, fretesCsv, unidadesCsv, aplicar: confirmar } = req.body || {};
    if (!produtosCsv && !fretesCsv && !unidadesCsv) {
      return res.status(400).json({ error: 'Envie ao menos uma planilha.' });
    }
    const { processar, aplicar: montar } = require('./importador');
    const { caminhoCatalogo: arqCat, caminhoBackup: arqBk } = require('./catalogo-arquivo');
    const arquivoCat = arqCat();
    const catalogo = JSON.parse(require('fs').readFileSync(arquivoCat, 'utf8'));

    const r = processar({ produtosCsv, fretesCsv, unidadesCsv }, catalogo);

    if (confirmar && r.ok) {
      // guarda uma cópia antes de sobrescrever — dá pra voltar atrás
      require('fs').writeFileSync(arqBk(), JSON.stringify(catalogo, null, 2));
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
// O catálogo EM USO fica em dados/ (volume), não na raiz do projeto: senão
// todo cadastro feito pelo painel voltaria ao do repositório a cada deploy.
const { caminhoCatalogo, caminhoBackup } = require('./catalogo-arquivo');
const lerCat = () => JSON.parse(fsp.readFileSync(caminhoCatalogo(), 'utf8'));
const gravarCat = (c) => {
  const arq = caminhoCatalogo();
  fsp.writeFileSync(caminhoBackup(), fsp.readFileSync(arq));  // dá pra voltar atrás
  fsp.writeFileSync(arq, JSON.stringify(c, null, 2));
  limparCacheCatalogo();
};

app.get('/painel/produtos', exigirAdmin, (_req, res) => res.sendFile(path.join(__dirname, 'painel-produtos.html')));

/**
 * UPLOAD DA FOTO DO PRODUTO.
 * A equipe manda o arquivo direto pelo painel, sem precisar de link nem de
 * subir nada no site. O navegador ja reduz e converte para JPEG antes de
 * enviar (ver painel-ui.js), entao aqui chega um data URL pequeno.
 *
 * Mesmo assim conferimos tipo e tamanho: a tela pode ser burlada, e o PDF
 * so aceita JPEG e PNG — arquivo de outro formato quebraria a geracao.
 */
const PNG_ASSINATURA = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const FOTO_MAX_BYTES = 4 * 1024 * 1024;

app.post('/api/painel/imagem', exigirAdmin, (req, res) => {
  try {
    const { nome, dados } = req.body || {};
    if (!dados) return res.status(400).json({ error: 'Nenhuma imagem recebida.' });

    const m = String(dados).match(/^data:image\/(?:jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: 'Formato não aceito. Envie uma imagem JPG ou PNG.' });

    const buf = Buffer.from(m[1], 'base64');
    if (!buf.length) return res.status(400).json({ error: 'A imagem chegou vazia.' });
    if (buf.length > FOTO_MAX_BYTES) {
      return res.status(400).json({ error: `Imagem muito grande (${Math.round(buf.length / 1024)} KB). O limite é 4 MB.` });
    }

    // Assinatura do arquivo, não o que o navegador disse que era
    const ehJpg = buf[0] === 0xFF && buf[1] === 0xD8;
    const ehPng = buf.subarray(0, 8).equals(PNG_ASSINATURA);
    if (!ehJpg && !ehPng) {
      return res.status(400).json({ error: 'O arquivo não é uma imagem JPG ou PNG válida.' });
    }

    // Nome previsível a partir do original + sufixo aleatório, para trocar a
    // foto de um produto não sobrescrever a de outro que tenha nome igual.
    const base = String(nome || 'foto')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'foto';
    const arquivo = `${base}-${require('crypto').randomBytes(3).toString('hex')}${ehJpg ? '.jpg' : '.png'}`;

    fsp.mkdirSync(path.join(__dirname, 'img'), { recursive: true });
    fsp.writeFileSync(path.join(__dirname, 'img', arquivo), buf);

    const url = '/img/' + arquivo;
    require('./imagens').esquecer(url);   // o PDF passa a enxergar a foto na hora
    console.log(`[PAINEL] Foto enviada: ${url} (${Math.round(buf.length / 1024)} KB)`);
    res.json({ ok: true, url, bytes: buf.length });
  } catch (e) {
    console.error('Erro /api/painel/imagem:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/painel/produtos', exigirAdmin, (_req, res) => {
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
app.get('/api/painel/diagnostico', exigirAdmin, (_req, res) => {
  const { validarCatalogo } = require('./pricing');
  const r = validarCatalogo(lerCat());
  res.json({ problemas: r.problemas || [], alertas: r.alertas || [] });
});

/** Cadastro de perfis de estrutura (terças, vigas). */
app.post('/api/painel/perfil', exigirAdmin, (req, res) => {
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
      imagem: p.imagem || null,
      ativo: p.ativo !== false,
    };
    const i = c.perfis.findIndex((x) => x.id === id);
    if (i >= 0) c.perfis[i] = { ...c.perfis[i], ...registro, _confirmar: false };
    else c.perfis.push(registro);
    gravarCat(c);
    res.json({ ok: true, perfil: registro });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/painel/perfil/:id', exigirAdmin, (req, res) => {
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
app.post('/api/painel/complemento', exigirAdmin, (req, res) => {
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

app.delete('/api/painel/complemento/:id', exigirAdmin, (req, res) => {
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

app.post('/api/painel/produto', exigirAdmin, (req, res) => {
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
      // vínculo: só estes acabamentos e perfis acompanham a telha.
      // null mantém o comportamento antigo (aceita todos os ativos).
      compativeis: p.compativeis && (
        Array.isArray(p.compativeis.complementos) || Array.isArray(p.compativeis.perfis)
      ) ? {
        complementos: Array.isArray(p.compativeis.complementos) ? p.compativeis.complementos : [],
        perfis: Array.isArray(p.compativeis.perfis) ? p.compativeis.perfis : [],
      } : null,
    };

    const i = c.telhas.findIndex((t) => t.id === id);
    if (i >= 0) c.telhas[i] = { ...c.telhas[i], ...registro };
    else c.telhas.push(registro);

    gravarCat(c);
    res.json({ ok: true, produto: registro });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/painel/produto/:id', exigirAdmin, (req, res) => {
  try {
    const c = lerCat();
    const antes = (c.telhas || []).length;
    c.telhas = (c.telhas || []).filter((t) => t.id !== req.params.id);
    if (c.telhas.length === antes) return res.status(404).json({ error: 'Produto não encontrado.' });
    gravarCat(c);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/painel/status', exigirLogin, (req, res) => {
  const { numero, status, nota } = req.body || {};

  // vendedor só mexe no que é dele — inclusive marcar "fechado"
  if (req.usuario.papel !== 'admin') {
    const o = orcamentosDb.listar().find((x) => x.numero === numero);
    if (!o || o.vendedorId !== req.usuario.id) {
      return res.status(404).json({ error: 'Orçamento não encontrado.' });
    }
  }

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
// /orcamento?v=slug é o link de venda do vendedor. A tela lê o slug e o
// repassa; quem confere é o servidor, sempre pelo cadastro.
// canal experimental com visualização 3D — não substitui o wizard simples
app.get('/orcamento3d', (_req, res) => res.sendFile(path.join(__dirname, 'orcamento3d.html')));

// Página de vendas — preços vêm do catálogo, então mudar no painel muda aqui.
app.get('/lp', (_req, res) => res.sendFile(path.join(__dirname, 'lp.html')));

app.get('/api/catalogo', async (req, res) => {
  try {
    const c = await getCatalogo();

    // LINK DO VENDEDOR: ?v=slug reduz a vitrine ao que ele pode vender.
    // Sem ?v=, ou com slug que não existe / vendedor desativado, o
    // comportamento é o de sempre: todas as telhas ativas.
    const vend = vendedoresDb.buscarPorSlug(req.query.v);
    const telhasVisiveis = vendedoresDb.telhasDoVendedor(c, vend);

    res.json({
      vendedor: vend ? { nome: vend.nome, slug: vend.slug, telefone: vend.telefone } : null,
      // dados públicos da empresa — a LP e o wizard usam para o CTA
      empresa: {
        razao_social: c.empresa.razao_social, site: c.empresa.site,
        whatsapp: c.empresa.whatsapp || null, telefones: c.empresa.telefones || null,
        logo: c.empresa.logo || null,
      },
      // só cidade/UF: serve de prova de alcance na LP, sem expor CNPJ
      unidades: (c.unidades || []).filter((u) => u.ativa !== false)
        .map((u) => ({ cidade: u.cidade, uf: u.uf })),
      regras_publicas: {
        raio_maximo_km: c.fretes?.raio_maximo_km || null,
        validade_orcamento_dias: c.validade_orcamento_dias || null,
        prazo_entrega_dias: c.prazo_entrega_dias || null,
        garantias: c.textos_pdf?.garantias || [],
      },
      ilustracoes: c.ilustracoes || {},
      telhas: telhasVisiveis.map((t) => ({
        id: t.id, codigo: t.codigo || null, familia: t.familia, nome: t.nome,
        preco: t.preco, faixas_preco: t.faixas_preco || null,
        preco_tabela: t.preco_tabela || null,   // o "de" da vitrine
        imagem: t.imagem || null, atributos: t.atributos || {},
        largura_util_m: t.largura_util_m,
        comprimento_maximo_m: t.comprimento_maximo_m,
        comprimento_minimo_m: t.comprimento_minimo_m,
        promocao_ate_m: t.promocao_ate_m || null,
        vao_maximo_m: t.vao_maximo_m || null,
        inclinacao_minima_pct: t.inclinacao_minima_pct || null,
        forro_integrado: t.forro_integrado,
        // acabamentos e perfis que acompanham ESTA telha (null = todos)
        compativeis: t.compativeis || null,
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
        // a tela mostra "aguenta até Xm sem apoio" — sem este campo saía "undefined"
        vao_maximo_m: p.vao_maximo_m || null,
        imagem: p.imagem || null,
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
    const { complementos, perimetro } = complementosPorPerimetro(L, maior, quedas, catalogo, telhas[0]);
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
    // rua e bairro vêm vazios em cidade de CEP único — a tela pede ao cliente
    res.json({ cidade: info.cidade, uf: info.uf, rua: info.rua || null, bairro: info.bairro || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Erro de preenchimento (vira 400 e a mensagem vai para a tela do cliente). */
function erroCliente(msg) { const e = new Error(msg); e.publico = true; return e; }

/** Rua e número. "S/N" vale — endereço rural não pode travar o orçamento. */
function enderecoValido(v) {
  const t = String(v || '').trim();
  if (t.length < 8) return false;
  return /\d/.test(t) || /\bs\/?\s?n(º|o|\b)/i.test(t) || /sem\s+n[úu]mero/i.test(t);
}

/**
 * CPF ou CNPJ com dígito verificador conferido.
 * Validado também aqui, e não só na tela: a tela pode ser burlada.
 */
function documentoValido(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const dig = (base, peso) => {
      let s = 0;
      for (let i = 0; i < base; i++) s += +d[i] * (peso - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dig(9, 10) === +d[9] && dig(10, 11) === +d[10];
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const dig = (base) => {
      let p = base - 7, s = 0;
      for (let i = base - 1; i >= 0; i--) { s += +d[i] * p; p = (--p < 2) ? 9 : p; }
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dig(12) === +d[12] && dig(13) === +d[13];
  }
  return false;
}

/**
 * TRADUZ O QUE VEIO DA TELA para o formato do motor.
 * Fonte única: usada pelo /api/orcamento (que gera o PDF) e pelo /api/lista
 * (que mostra a lista sem preço para o cliente conferir). Assim a tela de
 * conferência mostra exatamente o que vai ser cobrado.
 *
 * @param {object|null} vendedor  quando o pedido veio pelo link de um
 *   vendedor, só as telhas da linha dele passam. Sem vendedor, tudo passa —
 *   é o link público de sempre.
 */
function montarPedido(pedido, catalogo, vendedor) {
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

    // ⚠️ Só entra o que está VINCULADO a esta telha. A tela já filtra, mas a
    // tela pode ser burlada — quem decide é o cadastro.
    const { compativeisDaTelha } = require('./romaneio');
    const permitidos = compativeisDaTelha(catalogo, telha, 'complementos').map((c) => c.id);

    const querComp = idsComp || (pedido.querAcabamento ? permitidos : []);

    for (const id of querComp) {
      if (permitidos.indexOf(id) < 0) continue;      // não acompanha esta telha
      const item = (catalogo.complementos || []).find((c) => c.id === id);
      if (!item) continue;
      const sug = (rom.complementos || []).find((c) => c.produtoId === id);
      if (sug) complementos.push({ produtoId: id, metros: sug.metros });      // pelo perímetro
      else if (item.consumo_por_m2) complementos.push({ produtoId: id });     // por m²
    }

    const perfisOk = compativeisDaTelha(catalogo, telha, 'perfis').map((p) => p.id);
    const querPerf = (idsPerf || (pedido.querEstrutura && pedido.perfilId ? [pedido.perfilId] : []))
      .filter((id) => perfisOk.indexOf(id) >= 0);
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

  // ⚠️ TRAVA DA REDE DE VENDEDORES. A tela já mostra só a linha dele, mas a
  // tela pode ser burlada: sem esta conferência bastaria trocar o telhaId no
  // POST para vender o que não é seu. Vale para os três modos.
  if (vendedor) {
    const fora = grupos.find((g) => !vendedoresDb.podeVender(catalogo, vendedor, g.telhaId));
    if (fora) {
      const t = catalogo.telhas.find((x) => x.id === fora.telhaId);
      throw erroCliente(`${t ? t.nome : 'Este produto'} não faz parte da sua linha de venda.`);
    }
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
    const vend = vendedoresDb.buscarPorSlug(req.body?.vendedorSlug || req.body?.v);
    const pedidoMotor = montarPedido(req.body?.pedido, catalogo, vend);
    res.json(montarLista(pedidoMotor, catalogo));
  } catch (e) {
    res.status(e.publico ? 400 : 500).json({ error: e.message });
  }
});

app.post('/api/orcamento', async (req, res) => {
  try {
    const { pedido, cliente } = req.body || {};
    // REGRA: sem endereço não existe orçamento (entrega/frete dependem dele)
    if (!cliente?.nome || !cliente?.cidade) {
      return res.status(400).json({ error: 'Nome e cidade são obrigatórios.' });
    }
    if (!enderecoValido(cliente.endereco)) {
      return res.status(400).json({ error: 'Endereço com rua e número — ex: "Rua Exemplo, 120". Sem número, escreva S/N.' });
    }
    if (!cliente?.telefone || String(cliente.telefone).replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Informe um telefone/WhatsApp válido com DDD.' });
    }
    // CEP define a unidade de origem e a regra dos 600 km
    if (String(cliente.cep || '').replace(/\D/g, '').length !== 8) {
      return res.status(400).json({ error: 'Informe o CEP da obra.' });
    }
    // documento vai no orçamento e na nota
    if (!documentoValido(cliente.documento)) {
      return res.status(400).json({ error: 'Informe um CPF ou CNPJ válido.' });
    }
    const catalogo = await getCatalogo();

    // ── DE QUEM É ESTE ORÇAMENTO ──────────────────────────────────────
    // O slug vem da tela, mas o vendedor sai do CADASTRO. Slug inventado,
    // apagado ou desativado simplesmente não vira dono — vira orçamento sem
    // vendedor, que só o admin enxerga.
    const vend = vendedoresDb.buscarPorSlug(req.body?.vendedorSlug || req.body?.v);

    // ── Traduz o que veio da tela para o formato do motor ─────────────
    // (o montarPedido também barra telha fora da linha do vendedor)
    const { grupos, complementos, perfis } = montarPedido(pedido, catalogo, vend);

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
      // veio pelo link de um vendedor? é o nome dele que assina o documento
      pedido: { numero, vendedor: vend ? vend.nome : catalogo.empresa.vendedor_padrao },
      orcamento, catalogo,
    }, pdfPath);

    // grava o cadastro (mesma base do WhatsApp — chave é o telefone)
    require('./clientes').salvar(cliente);

    // registra no histórico para o painel (com o motivo, quando encaminhado)
    orcamentosDb.salvar({
      numero, canal: 'web',
      origem: vend || req.body?.vendedor ? 'vendedor' : 'cliente',
      vendedor: vend ? vend.nome : (req.body?.vendedor || null),
      vendedorId: vend ? vend.id : null,          // é por aqui que o painel filtra
      vendedorSlug: vend ? vend.slug : null,
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

// Leva o vínculo acabamento↔telha para o catálogo em uso, quando ele ainda
// não tem. Só preenche o que está vazio, nunca sobrescreve escolha do painel.
require('./catalogo-arquivo').migrarVinculos();

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🤖 Bot de orçamentos ouvindo na porta ${port}`));
