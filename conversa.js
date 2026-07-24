/**
 * MODO CONVERSACIONAL — a IA conduz o papo como um atendente humano,
 * mas com papel restrito: CONVERSAR e PREENCHER A FICHA. Ela pode citar
 * os preços por m² do catálogo (dado real, injetado no prompt), mas NUNCA
 * calcula o total — quem fecha o orçamento é o engine.js, determinístico.
 *
 * Fluxo: mensagem → IA extrai campos + responde natural → código VALIDA os
 * campos contra o catálogo → quando a ficha completa, o CÓDIGO monta o resumo
 * de confirmação → cliente confirma → engine + PDF (fora da IA).
 *
 * Requer OPENAI_API_KEY. Sem chave, o bot usa o modo menu (flow.js).
 */
const ai = require('./ai');

const CAMPOS_OBRIGATORIOS = [
  ['pedido', 'telhaId', 'qual telha o cliente quer'],
  ['pedido', 'forroId', 'forro (FR-NENHUM se não quiser; preenchido automático se a telha tem forro integrado)'],
  ['pedido', 'estruturaId', 'estrutura de sustentação'],
  ['pedido', 'areaM2', 'área em m²'],
  ['pedido', 'cumeeiraM', 'metros de cumeeira (0 se não quer)'],
  ['pedido', 'rufoM', 'metros de rufo (0 se não quer)'],
  ['pedido', 'calhaM', 'metros de calha (0 se não quer)'],
  ['cliente', 'nome', 'nome do cliente'],
  ['cliente', 'cidade', 'cidade do cliente'],
];

const fmtPreco = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');

const LIMITE_TELHAS_NO_PROMPT = 12;

/**
 * FUNIL DE CATÁLOGO — escala pra 100+ telhas sem estourar o prompt:
 * 1. Sem família definida e catálogo grande → IA só vê as FAMÍLIAS (com faixa de preço).
 * 2. Família definida → IA vê só as telhas daquela família (variações/atributos).
 * 3. Telha definida → IA vê só os forros COMPATÍVEIS com ela.
 */
function secaoTelhas(catalogo, ficha) {
  const todas = catalogo.telhas;
  const familias = [...new Set(todas.map(t => t.familia))];

  // catálogo pequeno → mostra tudo direto
  if (todas.length <= LIMITE_TELHAS_NO_PROMPT) {
    return 'TELHAS:\n' + todas.map(t =>
      `- id "${t.id}": ${t.nome} — ${fmtPreco(t.preco)}/m²${t.forro_integrado ? ' (JÁ INCLUI forro integrado)' : ''}. ${t.descricao || ''}`
    ).join('\n');
  }

  // catálogo grande, família ainda não escolhida → só famílias
  if (!ficha.pedido.familia) {
    const linhas = familias.map(f => {
      const grupo = todas.filter(t => t.familia === f);
      const precos = grupo.map(t => t.preco);
      return `- "${f}" (${grupo.length} opções, de ${fmtPreco(Math.min(...precos))} a ${fmtPreco(Math.max(...precos))}/m²)`;
    }).join('\n');
    return `FAMÍLIAS DE TELHAS (ajude o cliente a escolher UMA família primeiro; preencha campos.familia com o nome EXATO):\n${linhas}\n(As variações exatas de cada família você verá após a escolha.)`;
  }

  // família escolhida → só as telhas dela
  const grupo = todas.filter(t => t.familia === ficha.pedido.familia);
  return `TELHAS DA FAMÍLIA "${ficha.pedido.familia}" (ajude a escolher pela espessura/cor/acabamento):\n` +
    grupo.map(t =>
      `- id "${t.id}": ${t.nome} — ${fmtPreco(t.preco)}/m² · ${Object.entries(t.atributos || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}${t.forro_integrado ? ' (forro integrado)' : ''}`
    ).join('\n');
}

function secaoForros(catalogo, ficha) {
  const telha = catalogo.telhas.find(t => t.id === ficha.pedido.telhaId);
  let lista = catalogo.forros;
  if (telha && Array.isArray(telha.forros_compativeis) && telha.forros_compativeis.length) {
    lista = catalogo.forros.filter(f => telha.forros_compativeis.includes(f.id));
  }
  return lista.map(f =>
    `- id "${f.id}": ${f.nome}${f.preco ? ' — ' + fmtPreco(f.preco) + '/m²' : ''}`
  ).join('\n');
}

