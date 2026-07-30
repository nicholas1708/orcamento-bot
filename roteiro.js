/**
 * ROTEIRO — fonte única de textos e de interpretação de respostas.
 *
 * Por que existe: o mesmo fluxo roda em três canais (menu do WhatsApp, modo IA
 * e wizard web). Sem isto, mudar uma pergunta exigiria editar três arquivos.
 * Aqui ficam as mensagens e os parsers; os canais só consomem.
 *
 * Nenhuma regra de preço ou engenharia mora aqui — só linguagem.
 */

// ── TEXTOS ────────────────────────────────────────────────────────────
const T = {
  saudacao: (empresa) =>
    `Olá! 👋 Bem-vindo(a) à *${empresa}*!\n` +
    `Nossas telhas são cortadas *sob medida* — me diz o que você precisa que eu monto o orçamento.\n\n` +
    `_A qualquer momento: *menu* recomeça · *atendente* chama uma pessoa._`,

  saudacaoRecorrente: (nome) =>
    `Olá de novo, *${nome}*! 👋\nVamos montar mais um orçamento?\n\n` +
    `_*menu* recomeça · *atendente* chama uma pessoa._`,

  perguntaFamilia: (temItens) =>
    temItens ? '🏠 Qual a *linha* da próxima telha?' : '🏠 Qual *linha de telha* você procura?',

  perguntaModelo: (familia) => `📋 Modelos da linha *${familia}*:`,

  perguntaModo: (nome, preco, largura) =>
    `✅ *${nome}* — R$ ${preco}/metro (largura útil ${largura}m)\n\n` +
    `Você já sabe os tamanhos das telhas?\n\n` +
    `*1* — Sim, tenho a lista de medidas\n` +
    `*2* — Não, prefiro passar as medidas do local`,

  pedeCortes:
    '📏 Manda a *lista* — quantas peças de cada comprimento.\n\n' +
    '_Ex:_ `3 de 4m, 9 de 4,75 e 5 de 6,20`\n\n' +
    '_Pode mandar tudo de uma vez._',

  pedeAmbiente:
    '📐 Quais as *medidas do local*?\n\n' +
    'Ex: `20x10` — e se já souber, pode mandar junto: `20x10 duas águas`\n\n' +
    '_Comprimento = lado da cumeeira · largura = lado onde a água escorre._',

  pedeQuedas:
    '🏠 Essa área terá *1 queda* ou *2 quedas*?\n\n' +
    '_1 queda = caída única · 2 quedas = duas caídas com cumeeira no topo._\n\n' +
    '*1* — Uma queda\n*2* — Duas quedas',

  pedeMaisTelhas: (qtd, metros) =>
    `📦 No orçamento: *${qtd} produto(s)* · *${metros} mts*\n\n` +
    `Falta mais alguma telha?\n\n*1* — Sim, adicionar outra\n*2* — Não, seguir`,

  pedeEstrutura:
    '🔧 Quer *estrutura* (vigas/terças galvanizadas) junto?\n\n' +
    '*1* — Só as telhas\n*2* — Telhas + estrutura',

  pedeNome: '🙂 Quase lá! Qual o seu *nome* (ou o da empresa)?',
  pedeCidade: '🏙️ Qual a *cidade* de entrega?',
  pedeEndereco: '📍 E o *endereço da obra* (rua, número e bairro)?\n\n_Necessário para a entrega._',

  confirmaDados: (c) =>
    `📋 Confirma os dados de entrega?\n\n` +
    `*Nome:* ${c.nome}\n*Cidade:* ${c.cidade}\n*Endereço:* ${c.endereco}\n\n` +
    `*1* — Confirmar\n*2* — Entregar em outro endereço`,

  erroOpcao: 'Não entendi 🤔 Responda com o *número* da opção.',
  erroCortes: 'Não consegui ler as medidas 🤔 Use `quantidade de comprimento`, ex: `3 de 4m, 9 de 4,75`.',
  erroDimensoes: 'Me diga as medidas como `comprimento x largura`, ex: `20x10`.',
  erroEndereco: 'Preciso do endereço completo com *rua, número e bairro*.',

  handoffPedido: 'Sem problemas! Um dos nossos vendedores te atende por aqui em instantes 👍',
  handoffErro: 'Vou te passar pra um vendedor pra te ajudar melhor. Já já alguém te chama 😉',

  fechamento: (validade) =>
    `Prontinho! 🎉 O PDF traz também as opções parceladas.\n` +
    `Validade: *${validade} dia*.\n\n` +
    `Quer fechar? Digite *atendente*. Novo orçamento: *menu*.`,
};

