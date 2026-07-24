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
    const texto = payload.body || '';

    const acoes = await processar(chatId, texto);
    for (const acao of acoes) {
      await waha.typing(chatId, 800 + Math.random() * 1200); // ritmo humano
      if (acao.type === 'text') await waha.sendText(chatId, acao.text);
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