function montarSystemPrompt(catalogo, ficha) {
  const telhas = secaoTelhas(catalogo, ficha);
  const forros = secaoForros(catalogo, ficha);
  const estruturas = catalogo.estruturas.map(e =>
    `- id "${e.id}": ${e.nome}${e.preco_por_m2 ? ' — ' + fmtPreco(e.preco_por_m2) + '/m² coberto' : ''}. ${e.descricao || ''}`
  ).join('\n');

  const faltam = CAMPOS_OBRIGATORIOS
    .filter(([obj, campo]) => ficha[obj][campo] === null || ficha[obj][campo] === undefined)
    .map(([, campo, desc]) => `${campo} (${desc})`);

  return (
`Você é atendente virtual da ${process.env.EMPRESA_NOME || 'loja de telhas'} no WhatsApp. Simpático, direto, tom brasileiro informal-profissional. Mensagens CURTAS (1 a 3 frases), estilo WhatsApp, pode usar *negrito* e no máximo 1 emoji.

SEU OBJETIVO: conversar naturalmente e coletar os dados pro orçamento, um ou dois por vez, sem parecer formulário. Responda dúvidas do cliente sobre os produtos usando SOMENTE o catálogo abaixo.

CATÁLOGO (única fonte de verdade — NUNCA invente produto, preço ou condição fora daqui):
${telhas}
FORROS COMPATÍVEIS (só se a telha NÃO tiver forro integrado):
${forros}
ESTRUTURAS:
${estruturas}

REGRAS INEGOCIÁVEIS:
1. NUNCA calcule nem estime o TOTAL do orçamento. Se perguntarem o total, diga que o sistema gera o orçamento certinho em PDF assim que fechar os dados. Pode citar os preços por m² do catálogo.
2. NUNCA prometa prazo, desconto, frete ou condição de pagamento — diga que o vendedor confirma.
3. Se a telha escolhida tem forro integrado, defina forroId = "FR-NENHUM" e avise o cliente que o isopor já vem incluso.
4. Se o cliente não quer cumeeira/rufo/calha, registre 0. Se ele não souber o que é, explique em 1 frase simples.
5. Se o cliente pedir humano, fugir muito do assunto ou você não conseguir ajudar, use "handoff": true.
6. Área plausível: entre ${catalogo.regras.area_minima_m2} e 2000 m². Se der dimensões (ex: 10x8), você pode multiplicar SÓ pra registrar a área.

FICHA ATUAL (o que já foi coletado):
${JSON.stringify({ pedido: ficha.pedido, cliente: { nome: ficha.cliente.nome, cidade: ficha.cliente.cidade } })}

AINDA FALTA: ${faltam.length ? faltam.join(', ') : 'nada — a ficha está completa'}

RESPONDA APENAS JSON válido neste formato:
{"reply": "sua mensagem pro cliente", "campos": {somente os campos que ficaram CERTOS nesta mensagem, ex: {"telhaId":"TL-TERMO-40","areaM2":80}}, "handoff": false}
Campos possíveis em "campos": familia, telhaId, forroId, estruturaId, areaM2, cumeeiraM, rufoM, calhaM, nome, cidade. Só inclua um campo se o cliente deixou claro. Não inclua o que já está na ficha, a menos que ele corrija. Só use telhaId de telhas listadas acima; se as telhas ainda não apareceram, escolha a familia primeiro.`
  );
}

/** Valida e aplica os campos que a IA extraiu — o código é o juiz, não a IA. */
function aplicarCampos(ficha, campos, catalogo) {
  if (!campos || typeof campos !== 'object') return;
  const okNum = (v, min, max) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;

  // família (funil): valida contra as famílias reais do catálogo
  if (typeof campos.familia === 'string') {
    const familias = [...new Set(catalogo.telhas.map(t => t.familia))];
    const match = familias.find(f => f.toLowerCase() === campos.familia.toLowerCase().trim());
    if (match) ficha.pedido.familia = match;
  }

  if (campos.telhaId && catalogo.telhas.some(t => t.id === campos.telhaId)) {
    ficha.pedido.telhaId = campos.telhaId;
    const t = catalogo.telhas.find(x => x.id === campos.telhaId);
    ficha.pedido.familia = t.familia; // mantém o funil coerente
    if (t.forro_integrado) ficha.pedido.forroId = 'FR-NENHUM';
  }
  if (campos.forroId && catalogo.forros.some(f => f.id === campos.forroId)) {
    const t = catalogo.telhas.find(x => x.id === ficha.pedido.telhaId);
    const compativel = !t || !Array.isArray(t.forros_compativeis) || !t.forros_compativeis.length ||
      t.forros_compativeis.includes(campos.forroId);
    if ((!t || !t.forro_integrado) && compativel) ficha.pedido.forroId = campos.forroId;
  }
  if (campos.estruturaId && catalogo.estruturas.some(e => e.id === campos.estruturaId)) {
    ficha.pedido.estruturaId = campos.estruturaId;
  }
  if (okNum(campos.areaM2, 1, 2000)) ficha.pedido.areaM2 = Number(campos.areaM2);
  if (okNum(campos.cumeeiraM, 0, 500)) ficha.pedido.cumeeiraM = Number(campos.cumeeiraM);
  if (okNum(campos.rufoM, 0, 500)) ficha.pedido.rufoM = Number(campos.rufoM);
  if (okNum(campos.calhaM, 0, 500)) ficha.pedido.calhaM = Number(campos.calhaM);
  if (typeof campos.nome === 'string' && campos.nome.trim().length >= 2) ficha.cliente.nome = campos.nome.trim();
  if (typeof campos.cidade === 'string' && campos.cidade.trim().length >= 2) ficha.cliente.cidade = campos.cidade.trim();

  // telha sem forro escolhida e cliente não quer forro → IA manda forroId FR-NENHUM; default:
  if (ficha.pedido.telhaId && ficha.pedido.forroId === undefined) ficha.pedido.forroId = null;
}

