/**
 * MÓDULO DE ENGENHARIA — converte o AMBIENTE (dimensões do telhado) em
 * LISTA DE CORTES (romaneio de telhas) e, opcionalmente, na estrutura (perfis).
 *
 * ⚠️ PRINCÍPIO: este módulo só APLICA regras cadastradas no catálogo
 * (largura útil, beiral, inclinação mínima, vão máximo, comprimento máximo).
 * Ele NUNCA inventa valor técnico. Se o caso sai do padrão, devolve aviso e
 * marca para o vendedor — quem define os parâmetros é o responsável técnico
 * da empresa, no catalogo.json.
 *
 * Convenção de medidas:
 *   comprimentoGalpaoM = dimensão paralela à cumeeira (sentido da largura das telhas)
 *   larguraGalpaoM     = dimensão perpendicular (sentido do comprimento das telhas)
 */

const round = (v, casas = 2) => {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
};

/**
 * OPÇÕES DE DIVISÃO (emenda por transpasse).
 * Quando a água é mais longa que o comprimento máximo de fabricação, a telha
 * NÃO é recusada: ela é dividida em panos que se sobrepõem (transpasse
 * longitudinal). Cada emenda consome transpasse extra de material.
 *
 * Com N panos:  soma dos panos = comprimento da água + (N-1) x transpasse
 * Menor N possível:  N >= (comp - transpasse) / (máximo - transpasse)
 *
 * Devolve até 3 planos para o cliente escolher.
 */
function opcoesDeCorte(comprimentoAgua, telha, catalogo) {
  const eng = catalogo.engenharia;
  const max = telha.comprimento_maximo_m || eng.comprimento_maximo_fabricacao_m;
  const tr = eng.transpasse_longitudinal_m;
  const comp = round(comprimentoAgua, 2);

  // cabe em uma peça só
  if (comp <= max) {
    return [{
      id: 'unica', panos: [comp], emendas: 0, materialM: comp,
      titulo: `Peça única de ${comp.toFixed(2)}m`,
      detalhe: 'Sem emendas — melhor vedação.',
    }];
  }

  const nMin = Math.max(2, Math.ceil((comp - tr) / (max - tr)));
  const opcoes = [];
  const addOpcao = (id, panos, titulo, detalhe) => {
    const materialM = round(panos.reduce((s, p) => s + p, 0), 2);
    if (panos.some((p) => p > max + 0.001 || p < eng.comprimento_minimo_fabricacao_m)) return;
    if (opcoes.some((o) => o.materialM === materialM && o.panos.length === panos.length)) return;
    opcoes.push({ id, panos, emendas: panos.length - 1, materialM, titulo, detalhe });
  };

  // 1) panos iguais no menor número de emendas
  const iguais = round((comp + (nMin - 1) * tr) / nMin, 2);
  addOpcao('iguais', Array(nMin).fill(iguais),
    `${nMin} peças iguais de ${iguais.toFixed(2)}m`,
    `${nMin - 1} emenda(s) · peças do mesmo tamanho, montagem mais simples.`);

  // 2) peças no comprimento máximo + complemento (menos recortes de bobina)
  const totalMaterial = round(comp + (nMin - 1) * tr, 2);
  const cheias = nMin - 1;
  const resto = round(totalMaterial - cheias * max, 2);
  if (cheias >= 1 && resto >= eng.comprimento_minimo_fabricacao_m && resto <= max) {
    addOpcao('maximo', [...Array(cheias).fill(max), resto],
      `${cheias} peça(s) de ${max.toFixed(2)}m + 1 de ${resto.toFixed(2)}m`,
      `${nMin - 1} emenda(s) · aproveita o comprimento máximo de fábrica.`);
  }

  // 3) mais panos, peças menores (transporte e manuseio mais fáceis)
  const n2 = nMin + 1;
  const iguais2 = round((comp + (n2 - 1) * tr) / n2, 2);
  addOpcao('menores', Array(n2).fill(iguais2),
    `${n2} peças de ${iguais2.toFixed(2)}m`,
    `${n2 - 1} emendas · peças curtas, mais fáceis de transportar e içar.`);

  return opcoes;
}

