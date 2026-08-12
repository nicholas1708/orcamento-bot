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
  // sem "tamanhos sugeridos": o comprimento é livre, só o máximo limita
  const tam = () => '';
  if (todas.length <= LIMITE_TELHAS_NO_PROMPT) {
    return 'TELHAS:\n' + todas.map((t) =>
      `- id "${t.id}": ${t.nome} — ${fmt(t.preco)}/metro (largura útil ${t.largura_util_m}m, máx ${t.comprimento_maximo_m}m)${tam(t)}`
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
    `- id "${t.id}": ${t.nome} — ${fmt(t.preco)}/metro · largura útil ${t.largura_util_m}m · máx ${t.comprimento_maximo_m}m${tam(t)} · ${Object.entries(t.atributos || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}`
  ).join('\n');
}

function faltantes(ficha) {
  const p = ficha.pedido, c = ficha.cliente;
  const f = [];
  const temTelha = Array.isArray(p.grupos) && p.grupos.length;
  const temAvulso = (p.complementos || []).length || (p.perfis || []).length;
  // telha NÃO é obrigatória: dá pra fechar só com acabamento/parafuso/perfil
  if (!temTelha && !temAvulso) f.push('pelo menos um produto (grupos ou avulsos)');
  if (temTelha && p.maisProdutos !== false) f.push('confirmar se há MAIS algum tipo de telha (campo maisProdutos: false quando o cliente disser que acabou)');
  if (temTelha && (p.comAcabamento === null || p.comAcabamento === undefined)) f.push('comAcabamento (true/false) — se leva cumeeira, acabamentos e parafusos');
  if (temTelha && (p.comEstrutura === null || p.comEstrutura === undefined)) f.push('comEstrutura (true/false)');
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

VENDIDOS AVULSOS (o cliente pode levar SÓ isso, sem telha nenhuma):
${[...(catalogo.complementos || []).filter((c) => c.ativo !== false),
   ...(catalogo.perfis || []).filter((p) => p.ativo !== false)]
  .map((x) => `- id "${x.id}": ${x.nome} — ${fmt(x.preco)} ${x.venda_por === 'metro' || x.unidade === 'M' ? 'por metro' : 'a peça'}`)
  .join('\n') || '- nada cadastrado'}

COMO FUNCIONA: a telha é cortada no comprimento pedido e o preço é POR METRO LINEAR.
UM ORÇAMENTO PODE TER VÁRIOS PRODUTOS — é comum (galpão/fábrica) usar um modelo em vários comprimentos e ainda combinar com translúcida ou sanduíche. Colete um produto de cada vez e SEMPRE pergunte se falta mais algum tipo antes de fechar.

Para cada produto existem dois caminhos:
 (A) cliente JÁ SABE os tamanhos → {"telhaId":"...","cortes":[{"comprimentoM":4.75,"quantidade":9}, ...]}
 (B) cliente NÃO SABE → peça as medidas e envie {"telhaId":"...","comprimentoGalpaoM":20,"larguraGalpaoM":10,"quedas":2}. O SISTEMA calcula o romaneio — você NÃO calcula.

TAMANHOS: a LARGURA é fixa de fábrica; o COMPRIMENTO o cliente escolhe livremente, em qualquer medida, inclusive quebrada (6,5m · 4,75m · 7,2m). NUNCA sugira uma lista de tamanhos nem diga que existem tamanhos padrão. O único limite é o comprimento máximo de cada telha — acima dele a peça precisa de emenda, e aí use o caminho (B) para o sistema montar o corte.

REGRAS INEGOCIÁVEIS:
1. NUNCA calcule quantidade de telhas, metragem ou valor total. Pode citar o preço por metro do catálogo.
2. NUNCA prometa prazo, desconto ou condição de pagamento — o PDF traz as opções e o vendedor confirma.
3. Quando o cliente disser que não quer mais nada, envie "maisProdutos": false.
4. Pergunte se leva os ACABAMENTOS E PARAFUSOS (cumeeira, frontal, lateral e parafusagem) → comAcabamento (true/false). O sistema calcula as quantidades.
5. Pergunte se quer só telhas ou telhas + estrutura → comEstrutura (true/false).
6. Endereço completo (rua, número, bairro) e cidade são OBRIGATÓRIOS. Sem eles não há orçamento.
7. Peça o CEP da obra → cep. É ele que mede a distância até a unidade mais próxima. Se o cliente não souber, siga sem o CEP.
8. Se pedir humano, fugir do assunto ou pedir algo que não vendemos → "handoff": true.
9. Foto enviada pelo cliente: agradeça e diga que fica anexada pro vendedor. NUNCA tire medidas de fotos.
10. Não invente dado técnico. Se não souber, diga que o vendedor confirma.

FOTOS: pode pedir o envio de imagens com "fotos": ["id1","id2"] (ids do catálogo, máx 4).

PRODUTOS JÁ NA FICHA: ${jaTem.length ? jaTem.join(' | ') : 'nenhum ainda'}
CLIENTE: ${JSON.stringify({ nome: ficha.cliente.nome, cidade: ficha.cliente.cidade, endereco: ficha.cliente.endereco })}
${ficha.clienteConhecido ? '⚠️ CLIENTE JÁ CADASTRADO: cumprimente pelo nome, NÃO peça nome/cidade/endereço de novo. Apenas confirme a entrega no mesmo endereço; só atualize se ele pedir para mudar.' : ''}
comEstrutura: ${ficha.pedido.comEstrutura} · comAcabamento: ${ficha.pedido.comAcabamento} · maisProdutos: ${ficha.pedido.maisProdutos}

AINDA FALTA: ${falta.length ? falta.join(', ') : 'nada — ficha completa'}

RESPONDA APENAS JSON:
{"reply":"sua mensagem","campos":{...},"fotos":[],"handoff":false}
Campos possíveis: familiaFoco, novosProdutos (array, ver caminhos A/B), avulsos (array), maisProdutos (bool), comAcabamento (bool), comEstrutura (bool), nome, cep, cidade, endereco.
Envie em "novosProdutos" APENAS produtos ainda não listados acima.
Pedido SEM TELHA (só parafuso, acabamento ou perfil) é permitido: use
"avulsos": [{"produtoId":"...","quantidade":12}] com os ids da lista de avulsos.
Nesse caso não pergunte sobre acabamentos nem estrutura — ele já escolheu item a item.`
  );
}

/** Valida e aplica o que a IA extraiu — o CÓDIGO é o juiz, não a IA. */
async function aplicarCampos(ficha, campos, catalogo, acoes) {
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
  if (typeof campos.comAcabamento === 'boolean') p.comAcabamento = campos.comAcabamento;

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

      // A largura é fixa; o comprimento é livre, limitado só pelo que a
      // máquina corta. Peça acima do máximo precisa de emenda — e emenda
      // quem calcula é o romaneio, pelo caminho B.
      const max = Number(telha.comprimento_maximo_m) || Number(eng.comprimento_maximo_fabricacao_m) || 12;
      const dentro = validos.filter((x) => x.comprimentoM <= max);
      const fora = validos.filter((x) => x.comprimentoM > max);

      if (fora.length) {
        acoes.push({ type: 'text', text:
          `📏 A *${telha.nome}* é cortada até *${String(max).replace('.', ',')}m* de fábrica.\n\n` +
          `${fora.map((x) => String(x.comprimentoM).replace('.', ',') + 'm').join(', ')} passa disso — ` +
          `dá pra fazer com emenda, mas aí preciso das medidas do local pra montar o corte certo.` });
      }
      if (dentro.length) {
        p.grupos.push({ telhaId: telha.id, nome: telha.nome, cortes: dentro, ambiente: null });
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

  // ── itens avulsos (pedido sem telha) ────────────────────────────
  for (const av of (Array.isArray(campos.avulsos) ? campos.avulsos : [])) {
    const qtd = Number(av.quantidade);
    if (!okNum(qtd, 0.01, 100000)) continue;

    const comp = (catalogo.complementos || []).find((x) => x.ativo !== false && x.id === av.produtoId);
    if (comp) {
      p.complementos = (p.complementos || []).filter((x) => x.produtoId !== comp.id);
      p.complementos.push({ produtoId: comp.id,
        quantidade: comp.venda_por === 'metro' ? qtd : Math.ceil(qtd) });
      continue;
    }
    const perfil = (catalogo.perfis || []).find((x) => x.ativo !== false && x.id === av.produtoId);
    if (perfil) {
      p.perfis = (p.perfis || []).filter((x) => x.perfilId !== perfil.id);
      p.perfis.push(perfil.unidade === 'UN'
        ? { perfilId: perfil.id, quantidade: Math.ceil(qtd) }
        : { perfilId: perfil.id, metros: qtd });
    }
  }

  if (typeof campos.nome === 'string' && campos.nome.trim().length >= 2) c.nome = campos.nome.trim();
  if (typeof campos.cidade === 'string' && campos.cidade.trim().length >= 2) c.cidade = campos.cidade.trim();
  if (typeof campos.endereco === 'string' && campos.endereco.trim().length >= 8 && /\d/.test(campos.endereco)) {
    c.endereco = campos.endereco.trim();
  }

  // CEP: o código consulta a base e preenche a cidade — a IA não adivinha
  if (typeof campos.cep === 'string') {
    const d = campos.cep.replace(/\D/g, '');
    if (d.length === 8 && d !== c.cep) {
      c.cep = d;
      const { cidadeDoCep } = require('./distancia');
      const info = await cidadeDoCep(d).catch(() => null);
      if (info) { c.cidade = `${info.cidade} - ${info.uf}`; c.estado = info.uf; }
    }
  }
}

/**
 * CONFERÊNCIA — a mesma lista do menu e da tela do site: tudo que vai no
 * orçamento, sem preço, com a opção de ajustar antes de gerar.
 * Montada pelo CÓDIGO, a partir de dados já validados.
 */
function conferencia(ficha, catalogo) {
  const { montarLista } = require('./lista');
  const R = require('./roteiro');
  const p = ficha.pedido;
  const r = montarLista(
    { grupos: p.grupos, complementos: p.complementos || [], perfis: p.perfis || [] },
    catalogo
  );
  p.linhas = r.linhas;
  return R.T.conferencia(ficha.cliente.nome, r.linhas, r.metragemTotal.toFixed(3)) +
    `\n\n📍 *Entrega:* ${ficha.cliente.endereco} — ${ficha.cliente.cidade}`;
}

/** Acabamentos e parafusos, quando o cliente aceitou levar junto. */
function aplicarAcabamentos(ficha, catalogo, acoes) {
  const { complementosSugeridos } = require('./lista');
  const p = ficha.pedido;
  if (!p.comAcabamento) { p.complementos = []; return; }
  if (p.complementos) return;                       // já resolvido

  const amb = (p.grupos || []).find((g) => g.ambiente)?.ambiente;
  const maiorCorte = (p.grupos || []).reduce(
    (m, g) => Math.max(m, ...g.cortes.map((c) => Number(c.comprimentoM) || 0)), 0);

  p.complementos = complementosSugeridos(
    amb ? amb.comprimentoGalpaoM : null, maiorCorte, amb ? amb.quedas : 2, catalogo);

  const nomes = p.complementos
    .map((c) => (catalogo.complementos || []).find((x) => x.id === c.produtoId)?.nome)
    .filter(Boolean);
  if (nomes.length) {
    acoes.push({ type: 'text', text: `✅ Acabamentos incluídos: ${nomes.join(', ')}.` });
  }
  if (!amb) {
    // sem as medidas do telhado só entra o que é calculado por m² (parafusos)
    acoes.push({ type: 'text', text:
      '_Cumeeira e acabamentos de borda dependem das medidas do telhado — ' +
      'se quiser que eu inclua, me diga o comprimento e quantas águas._' });
  }
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
  await aplicarCampos(ficha, r.campos, catalogo, acoes);

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
    aplicarAcabamentos(ficha, catalogo, acoes);
    acoes.push({ type: 'text', text: conferencia(ficha, catalogo) });
    return { acoes, confirmar: true };
  }

  acoes.push({ type: 'text', text: r.reply || 'Pode me contar mais sobre o que você precisa?' });
  return { acoes, confirmar: false };
}

module.exports = { coletar };
