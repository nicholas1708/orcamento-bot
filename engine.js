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
 * PREÇO POR FAIXA DE METRAGEM (desconto por volume).
 * A fábrica cobra menos por metro conforme a quantidade sobe:
 *   até 50m² → 129,50 · 50-100 → 126,91 · 100-200 → 123,02 · acima de 200 → 120,73
 *
 * A base da faixa é configurável em regras.faixa_preco_por:
 *   "produto" (padrão) — vale a metragem daquele produto no orçamento
 *   "pedido"           — vale a metragem total do orçamento
 */
function precoDaFaixa(produto, metragemBase, catalogo) {
  const faixas = produto.faixas_preco;
  if (!Array.isArray(faixas) || !faixas.length) return { preco: produto.preco, faixa: null };
  const ordenadas = [...faixas].sort((a, b) => (a.ate_m2 ?? Infinity) - (b.ate_m2 ?? Infinity));

  let i = ordenadas.findIndex((x) => x.ate_m2 == null || metragemBase <= x.ate_m2);
  if (i < 0) i = ordenadas.length - 1;
  let f = ordenadas[i];
  let porProximidade = false;

  // TOLERÂNCIA: quase batendo a próxima faixa? Já concede o desconto.
  // Evita a situação chata de perder 5% por causa de 2 m².
  const tolPct = Number(catalogo?.regras?.faixa_tolerancia_pct);
  const limite = f.ate_m2;
  if (tolPct > 0 && limite != null) {
    const prox = ordenadas[i + 1];
    const minimoParaValer = limite * (1 - tolPct / 100);
    if (prox && prox.preco < f.preco && metragemBase >= minimoParaValer) {
      f = prox;
      porProximidade = true;
    }
  }
  return { preco: f.preco, faixa: f, porProximidade };
}

