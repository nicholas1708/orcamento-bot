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
  memoria.push(`Inclinação ${inclPct}% → fator ${round(fatorIncl, 4)}`);

  // ── Comprimento da telha (sentido da água) ────────────────────────
  const projecao = quedas === 2 ? W / 2 : W;
  let compTelha = projecao * fatorIncl + eng.beiral_m;
  compTelha = round(compTelha, 2);
  memoria.push(`${quedas} água(s): projeção ${round(projecao, 2)}m x fator + beiral ${eng.beiral_m}m → telha de ${compTelha}m`);

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

  if (compTelha > compMax) {
    // Precisa emendar: divide em dois panos com transpasse longitudinal
    const panos = Math.ceil(compTelha / compMax);
    const compCada = round((compTelha + (panos - 1) * eng.transpasse_longitudinal_m) / panos, 2);
    if (compCada > compMax) {
      avisos.push(`Não foi possível resolver o comprimento de ${compTelha}m dentro do limite de ${compMax}m — orçamento com o vendedor.`);
      escalarParaVendedor = true;
    }
    avisos.push(`Água de ${compTelha}m excede o máximo de ${compMax}m: dividida em ${panos} panos de ${compCada}m com transpasse de ${eng.transpasse_longitudinal_m}m.`);
    memoria.push(`Emenda: ${panos} panos de ${compCada}m por água`);
    cortes.push({ comprimentoM: compCada, quantidade: totalPecas * panos });
  } else {
    cortes.push({ comprimentoM: compTelha, quantidade: totalPecas });
  }

  // ── Estrutura (OPCIONAL — cliente pode querer só a telha) ─────────
  const perfis = [];
  if (ambiente.comEstrutura) {
    const vaoMax = telha.vao_maximo_m || eng.vao_maximo_terca_padrao_m;
    // terças correm paralelas à cumeeira; nº por água = vãos + 1
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

  return { cortes, perfis, memoria, avisos, escalarParaVendedor, compTelha, totalPecas };
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

module.exports = { calcularRomaneio, parseCortes };
