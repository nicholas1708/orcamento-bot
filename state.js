/**
 * ESTADO DA CONVERSA — a "ficha" de cada cliente, persistida em disco.
 * O contexto vive AQUI, não na memória de nenhuma IA. Cliente pode sumir
 * e voltar horas depois: a ficha continua intacta.
 * (1 arquivo JSON por chat. Com volume, trocar por SQLite/Postgres.)
 */
const fs = require('fs');
const path = require('path');
const clientes = require('./clientes');

const DIR = path.join(__dirname, 'sessions');
fs.mkdirSync(DIR, { recursive: true });

const fileFor = (chatId) => path.join(DIR, chatId.replace(/[^a-zA-Z0-9]/g, '_') + '.json');

function novaFicha(chatId) {
  const telefone = chatId.replace(/@.*$/, '');
  // cliente recorrente: reaproveita nome/cidade/endereço do cadastro
  const conhecido = clientes.carregar(telefone);
  return {
    chatId,
    etapa: 'INICIO',
    tentativasErro: 0,
    clienteConhecido: !!clientes.completo(conhecido),
    cliente: {
      nome: conhecido?.nome || null,
      cidade: conhecido?.cidade || null,
      endereco: conhecido?.endereco || null,
      documento: conhecido?.documento || null,
      cep: conhecido?.cep || null,
      estado: null,
      email: conhecido?.email || null,
      telefone,
    },
    pedido: {
      // VÁRIOS produtos por orçamento (ex: fábrica com TP40 + translúcida)
      grupos: [],                 // [{ telhaId, nome, cortes:[{comprimentoM,quantidade}], ambiente? }]
      // produto sendo montado agora
      atual: {
        familia: null,
        telhaId: null,
        cortes: null,             // caminho A — cliente informa
        comprimentoGalpaoM: null, // caminho B — sistema calcula
        larguraGalpaoM: null,
        quedas: null,
      },
      // acabamentos e fixação — OPCIONAIS, valem para o orçamento todo
      comAcabamento: null,
      complementos: null,         // [{ produtoId, metros? }]
      acabComprimentoM: null,     // comprimento do telhado, quando não vem do ambiente
      avulsoId: null,             // item sendo adicionado no pedido sem telha
      // estrutura é OPCIONAL e vale para o orçamento todo
      comEstrutura: null,
      perfilEscolhido: null,      // id do perfil, quando há mais de um cadastrado
      perfis: null,               // [{ perfilId, metros }]
      // lista conferida pelo cliente antes de gerar (é ela que vira o PDF)
      linhas: null,               // [{ tipo, id, nome, qtd, comp, rotulo }]
      memoriaCalculo: null,       // rastro do cálculo (auditoria)
    },
    anexos: [],
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
    return novaFicha(chatId);
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
