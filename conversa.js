/**
 * MODO CONVERSACIONAL — a IA conduz o papo como um atendente humano,
 * mas com papel restrito: CONVERSAR e PREENCHER A FICHA.
 *
 * Um orçamento pode ter VÁRIOS PRODUTOS (ex: fábrica com TP40 em vários
 * comprimentos + translúcida). A IA monta a lista; o CÓDIGO valida cada
 * produto contra o catálogo, calcula o romaneio quando o cliente dá o
 * ambiente, e só então o engine calcula o preço.
 *
 * Requer OPENAI_API_KEY. Sem chave, o bot usa o modo menu (flow.js).
 */
const ai = require('./ai');
const { calcularRomaneio } = require('./romaneio');

const fmt = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
const LIMITE_TELHAS_NO_PROMPT = 12;
const metrosDe = (cortes) => cortes.reduce((s, c) => s + c.quantidade * c.comprimentoM, 0);

/** Funil: com catálogo grande, mostra só famílias até o cliente escolher uma. */
function secaoTelhas(catalogo, ficha) {
  const todas = catalogo.telhas;
  const fam = ficha.pedido.familiaFoco;
  if (todas.length <= LIMITE_TELHAS_NO_PROMPT) {
    return 'TELHAS:\n' + todas.map((t) =>
      `- id "${t.id}": ${t.nome} — ${fmt(t.preco)}/metro (largura útil ${t.largura_util_m}m, máx ${t.comprimento_maximo_m}m)`
    ).join('\n');
  }
  if (!fam) {
    const familias = [...new Set(todas.map((t) => t.familia))];
    return 'FAMÍLIAS DE TELHAS (escolha UMA por vez; preencha campos.familiaFoco com o nome EXATO para ver os modelos):\n' +
      familias.map((f) => {
        const g = todas.filter((t) => t.familia === f);
        const p = g.map((t) => t.preco);
        return `- "${f}" (${g.length} opções, de ${fmt(Math.min(...p))} a ${fmt(Math.max(...p))}/metro)`;
      }).join('\n');
  }
  const grupo = todas.filter((t) => t.familia === fam);
  return `TELHAS DA FAMÍLIA "${fam}":\n` + grupo.map((t) =>
    `- id "${t.id}": ${t.nome} — ${fmt(t.preco)}/metro · largura útil ${t.largura_util_m}m · máx ${t.comprimento_maximo_m}m · ${Object.entries(t.atributos || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}`
  ).join('\n');
}

function faltantes(ficha) {
  const p = ficha.pedido, c = ficha.cliente;
  const f = [];
  if (!Array.isArray(p.grupos) || !p.grupos.length) f.push('pelo menos um produto (grupos)');
  if (p.maisProdutos !== false) f.push('confirmar se há MAIS algum tipo de telha (campo maisProdutos: false quando o cliente disser que acabou)');
  if (p.comEstrutura === null || p.comEstrutura === undefined) f.push('comEstrutura (true/false)');
  if (!c.nome) f.push('nome');
  if (!c.cidade) f.push('cidade');
  if (!c.endereco) f.push('endereco (rua, número e bairro — OBRIGATÓRIO)');
  return f;
}

