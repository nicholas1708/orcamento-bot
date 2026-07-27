/**
 * ESTADO DA CONVERSA — a "ficha" de cada cliente, persistida em disco.
 * O contexto vive AQUI, não na memória de nenhuma IA. Cliente pode sumir
 * e voltar horas depois: a ficha continua intacta.
 * (Base: 1 arquivo JSON por chat. Em produção com volume, trocar por SQLite/Postgres.)
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(DIR, { recursive: true });

const fileFor = (chatId) => path.join(DIR, chatId.replace(/[^a-zA-Z0-9]/g, '_') + '.json');

function novaFicha(chatId) {
  return {
    chatId,
    etapa: 'INICIO',
    tentativasErro: 0,
    cliente: { nome: null, cidade: null, endereco: null, telefone: chatId.replace(/@.*$/, '') },
    pedido: {
      telhaId: null, forroId: null, estruturaId: null,
      areaM2: null, cumeeiraM: null, rufoM: null, calhaM: null,
    },
    criadoEm: new Date().toISOString(),
    atualizadoEm: null,
  };
}

function carregar(chatId) {
  const f = fileFor(chatId);
  if (!fs.existsSync(f)) return novaFicha(chatId);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return novaFicha(chatId); // arquivo corrompido → recomeça
  }
}

function salvar(ficha) {
  ficha.atualizadoEm = new Date().toISOString();
  fs.writeFileSync(fileFor(ficha.chatId), JSON.stringify(ficha, null, 2));
}

function resetar(chatId) {
  const ficha = novaFicha(chatId);
  salvar(ficha);
  return ficha;
}

module.exports = { carregar, salvar, resetar };