/**
 * DIVISÃO COM TAMANHO ESCOLHIDO PELO CLIENTE.
 * Ex.: precisa de 20,20m e quer peças de 10m → 2 de 10m + 1 de 0,60m.
 *
 * Com k peças do tamanho preferido (P) mais um complemento (r):
 *   cobertura = k·P + r − k·transpasse  →  r = comprimento − k·(P − transpasse)
 * Procuramos o menor k em que o complemento caiba entre o mínimo de fábrica e P.
 */
function corteComTamanho(comprimentoAgua, preferidoM, telha, catalogo) {
  const eng = catalogo.engenharia;
  const max = telha.comprimento_maximo_m || eng.comprimento_maximo_fabricacao_m;
  const tr = eng.transpasse_longitudinal_m;
  const comp = round(comprimentoAgua, 2);
  const P = round(Number(preferidoM), 2);

  if (!(P > 0)) return { erro: 'Informe um tamanho válido.' };
  if (P > max) return { erro: `Esta telha é fabricada até ${max}m — escolha um tamanho menor.` };
  if (P <= tr) return { erro: `O tamanho precisa ser maior que o transpasse (${tr}m).` };
  if (comp <= P) {
    return {
      id: 'personalizado', panos: [comp], emendas: 0, materialM: comp,
      titulo: `Peça única de ${comp.toFixed(2)}m`,
      detalhe: 'Não precisa emendar — cabe numa peça só.',
    };
  }

  for (let k = 1; k <= 200; k++) {
    // k peças inteiras já cobrem tudo?
    const cobertura = k * P - (k - 1) * tr;
    if (cobertura >= comp - 0.001) {
      return {
        id: 'personalizado', panos: Array(k).fill(P), emendas: k - 1,
        materialM: round(k * P, 2),
        titulo: `${k} peças de ${P.toFixed(2)}m`,
        detalhe: `${k - 1} emenda(s) · no tamanho que você escolheu.`,
      };
    }
    // k peças inteiras + complemento
    const r = round(comp - k * (P - tr), 2);
    if (r >= eng.comprimento_minimo_fabricacao_m && r <= P) {
      return {
        id: 'personalizado', panos: [...Array(k).fill(P), r], emendas: k,
        materialM: round(k * P + r, 2),
        titulo: `${k} peça(s) de ${P.toFixed(2)}m + 1 de ${r.toFixed(2)}m`,
        detalhe: `${k} emenda(s) · completa os ${comp.toFixed(2)}m no seu tamanho.`,
      };
    }
  }
  return { erro: 'Não consegui fechar a medida com esse tamanho — tente outro.' };
}

/**
 * @param {object} ambiente
 *   { comprimentoGalpaoM, larguraGalpaoM, quedas: 1|2, inclinacaoPct?, comEstrutura?: bool }
 * @param {object} telha  item do catálogo
 * @param {object} catalogo
 * @returns {object} { cortes, perfis, memoria, avisos, escalarParaVendedor }
 */