function montarSystemPrompt(catalogo, ficha) {
  const falta = faltantes(ficha);
  const jaTem = (ficha.pedido.grupos || []).map((g) =>
    `${g.nome}: ${g.cortes.map((c) => `${c.quantidade}x${c.comprimentoM}m`).join(', ')}`
  );
  return (
`Você é atendente virtual da ${catalogo.empresa.razao_social} no WhatsApp. Simpático, direto, tom brasileiro informal-profissional. Mensagens CURTAS (1 a 3 frases), estilo WhatsApp, pode usar *negrito* e no máximo 1 emoji.

A EMPRESA VENDE APENAS TELHAS (cortadas SOB MEDIDA) E ESTRUTURA METÁLICA (vigas/terças). Não executa serviços nem instalação.

${secaoTelhas(catalogo, ficha)}

COMO FUNCIONA: a telha é cortada no comprimento pedido e o preço é POR METRO LINEAR.
UM ORÇAMENTO PODE TER VÁRIOS PRODUTOS — é comum (galpão/fábrica) usar um modelo em vários comprimentos e ainda combinar com translúcida ou sanduíche. Colete um produto de cada vez e SEMPRE pergunte se falta mais algum tipo antes de fechar.

Para cada produto existem dois caminhos:
 (A) cliente JÁ SABE os tamanhos → {"telhaId":"...","cortes":[{"comprimentoM":4.75,"quantidade":9}, ...]}
 (B) cliente NÃO SABE → peça as medidas e envie {"telhaId":"...","comprimentoGalpaoM":20,"larguraGalpaoM":10,"quedas":2}. O SISTEMA calcula o romaneio — você NÃO calcula.

REGRAS INEGOCIÁVEIS:
1. NUNCA calcule quantidade de telhas, metragem ou valor total. Pode citar o preço por metro do catálogo.
2. NUNCA prometa prazo, desconto ou condição de pagamento — o PDF traz as opções e o vendedor confirma.
3. Quando o cliente disser que não quer mais nada, envie "maisProdutos": false.
4. Pergunte se quer só telhas ou telhas + estrutura → comEstrutura (true/false).
5. Endereço completo (rua, número, bairro) e cidade são OBRIGATÓRIOS. Sem eles não há orçamento.
6. Se pedir humano, fugir do assunto ou pedir algo que não vendemos → "handoff": true.
7. Foto enviada pelo cliente: agradeça e diga que fica anexada pro vendedor. NUNCA tire medidas de fotos.
8. Não invente dado técnico. Se não souber, diga que o vendedor confirma.

FOTOS: pode pedir o envio de imagens com "fotos": ["id1","id2"] (ids do catálogo, máx 4).

PRODUTOS JÁ NA FICHA: ${jaTem.length ? jaTem.join(' | ') : 'nenhum ainda'}
CLIENTE: ${JSON.stringify({ nome: ficha.cliente.nome, cidade: ficha.cliente.cidade, endereco: ficha.cliente.endereco })}
${ficha.clienteConhecido ? '⚠️ CLIENTE JÁ CADASTRADO: cumprimente pelo nome, NÃO peça nome/cidade/endereço de novo. Apenas confirme a entrega no mesmo endereço; só atualize se ele pedir para mudar.' : ''}
comEstrutura: ${ficha.pedido.comEstrutura} · maisProdutos: ${ficha.pedido.maisProdutos}

AINDA FALTA: ${falta.length ? falta.join(', ') : 'nada — ficha completa'}

RESPONDA APENAS JSON:
{"reply":"sua mensagem","campos":{...},"fotos":[],"handoff":false}
Campos possíveis: familiaFoco, novosProdutos (array, ver caminhos A/B), maisProdutos (bool), comEstrutura (bool), nome, cidade, endereco.
Envie em "novosProdutos" APENAS produtos ainda não listados acima.`
  );
}

/** Valida e aplica o que a IA extraiu — o CÓDIGO é o juiz, não a IA. */
function aplicarCampos(ficha, campos, catalogo, acoes) {
  if (!campos || typeof campos !== 'object') return;
  const p = ficha.pedido, c = ficha.cliente, eng = catalogo.engenharia;
  const okNum = (v, min, max) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;

  if (typeof campos.familiaFoco === 'string') {
    const fams = [...new Set(catalogo.telhas.map((t) => t.familia))];
    const m = fams.find((f) => f.toLowerCase() === campos.familiaFoco.toLowerCase().trim());
    if (m) p.familiaFoco = m;
  }
  if (typeof campos.maisProdutos === 'boolean') p.maisProdutos = campos.maisProdutos;
  if (typeof campos.comEstrutura === 'boolean') p.comEstrutura = campos.comEstrutura;

  // ── novos produtos ──────────────────────────────────────────────
  p.grupos = p.grupos || [];
  for (const np of (Array.isArray(campos.novosProdutos) ? campos.novosProdutos : [])) {
    const telha = catalogo.telhas.find((t) => t.id === np.telhaId);
    if (!telha) continue;

    // caminho A — cortes informados
    if (Array.isArray(np.cortes) && np.cortes.length) {
      const validos = np.cortes
        .map((x) => ({ comprimentoM: Number(x.comprimentoM), quantidade: Math.floor(Number(x.quantidade)) }))
        .filter((x) => okNum(x.comprimentoM, eng.comprimento_minimo_fabricacao_m, 30) && okNum(x.quantidade, 1, 500));
      if (validos.length) {
        p.grupos.push({ telhaId: telha.id, nome: telha.nome, cortes: validos, ambiente: null });
        p.familiaFoco = null;
        p.maisProdutos = null; // volta a perguntar se tem mais
      }
      continue;
    }

    // caminho B — ambiente: o CÓDIGO calcula o romaneio
    if (okNum(np.comprimentoGalpaoM, 1, 500) && okNum(np.larguraGalpaoM, 1, 200) &&
        (np.quedas === 1 || np.quedas === 2)) {
      try {
        const rom = calcularRomaneio({
          comprimentoGalpaoM: Number(np.comprimentoGalpaoM),
          larguraGalpaoM: Number(np.larguraGalpaoM),
          quedas: np.quedas, comEstrutura: false,
        }, telha, catalogo);
        p.grupos.push({
          telhaId: telha.id, nome: telha.nome, cortes: rom.cortes,
          ambiente: { comprimentoGalpaoM: Number(np.comprimentoGalpaoM), larguraGalpaoM: Number(np.larguraGalpaoM), quedas: np.quedas },
        });
        p.memoriaCalculo = (p.memoriaCalculo || []).concat(rom.memoria);
        p.familiaFoco = null;
        p.maisProdutos = null;
        const linhas = rom.cortes.map((x) => `• ${x.quantidade} peças de ${x.comprimentoM}m`).join('\n');
        acoes.push({ type: 'text', text: `📐 *${telha.nome}* — calculei:\n\n${linhas}` });
        if (rom.avisos.length) acoes.push({ type: 'text', text: '⚠️ ' + rom.avisos.join('\n⚠️ ') });
        if (rom.escalarParaVendedor) acoes.push({ type: 'handoff', motivo: 'Caso fora do padrão no cálculo' });
      } catch (e) {
        acoes.push({ type: 'text', text: `Não consegui calcular a ${telha.nome} com essas medidas 😕` });
        acoes.push({ type: 'handoff', motivo: 'Erro no romaneio: ' + e.message });
      }
    }
  }

  if (typeof campos.nome === 'string' && campos.nome.trim().length >= 2) c.nome = campos.nome.trim();
  if (typeof campos.cidade === 'string' && campos.cidade.trim().length >= 2) c.cidade = campos.cidade.trim();
  if (typeof campos.endereco === 'string' && campos.endereco.trim().length >= 8 && /\d/.test(campos.endereco)) {
    c.endereco = campos.endereco.trim();
  }
}

