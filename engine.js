/**
 * MOTOR DE CÁLCULO — 100% determinístico. Nenhuma IA toca aqui.
 *
 * Modelo de negócio (extraído do orçamento real 4A nº 11247):
 *   - Telha é vendida SOB MEDIDA: o pedido é uma LISTA DE CORTES (romaneio).
 *   - Um orçamento pode ter VÁRIOS PRODUTOS, cada um com sua própria lista
 *     (ex: fábrica com TP40 em 6 comprimentos + translúcida + sanduíche).
 *   - Preço é POR METRO LINEAR (a empresa rotula "M²" — convenção do setor).
 *   - Subtotal da linha = quantidade x comprimento x preço.
 *   - "Metragem total" = Σ (quantidade x comprimento), em metros lineares.
 *
 * Conferido contra o orçamento real: 8 linhas, 37 peças, 134,390 mts, R$ 4.502,07.
 */
const money = (v) => Math.round(v * 100) / 100;
const m3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {object} pedido
 *   {
 *     grupos: [                                   // vários produtos por orçamento
 *       { telhaId: 'TL-GV-TP40-980', cortes: [{ comprimentoM: 4.0, quantidade: 3 }, ...] },
 *       { telhaId: 'TL-TRANS-ISOLUZ', cortes: [...] }
 *     ],
 *     perfis: [{ perfilId: 'PF-CAIBRO-AB', metros: 120 }]   // opcional (estrutura)
 *   }
 *   (aceita também o formato antigo { telhaId, cortes } — vira um grupo só)
 * @param {object} catalogo
 * @returns {object} { itens, metragemTotal, totalPecas, totalAvista, pagamentos, resumoPorProduto, avisos, escalarParaVendedor }
 */
function calcularOrcamento(pedido, catalogo) {
  const avisos = [];
  let escalarParaVendedor = false;

  // normaliza: formato antigo (um produto) → grupos
  const grupos = Array.isArray(pedido.grupos) && pedido.grupos.length
    ? pedido.grupos
    : [{ telhaId: pedido.telhaId, cortes: pedido.cortes }];

  if (!grupos.length) throw new Error('Nenhum produto informado.');

  const eng = catalogo.engenharia;
  const itens = [];
  const resumoPorProduto = [];
  let metragemTotal = 0;
  let totalPecas = 0;

  // ── 1) Telhas sob medida — um bloco de linhas por produto ─────────
  for (const g of grupos) {
    const telha = catalogo.telhas.find((t) => t.id === g.telhaId);
    if (!telha) throw new Error(`Telha inválida: ${g.telhaId}`);

    const cortes = Array.isArray(g.cortes) ? g.cortes : [];
    if (!cortes.length) throw new Error(`Nenhum corte informado para ${telha.nome}.`);

    let metrosProduto = 0;
    let pecasProduto = 0;

    for (const c of cortes) {
      const comp = Number(c.comprimentoM);
      const qtd = Math.floor(Number(c.quantidade));
      if (!Number.isFinite(comp) || comp <= 0) throw new Error(`Comprimento inválido: ${c.comprimentoM}`);
      if (!Number.isFinite(qtd) || qtd <= 0) throw new Error(`Quantidade inválida: ${c.quantidade}`);

      const compMax = telha.comprimento_maximo_m || eng.comprimento_maximo_fabricacao_m;
      if (comp > compMax) {
        avisos.push(`${telha.nome}: comprimento de ${comp.toFixed(2)}m excede o máximo de fabricação (${compMax}m) — emendar ou consultar o vendedor.`);
        escalarParaVendedor = true;
      }
      if (comp < eng.comprimento_minimo_fabricacao_m) {
        avisos.push(`${telha.nome}: comprimento de ${comp.toFixed(2)}m abaixo do mínimo (${eng.comprimento_minimo_fabricacao_m}m).`);
        escalarParaVendedor = true;
      }

      const metros = m3(qtd * comp);
      metrosProduto = m3(metrosProduto + metros);
      pecasProduto += qtd;

      itens.push({
        codigo: telha.codigo || telha.id,
        nome: `${telha.codigo ? telha.codigo + ' - ' : ''}${telha.nome} ( Larg. X ${comp.toFixed(3)} Alt.)`,
        imagem: telha.imagem || null,
        unidade: telha.unidade || 'M²',
        qtd,
        comprimentoM: comp,
        precoUnit: money(telha.preco),
        subtotal: money(metros * telha.preco),
      });
    }

    metragemTotal = m3(metragemTotal + metrosProduto);
    totalPecas += pecasProduto;
    resumoPorProduto.push({
      telhaId: telha.id,
      nome: telha.nome,
      pecas: pecasProduto,
      metros: metrosProduto,
      subtotal: money(metrosProduto * telha.preco),
    });
  }

  // ── 2) Perfis/estrutura — OPCIONAL (cliente pode querer só a telha) ──
  for (const p of (pedido.perfis || [])) {
    const perfil = (catalogo.perfis || []).find((x) => x.id === p.perfilId);
    if (!perfil) throw new Error(`Perfil inválido: ${p.perfilId}`);

    if (perfil.unidade === 'UN') {
      const qtd = Math.ceil(Number(p.quantidade) || 0);
      if (qtd <= 0) continue;
      itens.push({
        codigo: perfil.codigo || perfil.id, nome: perfil.nome, imagem: null,
        unidade: 'UN', qtd, comprimentoM: null,
        precoUnit: money(perfil.preco), subtotal: money(qtd * perfil.preco),
      });
    } else {
      const metros = Number(p.metros) || 0;
      if (metros <= 0) continue;
      const barra = perfil.barra_m || eng.barra_perfil_m;
      const barras = Math.ceil(metros / barra);
      const metrosFaturados = m3(barras * barra);
      itens.push({
        codigo: perfil.codigo || perfil.id,
        nome: `${perfil.nome} (${barras} barra${barras > 1 ? 's' : ''} de ${barra}m)`,
        imagem: null, unidade: 'M', qtd: metrosFaturados, comprimentoM: null,
        precoUnit: money(perfil.preco), subtotal: money(metrosFaturados * perfil.preco),
      });
    }
  }

  // ── 3) Totais e limites de autoatendimento ────────────────────────
  const totalAvista = money(itens.reduce((s, i) => s + i.subtotal, 0));

  const r = catalogo.regras;
  if (metragemTotal > r.metragem_maxima_autoatendimento_m) {
    avisos.push(`Metragem acima de ${r.metragem_maxima_autoatendimento_m}m — encaminhar ao vendedor.`);
    escalarParaVendedor = true;
  }
  if (totalPecas > r.quantidade_maxima_pecas) {
    avisos.push(`Quantidade acima de ${r.quantidade_maxima_pecas} peças — encaminhar ao vendedor.`);
    escalarParaVendedor = true;
  }

  // ── 4) Formas de pagamento (acréscimo cadastrado, nunca inventado) ─
  const pagamentos = (catalogo.pagamento?.opcoes || []).map((o) => {
    const total = money(totalAvista * (1 + o.acrescimo_pct / 100));
    return {
      parcelas: o.parcelas,
      descricao: o.descricao,
      total,
      valorParcela: money(total / o.parcelas),
    };
  });

  return {
    itens, metragemTotal, totalPecas, totalAvista,
    pagamentos, resumoPorProduto, avisos, escalarParaVendedor,
  };
}

module.exports = { calcularOrcamento };