function calcularRomaneio(ambiente, telha, catalogo) {
  const eng = catalogo.engenharia;
  const avisos = [];
  const memoria = []; // rastro do cálculo (auditoria)
  let escalarParaVendedor = false;

  const L = Number(ambiente.comprimentoGalpaoM); // paralelo à cumeeira
  const W = Number(ambiente.larguraGalpaoM);     // perpendicular
  const quedas = Number(ambiente.quedas) === 2 ? 2 : 1;

  if (!Number.isFinite(L) || L <= 0) throw new Error('Comprimento do galpão inválido.');
  if (!Number.isFinite(W) || W <= 0) throw new Error('Largura do galpão inválida.');

  // ── Inclinação ────────────────────────────────────────────────────
  const inclPct = Number(ambiente.inclinacaoPct) || telha.inclinacao_minima_pct || eng.inclinacao_padrao_pct;
  if (inclPct < telha.inclinacao_minima_pct) {
    avisos.push(`Inclinação de ${inclPct}% é menor que a mínima da ${telha.nome} (${telha.inclinacao_minima_pct}%). Risco de infiltração — confirmar com o vendedor.`);
    escalarParaVendedor = true;
  }
  // fator de inclinação: hipotenusa / projeção horizontal
  const fatorIncl = Math.sqrt(1 + Math.pow(inclPct / 100, 2));

  // ── ACRÉSCIMO DE MATERIAL PARA 2 ÁGUAS ────────────────────────────
  // Regra da empresa: telhado de 2 águas leva 30% a mais no COMPRIMENTO DA
  // TELHA — cobre caimento, transpasses e sobras de corte. Substitui o fator
  // de inclinação: somar os dois contaria o caimento duas vezes.
  //
  // ⚠️ Vale SÓ para a telha. Conferido contra o orçamento 12x6 de 2 águas:
  // cumeeira 12 un (= comprimento puro) e frontal 24 un (= comprimento x 2).
  // Se o acréscimo entrasse neles, sairiam 16 e 32.
  // O acabamento LATERAL acompanha a telha porque corre ao lado dela — então
  // recebe o acréscimo por tabela, via compTelha, não por regra própria.
  // Cadastrado em engenharia.acrescimo_2_quedas_pct.
  const pctAcrescimo = Number(eng.acrescimo_2_quedas_pct);
  const acresce = quedas === 2 && Number.isFinite(pctAcrescimo) && pctAcrescimo > 0;
  const fatorMaterial = acresce ? 1 + pctAcrescimo / 100 : 1;

  memoria.push(acresce
    ? `2 águas: acréscimo de ${pctAcrescimo}% no comprimento da telha (fator ${round(fatorMaterial, 4)})`
    : `Inclinação ${inclPct}% → fator ${round(fatorIncl, 4)}`);

  // ── Comprimento da telha (sentido da água) ────────────────────────
  const projecao = quedas === 2 ? W / 2 : W;
  const compGeo = round(projecao * (acresce ? 1 : fatorIncl) + eng.beiral_m, 2);
  const compTelha = round(compGeo * fatorMaterial, 2);
  memoria.push(`${quedas} água(s): projeção ${round(projecao, 2)}m + beiral ${eng.beiral_m}m = ${compGeo}m` +
    (acresce ? ` → com acréscimo: ${compTelha}m` : ''));

  const compMax = telha.comprimento_maximo_m || eng.comprimento_maximo_fabricacao_m;
  const cortes = [];

  // ── Quantidade de peças por água ──────────────────────────────────
  // ⚠️ CRÍTICO: largura ÚTIL (já com recobrimento lateral descontado), NUNCA a total.
  // Este dado NÃO vem do ERP (lá existe só dentro do nome do produto, como texto) —
  // ele é engenharia e vive no nosso catálogo. Sem ele, não calculamos.
  const larguraUtil = Number(telha.largura_util_m);
  if (!Number.isFinite(larguraUtil) || larguraUtil <= 0) {
    throw new Error(
      `Largura útil não cadastrada para "${telha.nome}" (id ${telha.id}). ` +
      `Dado técnico não cadastrado — cadastre largura_util_m no catálogo antes de calcular.`
    );
  }
  if (telha.largura_total_m && larguraUtil >= telha.largura_total_m) {
    avisos.push(`Cadastro suspeito em "${telha.nome}": largura útil (${larguraUtil}m) deveria ser MENOR que a total (${telha.largura_total_m}m). Conferir catálogo.`);
    escalarParaVendedor = true;
  }
  const pecasPorAgua = Math.ceil(round(L / larguraUtil, 4));
  memoria.push(`Peças por água: ${L}m ÷ largura útil ${larguraUtil}m = ${pecasPorAgua} peças`);

  const totalPecas = pecasPorAgua * quedas;

  // ── Divisão em panos quando a água passa do comprimento de fábrica ──
  const opcoes = opcoesDeCorte(compTelha, telha, catalogo);
  if (!opcoes.length) {
    avisos.push(`Não foi possível resolver o comprimento de ${compTelha}m dentro do limite de ${compMax}m — orçamento com o vendedor.`);
    escalarParaVendedor = true;
  }
  // tamanho preferido pelo cliente entra como opção adicional
  if (ambiente.tamanhoPreferidoM) {
    const custom = corteComTamanho(compTelha, ambiente.tamanhoPreferidoM, telha, catalogo);
    if (custom && !custom.erro) opcoes.unshift(custom);
  }
  // aplica a opção escolhida (ou a primeira, que é a de menos emendas)
  const escolhida = opcoes.find((o) => o.id === ambiente.opcaoCorte) || opcoes[0];
  if (escolhida) {
    // agrupa panos de mesmo comprimento numa única linha do romaneio
    const contagem = new Map();
    for (const p of escolhida.panos) contagem.set(p, (contagem.get(p) || 0) + 1);
    for (const [comprimentoM, vezes] of contagem) {
      cortes.push({ comprimentoM, quantidade: totalPecas * vezes });
    }
    if (escolhida.emendas > 0) {
      memoria.push(`Água de ${compTelha}m > máx ${compMax}m → ${escolhida.titulo} (transpasse ${eng.transpasse_longitudinal_m}m, ${escolhida.emendas} emenda(s), ${escolhida.materialM}m de material por peça)`);
      avisos.push(`Telhado com ${compTelha}m de água: será emendado — ${escolhida.titulo.toLowerCase()}, com transpasse de ${eng.transpasse_longitudinal_m}m.`);
    }
  }

  // ── Estrutura (OPCIONAL — cliente pode querer só a telha) ─────────
  const perfis = [];
  if (ambiente.comEstrutura) {
    const vaoMax = telha.vao_maximo_m || eng.vao_maximo_terca_padrao_m;
    // terças correm paralelas à cumeeira; nº por água = vãos + 1.
    // Usa o comprimento REAL da telha — é ela que precisa de apoio.
    const tercasPorAgua = Math.ceil(round(compTelha / vaoMax, 4)) + 1;
    const metrosTerca = round(tercasPorAgua * quedas * L, 2);
    memoria.push(`Terças: ${compTelha}m ÷ vão máx ${vaoMax}m + 1 = ${tercasPorAgua} por água → ${metrosTerca}m lineares`);

    const terca = (catalogo.perfis || []).find((p) => p.tipo === 'terca');
    if (terca) {
      perfis.push({ perfilId: terca.id, metros: metrosTerca });
    } else {
      avisos.push('Perfil de terça não cadastrado no catálogo — estrutura não orçada.');
    }

    // vigas de apoio das terças, quando o vão do galpão exige
    const viga = (catalogo.perfis || []).find((p) => p.tipo === 'viga');
    if (viga && W > (viga.vao_maximo_m || 6)) {
      avisos.push(`Vão de ${W}m acima do padrão da ${viga.nome} (${viga.vao_maximo_m}m) — dimensionamento estrutural com o vendedor/engenheiro.`);
      escalarParaVendedor = true;
    }
  }

  // ── Acabamentos pelo PERÍMETRO do telhado ─────────────────────────
  // SEM o acréscimo de 2 águas: cumeeira e frontal seguem a planta, não a
  // água. A lateral acompanha a telha e por isso recebe compTelha.
  const { complementos, perimetro } = complementosPorPerimetro(L, compTelha, quedas, catalogo, telha);
  memoria.push(`Perímetro: frontal ${perimetro.frontalM}m · lateral ${perimetro.lateralM}m · cumeeira ${perimetro.cumeeiraM}m`);

  return {
    cortes, perfis, complementos, perimetro, memoria, avisos, escalarParaVendedor,
    compTelha, totalPecas,
    opcoes,                                   // planos de divisão disponíveis
    opcaoAplicada: escolhida ? escolhida.id : null,
    precisaEscolher: opcoes.length > 1,       // front pode oferecer a escolha
  };
}