// ── INTERPRETAÇÃO DE RESPOSTAS ────────────────────────────────────────
// Toleram o jeito real de escrever: "duas águas", "sim", "20 x 10", "3x4m".

const SIM = /^(s|sim|isso|ok|okay|claro|pode|positivo|confirmo|confirma|certo|beleza|blz|quero|com)\b/i;
const NAO = /^(n|nao|não|negativo|nops|sem|nem|nada|so as telhas|só as telhas)\b/i;

/** "sim"/"não"/"1"/"2" → true/false/null */
function interpretarSimNao(texto, { umEhSim = true } = {}) {
  const t = String(texto || '').trim();
  if (/^1$/.test(t)) return umEhSim;
  if (/^2$/.test(t)) return !umEhSim;
  if (SIM.test(t)) return true;
  if (NAO.test(t)) return false;
  return null;
}

/** "20x10", "20 por 10", "20 x 10 metros" → { comprimento, largura } */
function interpretarDimensoes(texto) {
  const t = String(texto || '').replace(/,(\d)/g, '.$1');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:x|×|por)\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const a = parseFloat(m[1]), b = parseFloat(m[2]);
  if (!(a > 0 && b > 0)) return null;
  return { comprimentoM: Math.max(a, b), larguraM: Math.min(a, b) };
}

/** "2 águas", "duas quedas", "uma caída", "1" → 1 | 2 | null */
function interpretarQuedas(texto) {
  const t = String(texto || '').toLowerCase();
  if (/\b(2|duas?|dois)\b|\bduas? (águas?|aguas?|quedas?|ca[íi]das?)\b/.test(t)) return 2;
  if (/\b(1|uma?|um)\b|\buma? (água|agua|queda|ca[íi]da)\b/.test(t)) return 1;
  return null;
}

/** Escolha por número OU pelo nome da opção (casamento por palavras). */
function interpretarEscolha(texto, opcoes) {
  const t = String(texto || '').trim();
  const i = parseInt(t, 10);
  if (i >= 1 && i <= opcoes.length) return i - 1;

  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const alvo = norm(t);
  if (alvo.length < 3) return -1;

  // pontua por palavras em comum
  let melhor = -1, melhorScore = 0;
  opcoes.forEach((o, idx) => {
    const palavras = norm(o).split(/[^a-z0-9]+/).filter((p) => p.length > 2);
    const score = palavras.filter((p) => alvo.includes(p)).length;
    if (score > melhorScore) { melhorScore = score; melhor = idx; }
  });
  return melhorScore >= 1 ? melhor : -1;
}

/** "3 de 4m, 9 de 4,75 e 5x6.20" → [{quantidade, comprimentoM}] */
function interpretarCortes(texto) {
  const out = [];
  const t = String(texto || '').replace(/,(\d)/g, '.$1');
  const re = /(\d+)\s*(?:x|un|pe[çc]as?|de)?\s*[·\-x]?\s*(\d+(?:\.\d+)?)\s*(?:m|mts|metros)?/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const qtd = parseInt(m[1], 10);
    const comp = parseFloat(m[2]);
    if (qtd > 0 && comp > 0 && comp < 30) out.push({ quantidade: qtd, comprimentoM: comp });
  }
  return out;
}

module.exports = {
  T,
  interpretarSimNao, interpretarDimensoes, interpretarQuedas,
  interpretarEscolha, interpretarCortes,
};