const fichaCompleta = (ficha) =>
  CAMPOS_OBRIGATORIOS.every(([obj, campo]) => ficha[obj][campo] !== null && ficha[obj][campo] !== undefined) &&
  ficha.pedido.forroId !== null && ficha.pedido.forroId !== undefined;

/** Resumo de confirmação — montado pelo CÓDIGO com dados validados, não pela IA. */
function resumoConfirmacao(ficha, catalogo) {
  const t = catalogo.telhas.find(x => x.id === ficha.pedido.telhaId);
  const f = catalogo.forros.find(x => x.id === ficha.pedido.forroId);
  const e = catalogo.estruturas.find(x => x.id === ficha.pedido.estruturaId);
  return (
    `✅ *Confere pra mim, ${ficha.cliente.nome}?*\n\n` +
    `• Telha: ${t.nome}\n` +
    `• Forro: ${t.forro_integrado ? 'Isopor integrado à telha' : f.nome}\n` +
    `• Estrutura: ${e.nome}\n` +
    `• Área: ${ficha.pedido.areaM2} m²\n` +
    `• Cumeeira: ${ficha.pedido.cumeeiraM} m · Rufo: ${ficha.pedido.rufoM} m · Calha: ${ficha.pedido.calhaM} m\n\n` +
    `Posso gerar o orçamento em PDF? (*sim* / *não*)`
  );
}

/**
 * Processa uma mensagem no modo conversacional.
 * Retorna { acoes, confirmar } — confirmar=true quando a ficha fechou
 * e o flow deve mudar a etapa pra CONFIRMA.
 */
async function coletar(ficha, texto, catalogo) {
  const acoes = [];

  // histórico curto pra IA manter o fio da conversa (o estado REAL vive na ficha)
  ficha.historico = (ficha.historico || []).slice(-8);
  ficha.historico.push({ role: 'user', content: String(texto).slice(0, 500) });

  let r;
  try {
    r = await ai.chat([
      { role: 'system', content: montarSystemPrompt(catalogo, ficha) },
      ...ficha.historico,
    ]);
  } catch (e) {
    console.error('[conversa] IA indisponível:', e.message);
    return { acoes: [{ type: 'text', text: 'Opa, tive uma instabilidade aqui 🙈 Pode repetir, por favor?' }], confirmar: false };
  }

  aplicarCampos(ficha, r.campos, catalogo);

  if (r.handoff) {
    acoes.push({ type: 'handoff', motivo: 'Solicitado na conversa (IA)' });
    acoes.push({ type: 'text', text: r.reply || 'Vou te passar pra um dos nossos vendedores, só um instante! 👍' });
    return { acoes, confirmar: false, humano: true };
  }

  if (fichaCompleta(ficha)) {
    // ficha fechou → o CÓDIGO assume: resumo determinístico + confirmação
    if (r.reply) {
      ficha.historico.push({ role: 'assistant', content: r.reply });
      acoes.push({ type: 'text', text: r.reply });
    }
    acoes.push({ type: 'text', text: resumoConfirmacao(ficha, catalogo) });
    return { acoes, confirmar: true };
  }

  const reply = r.reply || 'Pode me contar mais sobre o que você precisa?';
  ficha.historico.push({ role: 'assistant', content: reply });
  acoes.push({ type: 'text', text: reply });
  return { acoes, confirmar: false };
}

module.exports = { coletar };