const rotuloFaixa = (f) => {
  if (!f) return null;
  if (f.ate_m2 == null) return 'acima da última faixa';
  return `até ${String(f.ate_m2).replace('.', ',')} m²`;
};

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
  let foraDaPromocao = false;
  let descontoOnline = false;      // faixa concedida por proximidade (regra do sistema)

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

  // ── 0) Pré-cálculo das metragens (necessário para a faixa de preço) ──
  const medidas = grupos.map((g) => {
    const telha = catalogo.telhas.find((t) => t.id === g.telhaId);
    if (!telha) throw new Error(`Telha inválida: ${g.telhaId}`);
    const cortes = Array.isArray(g.cortes) ? g.cortes : [];
    if (!cortes.length) throw new Error(`Nenhum corte informado para ${telha.nome}.`);
    const metros = m3(cortes.reduce((s, c) => s + (Number(c.quantidade) || 0) * (Number(c.comprimentoM) || 0), 0));
    return { telha, cortes, metros };
  });
  const metragemPedido = m3(medidas.reduce((s, x) => s + x.metros, 0));
  const baseFaixa = catalogo.regras?.faixa_preco_por === 'pedido' ? 'pedido' : 'produto';

  // ── 1) Telhas sob medida — um bloco de linhas por produto ─────────
  for (const { telha, cortes, metros: metrosDoProduto } of medidas) {
    // preço unitário conforme a faixa de metragem (desconto por volume)
    const { preco: precoUnit, faixa, porProximidade } = precoDaFaixa(
      telha, baseFaixa === 'pedido' ? metragemPedido : metrosDoProduto, catalogo
    );
    if (porProximidade) {
      descontoOnline = true;
      avisos.push(`${telha.nome}: desconto da faixa seguinte concedido por proximidade — condição exclusiva do orçamento online.`);
    }
    if (!Number.isFinite(precoUnit) || precoUnit <= 0) {
      throw new Error(`Preço não cadastrado para ${telha.nome}.`);
    }

    let metrosProduto = 0;
    let pecasProduto = 0;

    for (const c of cortes) {
      const comp = Number(c.comprimentoM);
      const qtd = Math.floor(Number(c.quantidade));
      if (!Number.isFinite(comp) || comp <= 0) throw new Error(`Comprimento inválido: ${c.comprimentoM}`);
      if (!Number.isFinite(qtd) || qtd <= 0) throw new Error(`Quantidade inválida: ${c.quantidade}`);

      // Peça acima do máximo é dividida com transpasse (ver opcoesDeCorte).
      // Acima do limite da PROMOÇÃO, o preço muda de base: vai para o vendedor.
      const compMax = telha.comprimento_maximo_m || eng.comprimento_maximo_fabricacao_m;
      if (comp > compMax) {
        avisos.push(`${telha.nome}: peça de ${comp.toFixed(2)}m acima do máximo de fábrica (${compMax}m) — precisa ser emendada.`);
        escalarParaVendedor = true;
      }
      if (telha.promocao_ate_m && comp > telha.promocao_ate_m) {
        avisos.push(`${telha.nome}: peça de ${comp.toFixed(2)}m está FORA DA PROMOÇÃO (válida até ${telha.promocao_ate_m}m) — o preço muda de base e precisa ser cotado pela equipe.`);
        escalarParaVendedor = true;
        foraDaPromocao = true;
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
        precoUnit: money(precoUnit),
        subtotal: money(metros * precoUnit),
      });
    }

    metragemTotal = m3(metragemTotal + metrosProduto);
    totalPecas += pecasProduto;
    // desconto por volume, para aparecer no PDF (não na tela do cliente)
    const precoBase = Array.isArray(telha.faixas_preco) && telha.faixas_preco.length
      ? [...telha.faixas_preco].sort((a, b) => (a.ate_m2 ?? Infinity) - (b.ate_m2 ?? Infinity))[0].preco
      : telha.preco;
    const descontoPct = precoBase > 0
      ? Math.round((1 - precoUnit / precoBase) * 1000) / 10 : 0;

    resumoPorProduto.push({
      telhaId: telha.id,
      nome: telha.nome,
      pecas: pecasProduto,
      metros: metrosProduto,
      precoUnit: money(precoUnit),
      precoBase: money(precoBase),
      descontoPct,
      economia: money(metrosProduto * (precoBase - precoUnit)),
      faixa: rotuloFaixa(faixa),
      subtotal: money(metrosProduto * precoUnit),
    });

    // avisa quando falta pouco para a próxima faixa — vira argumento de venda
    if (faixa && faixa.ate_m2 != null && Array.isArray(telha.faixas_preco)) {
      const base = baseFaixa === 'pedido' ? metragemPedido : metrosProduto;
      const falta = m3(faixa.ate_m2 - base);
      const proxima = [...telha.faixas_preco]
        .sort((a, b) => (a.ate_m2 ?? Infinity) - (b.ate_m2 ?? Infinity))
        .find((x) => (x.ate_m2 ?? Infinity) > faixa.ate_m2);
      if (proxima && falta <= 10 && proxima.preco < faixa.preco) {
        avisos.push(`${telha.nome}: faltam ${falta} m² para a próxima faixa, com preço de R$ ${proxima.preco.toFixed(2).replace('.', ',')}/m.`);
      }
    }
  }

  // ── 2) Complementos: acabamentos (POR BARRA) e fixação (POR PEÇA) ──
  // Acabamento é vendido em barra fechada (ex: 3m): arredonda pra cima.
  // Fixação usa consumo por m² quando a quantidade não é informada.
  for (const comp of (pedido.complementos || [])) {
    const item = (catalogo.complementos || []).find((x) => x.id === comp.produtoId);
    if (!item) throw new Error(`Complemento inválido: ${comp.produtoId}`);

    let qtd, nome = item.nome, unidade = item.unidade || 'UN';

    if (item.venda_por === 'metro') {
      // cobrado por metro corrido (ex: acabamento lateral a R$ 27,48/m)
      qtd = Number.isFinite(Number(comp.quantidade)) && Number(comp.quantidade) > 0
        ? m3(Number(comp.quantidade))
        : m3(Number(comp.metros) || 0);
      if (qtd <= 0) continue;

    } else if (item.venda_por === 'barra') {
      const barra = Number(item.comprimento_barra_m) || 3;
      const metros = Number(comp.metros) || 0;
      qtd = Number.isFinite(Number(comp.quantidade)) && Number(comp.quantidade) > 0
        ? Math.ceil(Number(comp.quantidade))
        : Math.ceil(metros / barra);
      if (qtd <= 0) continue;
      nome = `${item.nome} (${qtd} barra${qtd > 1 ? 's' : ''} de ${barra}m)`;
      unidade = 'PC';
      if (metros > 0) {
        const sobra = m3(qtd * barra - metros);
        if (sobra > 0) avisos.push(`${item.nome}: ${metros}m necessários → ${qtd} barras de ${barra}m (sobra de ${sobra}m).`);
      }

    } else if (item.aplica_em && (comp.metros > 0) && !Number.isFinite(Number(comp.quantidade))) {
      // peça avulsa com rendimento por metro (ex: cumeeira 1 un por metro)
      const rend = Number(item.rendimento_m) || 1;
      qtd = Math.ceil(Number(comp.metros) / rend);
      if (qtd <= 0) continue;

    } else {
      qtd = Number.isFinite(Number(comp.quantidade)) && Number(comp.quantidade) > 0
        ? Math.ceil(Number(comp.quantidade))
        : Math.ceil((Number(item.consumo_por_m2) || 0) * metragemTotal);
      if (qtd <= 0) continue;
    }

    itens.push({
      codigo: item.codigo || item.id,
      nome: `${item.codigo ? item.codigo + ' - ' : ''}${nome}`,
      imagem: item.imagem || null,
      unidade, qtd, comprimentoM: null,
      precoUnit: money(item.preco),
      subtotal: money(qtd * item.preco),
    });
  }

  // ── 2b) Perfis/estrutura — OPCIONAL (cliente pode querer só a telha) ──
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

  // ── 3) Totais: FRETE É COBRADO À PARTE ────────────────────────────
  // Não entra como item nem é diluído no preço do produto: aparece em
  // linha própria e soma no total geral.
  let totalProdutos = money(itens.reduce((s, i) => s + i.subtotal, 0));
  let totalFrete = 0;
  let freteDiluido = 0;

  if (pedido.frete) {
    // Pedido pequeno: o frete é DILUÍDO no preço por metro das telhas.
    // O cliente continua vendo "frete grátis" — só o preço/m sobe.
    if (pedido.frete.diluir > 0 && metragemTotal > 0) {
      freteDiluido = money(pedido.frete.diluir);
      const acrescimoPorMetro = freteDiluido / metragemTotal;
      for (const it of itens) {
        if (it.comprimentoM == null) continue;         // só as telhas
        it.precoUnit = money(it.precoUnit + acrescimoPorMetro);
        it.subtotal = money(it.qtd * it.comprimentoM * it.precoUnit);
      }
      for (const p of resumoPorProduto) {
        p.precoUnit = money(p.precoUnit + acrescimoPorMetro);
        p.subtotal = money(p.metros * p.precoUnit);
      }
      totalProdutos = money(itens.reduce((s, i) => s + i.subtotal, 0));
    }
    // no modo "embutido" nada é somado à parte
    if (!pedido.frete.embutido && Number.isFinite(pedido.frete.valor)) {
      totalFrete = money(pedido.frete.valor);
    }
    if (pedido.frete.foraDoRaio) escalarParaVendedor = true;
    if (pedido.frete.aviso) avisos.push(pedido.frete.aviso);
  }
  const totalAvista = money(totalProdutos + totalFrete);

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
  // Base configurável: "produtos" (frete pago à parte, fora do cartão) ou
  // "total" (frete parcelado junto). Padrão: produtos + frete.
  const base = catalogo.pagamento?.aplicar_sobre === 'produtos' ? totalProdutos : totalAvista;
  const pagamentos = (catalogo.pagamento?.opcoes || []).map((o) => {
    const total = money(base * (1 + o.acrescimo_pct / 100));
    return {
      parcelas: o.parcelas,
      descricao: o.descricao,
      total,
      valorParcela: money(total / o.parcelas),
    };
  });

  const economiaTotal = money(resumoPorProduto.reduce((s, p) => s + (p.economia || 0), 0));

  return {
    itens, metragemTotal, totalPecas,
    totalProdutos, totalFrete, freteDiluido, totalAvista, economiaTotal,
    frete: pedido.frete || null,
    foraDoRaio: !!pedido.frete?.foraDoRaio,
    foraDaPromocao, descontoOnline,
    pagamentos, resumoPorProduto, avisos, escalarParaVendedor,
  };
}

module.exports = { calcularOrcamento };