/** Resumo montado pelo CÓDIGO com dados já validados. */
function resumoConfirmacao(ficha) {
  const linhas = ficha.pedido.grupos.map((g, i) =>
    `*${i + 1}. ${g.nome}*\n` + g.cortes.map((c) => `   • ${c.quantidade} x ${c.comprimentoM}m`).join('\n')
  ).join('\n');
  const met = ficha.pedido.grupos.reduce((s, g) => s + metrosDe(g.cortes), 0);
  return (
    `✅ *Confere pra mim, ${ficha.cliente.nome}?*\n\n${linhas}\n\n` +
    `*Metragem total:* ${met.toFixed(3)} mts\n` +
    `*Estrutura:* ${ficha.pedido.comEstrutura ? 'sim' : 'não'}\n` +
    `*Entrega:* ${ficha.cliente.endereco} — ${ficha.cliente.cidade}\n\n` +
    `Posso gerar o orçamento em PDF? (*sim* / *não*)`
  );
}

async function coletar(ficha, texto, catalogo) {
  const acoes = [];
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

  if (r.reply) ficha.historico.push({ role: 'assistant', content: r.reply });
  aplicarCampos(ficha, r.campos, catalogo, acoes);

  if (Array.isArray(r.fotos)) {
    for (const id of r.fotos.slice(0, 4)) {
      const prod = catalogo.telhas.find((t) => t.id === id);
      if (prod && prod.imagem) acoes.push({ type: 'image', url: prod.imagem, caption: prod.nome });
    }
  }

  if (r.handoff) {
    acoes.push({ type: 'handoff', motivo: 'Solicitado na conversa (IA)' });
    acoes.push({ type: 'text', text: r.reply || 'Vou te passar pra um vendedor, só um instante 👍' });
    return { acoes, confirmar: false, humano: true };
  }

  // estrutura pedida: calcula os perfis com base no maior corte e no vão mais restritivo
  const p = ficha.pedido;
  if (p.comEstrutura && !p.perfis && p.grupos?.length) {
    const comAmb = p.grupos.find((g) => g.ambiente);
    if (comAmb) {
      const perfil = (catalogo.perfis || []).find((x) => x.tipo === 'terca');
      if (perfil) {
        let maior = 0, vaoMax = Infinity;
        for (const g of p.grupos) {
          const t = catalogo.telhas.find((x) => x.id === g.telhaId);
          maior = Math.max(maior, ...g.cortes.map((c) => c.comprimentoM));
          vaoMax = Math.min(vaoMax, t.vao_maximo_m || catalogo.engenharia.vao_maximo_terca_padrao_m);
        }
        const tercas = Math.ceil(maior / vaoMax) + 1;
        const metros = Math.round(tercas * comAmb.ambiente.comprimentoGalpaoM * 100) / 100;
        p.perfis = [{ perfilId: perfil.id, metros }];
        acoes.push({ type: 'text', text: `🔧 Estrutura: ${tercas} terças → *${metros}m* de ${perfil.nome}.` });
      }
    }
  }

  if (!faltantes(ficha).length) {
    if (r.reply) acoes.push({ type: 'text', text: r.reply });
    acoes.push({ type: 'text', text: resumoConfirmacao(ficha) });
    return { acoes, confirmar: true };
  }

  acoes.push({ type: 'text', text: r.reply || 'Pode me contar mais sobre o que você precisa?' });
  return { acoes, confirmar: false };
}

module.exports = { coletar };