/**
 * ACABAMENTOS PELO PERÍMETRO — serve para os dois caminhos: quando o sistema
 * calculou o romaneio, e quando o cliente trouxe a lista de cortes pronta e
 * depois informou as medidas do galpão.
 *
 *   frontal  = beiral de cada água         → L x nº de águas
 *   lateral  = as duas bordas de cada água → comprimento da telha x 2 x nº de águas
 *   cumeeira = encontro das águas no topo  → L (só em 2 águas)
 *
 * @param {object} [telha] quando informada, só entram os acabamentos
 *   VINCULADOS a ela (telha.compativeis.complementos). É isso que impede
 *   uma telha branca receber cumeeira galvalume.
 */
function complementosPorPerimetro(comprimentoGalpaoM, compTelhaM, quedas, catalogo, telha) {
  const L = Number(comprimentoGalpaoM) || 0;
  const c = Number(compTelhaM) || 0;
  const q = Number(quedas) === 2 ? 2 : 1;

  const perimetro = {
    frontalM: round(L * q, 2),
    lateralM: round(c * 2 * q, 2),
    cumeeiraM: q === 2 ? round(L, 2) : 0,
  };

  const complementos = [];
  for (const item of compativeisDaTelha(catalogo, telha, 'complementos')) {
    let metros = 0;
    if (item.aplica_em === 'frontal') metros = perimetro.frontalM;
    else if (item.aplica_em === 'lateral') metros = perimetro.lateralM;
    else if (item.aplica_em === 'cumeeira') metros = perimetro.cumeeiraM;
    else continue;                                  // 'interno' e outros: sob demanda
    if (metros > 0) complementos.push({ produtoId: item.id, metros, nome: item.nome, sugerido: true });
  }
  return { complementos, perimetro };
}

