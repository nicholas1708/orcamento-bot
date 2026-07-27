/**
 * CAMADA DE ENVIO — WhatsApp via WAHA (https://waha.devlike.pro).
 * Isolada de propósito: se um dia migrar pra WhatsApp Cloud API (oficial),
 * troca-se SÓ este arquivo; bot, engine e PDF não mudam.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const api = () => axios.create({
  baseURL: process.env.WAHA_URL || 'http://localhost:3001',
  headers: { 'X-Api-Key': process.env.WAHA_API_KEY || '' },
  timeout: 30000,
});

const session = () => process.env.WAHA_SESSION || 'default';

async function sendText(chatId, text) {
  await api().post('/api/sendText', { session: session(), chatId, text });
}

/** Envia um PDF local como documento */
async function sendPdf(chatId, filePath, caption = '') {
  const data = fs.readFileSync(filePath).toString('base64');
  await api().post('/api/sendFile', {
    session: session(),
    chatId,
    caption,
    file: {
      mimetype: 'application/pdf',
      filename: path.basename(filePath),
      data,
    },
  });
}

/** Envia imagem por URL (ex: foto do acabamento no site) com legenda */
async function sendImage(chatId, url, caption = '') {
  await api().post('/api/sendImage', {
    session: session(),
    chatId,
    caption,
    file: { url },
  });
}

/** Simula "digitando..." — dá tempo humano entre mensagens (mitiga ban) */
async function typing(chatId, ms = 1200) {
  try {
    await api().post('/api/startTyping', { session: session(), chatId });
    await new Promise((r) => setTimeout(r, ms));
    await api().post('/api/stopTyping', { session: session(), chatId });
  } catch { /* endpoint opcional — ignora se indisponível */ }
}

module.exports = { sendText, sendPdf, sendImage, typing };
