/**
 * MÁQUINA DE ESTADOS DA CONVERSA — determinística, sem IA.
 * Menus numerados: zero chance de alucinação. Uma camada de IA (NLU) pode ser
 * adicionada DEPOIS só pra interpretar texto livre → opção do menu; o fluxo
 * e o cálculo continuam determinísticos.
 */
const state = require('./state');
const { getCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { gerarPDF } = require('./pdf');
const ai = require('./ai');
const conversa = require('./conversa');
const path = require('path');

const MAX_ERROS = 3; // depois disso, encaminha pro vendedor

const num = (txt) => {
  const n = parseFloat(String(txt).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const menu = (titulo, opcoes) =>
  titulo + '\n\n' + opcoes.map((o, i) => `*${i + 1}* — ${o}`).join('\n') +
  '\n\n_Responda com o número da opção._';

const escolha = (txt, lista) => {
  const i = parseInt(String(txt).trim(), 10);
  return i >= 1 && i <= lista.length ? lista[i - 1] : null;
};

/** Número do menu OU texto livre interpretado pela IA (se configurada). */
async function escolhaInteligente(txt, lista, nomes, contexto) {
  const direto = escolha(txt, lista);
  if (direto) return direto;
  const n = await ai.escolherOpcao(txt, nomes, contexto);
  return n ? lista[n - 1] : null;
}

/** Número direto OU extraído do texto livre pela IA ("uns 100m²", "10 por 8"). */
async function numInteligente(txt, contexto) {
  const direto = num(txt);
  if (direto !== null) return direto;
  return await ai.extrairNumero(txt, contexto);
}

/**
 * Processa uma mensagem recebida. Retorna array de ações:
 * { type: 'text', text } | { type: 'pdf', filePath, caption } | { type: 'handoff', motivo }
 */
async function processar(chatId, textoRaw) {
  const texto = String(textoRaw || '').trim();
  const catalogo = await getCatalogo();
  let ficha = state.carregar(chatId);
  const acoes = [];
  const say = (t) => acoes.push({ type: 'text', text: t });

  // comandos globais
  if (/^(menu|recome[cç]ar|cancelar|0)$/i.test(texto)) {
    ficha = state.resetar(chatId);
  }
  if (/^(atendente|vendedor|humano)$/i.test(texto)) {
    acoes.push({ type: 'handoff', motivo: 'Cliente pediu atendente' });
    say('Sem problemas! Um dos nossos vendedores vai te atender por aqui em instantes. 👍');
    ficha.etapa = 'HUMANO';
    state.salvar(ficha);
    return acoes;
  }
  if (ficha.etapa === 'HUMANO') return acoes; // bot silencia quando humano assumiu

  // ===== MODO CONVERSACIONAL (IA configurada) =====
  // A IA conduz o papo e preenche a ficha; confirmação, cálculo e PDF
  // continuam 100% no código (etapas CONFIRMA/FIM caem no switch abaixo).
  if (ai.ativa() && !['CONFIRMA', 'FIM'].includes(ficha.etapa)) {
    const r = await conversa.coletar(ficha, texto, catalogo);
    if (r.humano) ficha.etapa = 'HUMANO';
    else if (r.confirmar) ficha.etapa = 'CONFIRMA';
    else ficha.etapa = 'COLETA_IA';
    state.salvar(ficha);
    return r.acoes;
  }

  const erro = (msgAjuda) => {
    ficha.tentativasErro++;
    if (ficha.tentativasErro >= MAX_ERROS) {
      acoes.push({ type: 'handoff', motivo: 'Cliente não conseguiu avançar no fluxo' });
      say('Vou te passar pra um dos nossos vendedores pra te ajudar melhor, tudo bem? Já já alguém te chama por aqui. 😉');
      ficha.etapa = 'HUMANO';
    } else {
      say(msgAjuda);
    }
  };

  switch (ficha.etapa) {
    case 'INICIO': {
      say(
        `Olá! 👋 Bem-vindo(a) à *${process.env.EMPRESA_NOME || 'nossa loja'}*!\n` +
        `Sou o assistente de orçamentos. Em poucos passos você recebe seu orçamento em PDF aqui mesmo.\n\n` +
        `A qualquer momento digite *menu* pra recomeçar ou *atendente* pra falar com uma pessoa.`
      );
      say(menu('🏠 Primeiro: qual *telha* você quer?', catalogo.telhas.map(t => `${t.nome} — R$ ${t.preco.toFixed(2).replace('.', ',')}/m²`)));
      ficha.etapa = 'TELHA';
      break;
    }

    case 'TELHA': {
      const t = await escolhaInteligente(texto, catalogo.telhas, catalogo.telhas.map(x => x.nome), 'tipo de telha');
      if (!t) { erro('Não entendi 🤔 Responda só com o *número* da telha desejada.'); break; }
      ficha.pedido.telhaId = t.id;
      ficha.tentativasErro = 0;
      if (t.forro_integrado) {
        ficha.pedido.forroId = 'FR-NENHUM';
        say(`Boa escolha! ✅ A *${t.nome}* já vem com o forro de isopor integrado.`);
        say(menu('🔧 E a *estrutura* de sustentação?', catalogo.estruturas.map(e => e.nome)));
        ficha.etapa = 'ESTRUTURA';
      } else {
        say(menu('🎯 Deseja *forro*?', catalogo.forros.map(f => f.preco ? `${f.nome} — R$ ${f.preco.toFixed(2).replace('.', ',')}/m²` : f.nome)));
        ficha.etapa = 'FORRO';
      }
      break;
    }

    case 'FORRO': {
      const f = await escolhaInteligente(texto, catalogo.forros, catalogo.forros.map(x => x.nome), 'tipo de forro');
      if (!f) { erro('Responda com o *número* da opção de forro, por favor.'); break; }
      ficha.pedido.forroId = f.id;
      ficha.tentativasErro = 0;
      say(menu('🔧 E a *estrutura* de sustentação?', catalogo.estruturas.map(e => e.nome)));
      ficha.etapa = 'ESTRUTURA';
      break;
    }

    case 'ESTRUTURA': {
      const e = await escolhaInteligente(texto, catalogo.estruturas, catalogo.estruturas.map(x => x.nome), 'estrutura de sustentação do telhado');
      if (!e) { erro('Responda com o *número* da opção de estrutura.'); break; }
      ficha.pedido.estruturaId = e.id;
      ficha.tentativasErro = 0;
      say('📐 Qual a *área a cobrir*, em m²? (ex: *100* ou *85,5*)\n\n_Dica: comprimento × largura do telhado._');
      ficha.etapa = 'AREA';
      break;
    }

    case 'AREA': {
      const a = await numInteligente(texto, 'área do telhado em metros quadrados');
      if (!a || a <= 0) { erro('Preciso de um número em m². Ex: *100*'); break; }
      ficha.pedido.areaM2 = a;
      ficha.tentativasErro = 0;
      say('📏 Quantos *metros de cumeeira* (parte de cima do telhado)?\nSe não precisa, responda *0*.');
      ficha.etapa = 'CUMEEIRA';
      break;
    }

    case 'CUMEEIRA': {
      const v = await numInteligente(texto, 'metros de cumeeira (0 se não quer)');
      if (v === null || v < 0) { erro('Responda com o número de metros (ou *0*).'); break; }
      ficha.pedido.cumeeiraM = v;
      ficha.tentativasErro = 0;
      say('📏 E *rufo* (acabamento lateral)? Metros, ou *0*.');
      ficha.etapa = 'RUFO';
      break;
    }

    case 'RUFO': {
      const v = await numInteligente(texto, 'metros de rufo (0 se não quer)');
      if (v === null || v < 0) { erro('Responda com o número de metros (ou *0*).'); break; }
      ficha.pedido.rufoM = v;
      ficha.tentativasErro = 0;
      say('📏 E *calha*? Metros, ou *0*.');
      ficha.etapa = 'CALHA';
      break;
    }

    case 'CALHA': {
      const v = await numInteligente(texto, 'metros de calha (0 se não quer)');
      if (v === null || v < 0) { erro('Responda com o número de metros (ou *0*).'); break; }
      ficha.pedido.calhaM = v;
      ficha.tentativasErro = 0;
      say('🙂 Quase lá! Qual o seu *nome*?');
      ficha.etapa = 'NOME';
      break;
    }

    case 'NOME': {
      if (texto.length < 2) { erro('Pode me dizer seu nome?'); break; }
      ficha.cliente.nome = texto;
      ficha.tentativasErro = 0;
      say('🏙️ E sua *cidade*?');
      ficha.etapa = 'CIDADE';
      break;
    }

    case 'CIDADE': {
      if (texto.length < 2) { erro('Qual sua cidade?'); break; }
      ficha.cliente.cidade = texto;
      ficha.tentativasErro = 0;

      // Monta o resumo pra confirmação — cliente valida ANTES de gerar o PDF
      const t = catalogo.telhas.find(x => x.id === ficha.pedido.telhaId);
      const f = catalogo.forros.find(x => x.id === ficha.pedido.forroId);
      const e = catalogo.estruturas.find(x => x.id === ficha.pedido.estruturaId);
      say(
        `✅ *Confere pra mim, ${ficha.cliente.nome}?*\n\n` +
        `• Telha: ${t.nome}\n` +
        `• Forro: ${t.forro_integrado ? 'Isopor integrado à telha' : f.nome}\n` +
        `• Estrutura: ${e.nome}\n` +
        `• Área: ${ficha.pedido.areaM2} m²\n` +
        `• Cumeeira: ${ficha.pedido.cumeeiraM} m · Rufo: ${ficha.pedido.rufoM} m · Calha: ${ficha.pedido.calhaM} m\n\n` +
        `*1* — Sim, gerar orçamento 📄\n*2* — Não, recomeçar`
      );
      ficha.etapa = 'CONFIRMA';
      break;
    }

    case 'CONFIRMA': {
      let opc = texto === '1' ? 1 : texto === '2' ? 2 : null;
      if (!opc && /^(sim|pode|ok|isso|confirmo|gerar?|s)$/i.test(texto)) opc = 1;
      if (!opc && /^(n[aã]o|errado|mudar|n)$/i.test(texto)) opc = 2;
      if (!opc) opc = await ai.escolherOpcao(texto, ['Sim, pode gerar o orçamento', 'Não, quero recomeçar/mudar algo'], 'confirmação do pedido');
      if (opc === 2) {
        ficha = state.resetar(chatId);
        say('Sem problemas, vamos de novo! Digite qualquer coisa pra recomeçar. 🙂');
        break;
      }
      if (opc !== 1) { erro('Responda *1* pra gerar o orçamento ou *2* pra recomeçar.'); break; }

      // ==== AQUI ENTRA A MATEMÁTICA PURA — nada de IA ====
      const t = catalogo.telhas.find(x => x.id === ficha.pedido.telhaId);
      const f = catalogo.forros.find(x => x.id === ficha.pedido.forroId);
      const e = catalogo.estruturas.find(x => x.id === ficha.pedido.estruturaId);
      const orcamento = calcularOrcamento(ficha.pedido, catalogo);

      const numero = 'WA-' + Date.now().toString(36).toUpperCase();
      const pdfPath = path.join(__dirname, 'out', `orcamento-${numero}.pdf`);
      await gerarPDF({
        cliente: ficha.cliente,
        pedido: {
          ...ficha.pedido, numero,
          telhaNome: t.nome,
          forroNome: t.forro_integrado ? 'Isopor integrado' : f.nome,
          estruturaNome: e.nome,
        },
        orcamento, catalogo,
        empresa: {
          nome: process.env.EMPRESA_NOME || 'Empresa',
          telefone: process.env.EMPRESA_TELEFONE || '',
          cidade: process.env.EMPRESA_CIDADE || '',
        },
      }, pdfPath);

      acoes.push({
        type: 'pdf', filePath: pdfPath,
        caption: `📄 Orçamento ${numero} — total *R$ ${orcamento.total.toFixed(2).replace('.', ',')}*`,
      });
      say(
        `Prontinho! 🎉 Qualquer dúvida é só chamar.\n` +
        `Quer falar com um vendedor pra fechar? Digite *atendente*.\n` +
        `Novo orçamento: digite *menu*.`
      );
      if (orcamento.escalarParaVendedor) {
        acoes.push({ type: 'handoff', motivo: 'Orçamento acima do limite de autoatendimento' });
      }
      ficha.etapa = 'FIM';
      break;
    }

    case 'FIM':
    default: {
      say('Digite *menu* pra fazer um novo orçamento ou *atendente* pra falar com uma pessoa. 🙂');
      break;
    }
  }

  state.salvar(ficha);
  return acoes;
}

module.exports = { processar };