/**
 * ITENS QUE PODEM ACOMPANHAR UMA TELHA.
 *
 * Cada telha tem sua lista de acabamentos e perfis compatíveis, cadastrada
 * em `telha.compativeis`. Sem esse vínculo, uma telha branca acabava
 * recebendo cumeeira galvalume — o código pegava qualquer item ativo do
 * tipo certo.
 *
 * Telha SEM vínculo cadastrado continua vendo tudo que está ativo. É o
 * comportamento antigo, de propósito: catálogo velho não quebra ao subir
 * a versão nova.
 *
 * @param {'complementos'|'perfis'} quais
 */
function compativeisDaTelha(catalogo, telha, quais) {
  const todos = (catalogo[quais] || []).filter((x) => x.ativo !== false);
  const vinculo = telha && telha.compativeis && telha.compativeis[quais];
  if (!Array.isArray(vinculo)) return todos;             // sem vínculo: tudo
  return todos.filter((x) => vinculo.indexOf(x.id) >= 0);
}

/**
 * ESTRUTURA (terças) a partir do maior corte e do comprimento do galpão.
 * Mesma regra do WhatsApp: nº de terças = maior corte ÷ vão máximo + 1.
 */
function calcularEstruturaPerfis(maiorCorteM, comprimentoGalpaoM, telhas, catalogo, perfilId) {
  // respeita o vínculo da telha: perfil não compatível não entra sozinho
  const ativos = compativeisDaTelha(catalogo, telhas && telhas[0], 'perfis');
  // com id, usa exatamente o perfil pedido (pode ser viga, ripa, etc.)
  const perfil = ativos.find((p) => p.id === perfilId)
    || ativos.find((p) => p.tipo === 'terca');
  if (!perfil) return { perfis: [], descricao: 'Perfil de terça não cadastrado — estrutura não incluída.' };

  const vaoMax = Math.min(...telhas.map((t) => t.vao_maximo_m || catalogo.engenharia.vao_maximo_terca_padrao_m));
  const tercas = Math.ceil(Number(maiorCorteM) / vaoMax) + 1;
  const metros = round(tercas * Number(comprimentoGalpaoM), 2);
  return {
    perfis: [{ perfilId: perfil.id, metros }],
    descricao: `${tercas} terças de ${comprimentoGalpaoM}m → ${metros}m de ${perfil.nome}`,
  };
}

/**
 * Parser de lista de cortes em texto livre (caminho do cliente técnico).
 * Aceita: "3 de 4m, 9 de 4,75, 5x6.20" → [{comprimentoM, quantidade}]
 * Determinístico — não usa IA.
 */
function parseCortes(texto) {
  const out = [];
  const t = String(texto || '').replace(/,(\d)/g, '.$1'); // 4,75 → 4.75
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
  calcularRomaneio, parseCortes, opcoesDeCorte, corteComTamanho,
  complementosPorPerimetro, calcularEstruturaPerfis, compativeisDaTelha,
};
