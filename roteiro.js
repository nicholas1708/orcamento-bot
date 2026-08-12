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

  /**
   * A largura é fixa de fábrica; o comprimento é o cliente quem diz —
   * qualquer medida, quebrada inclusive. O único limite é o corte da máquina.
   */
  pedeCortes: (lim = null) =>
    '📏 Manda a *lista* — quantas peças de cada comprimento.\n\n' +
    '_Ex:_ `3 de 4m, 9 de 4,75 e 5 de 6,5`\n\n' +
    (lim ? `_Cortamos de ${String(lim.min).replace('.', ',')}m até ${String(lim.max).replace('.', ',')}m, na medida que você pedir._\n` : '') +
    '\n_Não sabe a medida? Responda *calcular* que eu monto pelo tamanho do local._',

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

  // ── Acabamentos e fixação ───────────────────────────────────────────
  pedeAcabamento:
    '🔩 Quer os *acabamentos e parafusos* junto?\n\n' +
    '_Cumeeira, frontal, lateral e a parafusagem — eu calculo a quantidade pelo tamanho do telhado._\n\n' +
    '*1* — Sim, manda tudo\n*2* — Só as telhas',

  pedeComprimentoAcabamento:
    '📐 Pra calcular os acabamentos, qual o *comprimento do telhado* em metros?\n\n' +
    '_É o lado da cumeeira. Ex: `20`_',

  pedeQuedasAcabamento:
    '🏠 E esse telhado tem *1 queda* ou *2 quedas*?\n\n*1* — Uma queda\n*2* — Duas quedas',

  pedeEstrutura:
    '🔧 Quer *estrutura* (vigas/terças galvanizadas) junto?\n\n' +
    '*1* — Só as telhas\n*2* — Telhas + estrutura',

  pedeNome: '🙂 Quase lá! Qual o seu *nome* (ou o da empresa)?',
  pedeCep:
    '📮 Qual o *CEP* da obra?\n\n' +
    '_É o que define a distância até a unidade mais próxima._\n' +
    'Se não souber, responda *pular*.',
  pedeCidade: '🏙️ Qual a *cidade* de entrega?',
  pedeEndereco: '📍 E o *endereço da obra* (rua, número e bairro)?\n\n_Necessário para a entrega._',

  confirmaDados: (c) =>
    `📋 Confirma os dados de entrega?\n\n` +
    `*Nome:* ${c.nome}\n${c.cep ? `*CEP:* ${c.cep}\n` : ''}` +
    `*Cidade:* ${c.cidade}\n*Endereço:* ${c.endereco}\n\n` +
    `*1* — Confirmar\n*2* — Entregar em outro endereço`,

  // ── Conferência da lista ────────────────────────────────────────────
  conferencia: (nome, linhas, metragem) =>
    `✅ *Confere pra mim, ${nome}?*\n\n` +
    `_Essa é a lista completa do seu orçamento:_\n\n` +
    linhas.map((l, i) =>
      `*${i + 1}.* ${l.nome}\n     ${l.tipo === 'telha'
        ? `${l.qtd} peças de ${String(l.comp).replace('.', ',')}m`
        : `${String(l.qtd).replace('.', ',')} ${l.rotulo}`}`).join('\n') +
    `\n\n*Metragem de telha:* ${metragem} mts\n\n` +
    `*1* — Está certo, pode gerar 📄\n` +
    `*2* — Mudar a quantidade de um item\n` +
    `*3* — Tirar um item da lista\n` +
    `*4* — Recomeçar do zero`,

  pedeItemQuantidade:
    '✏️ Qual item e qual a nova quantidade?\n\n_Ex:_ `3 = 250` _(item 3 passa a ter 250)_',
  pedeItemTirar: '🗑️ Qual o *número* do item que você quer tirar?',
  erroItem: 'Não achei esse item 🤔 Responda com o *número* que aparece na lista.',
  erroListaVazia: 'É o último item da lista — sem ele não sobra orçamento. Use *4* pra recomeçar.',

  erroOpcao: 'Não entendi 🤔 Responda com o *número* da opção.',
  erroCortes: 'Não consegui ler as medidas 🤔 Use `quantidade de comprimento`, ex: `3 de 4m, 9 de 4,75`.',
  erroDimensoes: 'Me diga as medidas como `comprimento x largura`, ex: `20x10`.',
  erroEndereco: 'Preciso do endereço completo com *rua, número e bairro*.',

  /** Único limite do comprimento: o que a máquina corta. */
  erroForaDoLimite: (nome, lim, curtos, longos) => {
    const lista = (arr) => arr.map((c) => String(c.comprimentoM).replace('.', ',') + 'm').join(', ');
    let t = `📏 A *${nome}* é cortada de *${String(lim.min).replace('.', ',')}m* a ` +
      `*${String(lim.max).replace('.', ',')}m*.\n\n`;
    if (longos.length) {
      t += `${lista(longos)} passa do máximo de fábrica — peça maior precisa de *emenda com transpasse*.\n` +
        `Me diga as medidas do local (ex: \`20x10\`) que eu monto a emenda no cálculo.\n\n`;
    }
    if (curtos.length) t += `${lista(curtos)} está abaixo do mínimo de corte.\n\n`;
    return t + 'Pode mandar a lista de novo com as medidas ajustadas.';
  },

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

/** "3 = 250", "item 3 250", "3: 250" → { item: 3, valor: 250 } */
function interpretarAjuste(texto) {
  const t = String(texto || '').replace(/,(\d)/g, '.$1');
  const m = t.match(/(\d+)\s*(?:=|:|->|para|pra|\s)\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const item = parseInt(m[1], 10);
  const valor = parseFloat(m[2]);
  if (!(item > 0) || !(valor >= 0)) return null;
  return { item, valor };
}

module.exports = {
  T,
  interpretarSimNao, interpretarDimensoes, interpretarQuedas,
  interpretarEscolha, interpretarCortes, interpretarAjuste,
};
