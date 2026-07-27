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
app.get('/', (_req, res) => res.redirect('/simulador')); // raiz → simulador

// ===== SIMULADOR LOCAL (testes sem WhatsApp) =====
// Abra /simulador — conversa com o mesmo flow.js do WhatsApp.
const path = require('path');
app.use('/out', express.static(path.join(__dirname, 'out'))); // PDFs acessíveis no navegador

app.get('/simulador', (_req, res) => res.sendFile(path.join(__dirname, 'simulador.html')));

// ===== ORÇAMENTO SELF-SERVICE (wizard web) =====
// Mesmo catálogo + mesmo motor determinístico do WhatsApp, em formato de "slides".
const { getCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { gerarPDF } = require('./pdf');

app.get('/orcamento', (_req, res) => res.sendFile(path.join(__dirname, 'orcamento.html')));

app.get('/api/catalogo', async (_req, res) => {
  try {
    const c = await getCatalogo();
    // só o que o front precisa (não expõe coeficientes/custos internos)
    res.json({
      telhas: c.telhas.map(t => ({ id: t.id, familia: t.familia, nome: t.nome, preco: t.preco, imagem: t.imagem || null, atributos: t.atributos || {}, forro_integrado: t.forro_integrado })),
      estruturas: c.estruturas.map(e => ({ id: e.id, nome: e.nome, descricao: e.descricao || '', preco_por_m2: e.preco_por_m2 })),
      regras: { area_minima_m2: c.regras.area_minima_m2, area_maxima_autoatendimento_m2: c.regras.area_maxima_autoatendimento_m2 },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orcamento', async (req, res) => {
  try {
    const { pedido, cliente } = req.body || {};
    // REGRA: sem endereço não existe orçamento (frete depende da localidade)
    if (!cliente?.nome || !cliente?.cidade || !cliente?.endereco || !/\d/.test(cliente.endereco)) {
      return res.status(400).json({ error: 'Endereço completo (rua, número e bairro), cidade e nome são obrigatórios.' });
    }
    if (!cliente?.telefone || String(cliente.telefone).replace(/\D/g, '').length < 10) {
      return res.status(400).json({ error: 'Informe um telefone/WhatsApp válido com DDD.' });
    }
    const catalogo = await getCatalogo();
    const t = catalogo.telhas.find(x => x.id === pedido?.telhaId);
    const e = catalogo.estruturas.find(x => x.id === pedido?.estruturaId);
    if (!t || !e) return res.status(400).json({ error: 'Produto ou estrutura inválidos.' });

    const orcamento = calcularOrcamento(
      { ...pedido, forroId: pedido.forroId || 'FR-NENHUM', cidade: cliente.cidade },
      catalogo
    );
    const numero = 'WEB-' + Date.now().toString(36).toUpperCase();
    const pdfPath = path.join(__dirname, 'out', `orcamento-${numero}.pdf`);
    await gerarPDF({
      cliente,
      pedido: {
        ...pedido, numero,
        telhaNome: t.nome,
        forroNome: t.forro_integrado ? 'Integrado à telha' : 'Sem forro',
        estruturaNome: e.nome,
      },
      orcamento, catalogo,
      empresa: {
        nome: process.env.EMPRESA_NOME || 'Empresa',
        telefone: process.env.EMPRESA_TELEFONE || '',
        cidade: process.env.EMPRESA_CIDADE || '',
      },
    }, pdfPath);
    console.log(`[WEB] Orçamento ${numero} — ${cliente.nome} (${cliente.telefone}) — R$ ${orcamento.total}`);
    res.json({ numero, total: orcamento.total, avisos: orcamento.avisos, pdf: '/out/' + path.basename(pdfPath) });
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
      }
    }
  } catch (err) {
    console.error('Erro no webhook:', err.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🤖 Bot de orçamentos ouvindo na porta ${port}`));
