/**
 * MOTOR DE CÁLCULO — 100% determinístico. Nenhuma IA toca aqui.
 * Recebe o pedido estruturado (preenchido pelo bot) + catálogo de preços
 * e devolve a lista de materiais (BOM) com totais.
 */
const money = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} pedido  { telhaId, forroId, estruturaId, areaM2, cumeeiraM, rufoM, calhaM }
 * @param {object} catalogo  conteúdo do catalogo.json (ou vindo da GestãoClick)
 * @returns {object} { itens: [...], total, avisos: [...], escalarParaVendedor: bool }
 */
function calcularOrcamento(pedido, catalogo) {
  const avisos = [];
  let escalarParaVendedor = false;

  const telha = catalogo.telhas.find((t) => t.id === pedido.telhaId);
  const forro = catalogo.forros.find((f) => f.id === pedido.forroId);
  const estrutura = catalogo.estruturas.find((e) => e.id === pedido.estruturaId);
  if (!telha) throw new Error(`Telha inválida: ${pedido.telhaId}`);
  if (!forro) throw new Error(`Forro inválido: ${pedido.forroId}`);
  if (!estrutura) throw new Error(`Estrutura inválida: ${pedido.estruturaId}`);

  const area = Number(pedido.areaM2);
  const r = catalogo.regras;
  if (!Number.isFinite(area) || area <= 0) throw new Error(`Área inválida: ${pedido.areaM2}`);
  if (area < r.area_minima_m2) avisos.push(`Área abaixo do mínimo (${r.area_minima_m2} m²).`);
  if (area > r.area_maxima_autoatendimento_m2) {
    avisos.push(`Área acima de ${r.area_maxima_autoatendimento_m2} m² — encaminhar ao vendedor.`);
    escalarParaVendedor = true;
  }

  const itens = [];
  const add = (nome, qtd, unidade, precoUnit) => {
    const q = money(qtd);
    if (q <= 0) return;
    itens.push({ nome, qtd: q, unidade, precoUnit: money(precoUnit), subtotal: money(q * precoUnit) });
  };

  // 1) Telha: área x fator de perda/recobrimento
  add(telha.nome, area * telha.fator_perda, 'm²', telha.preco);

  // 2) Forro: só se a telha NÃO tiver forro integrado
  if (telha.forro_integrado && pedido.forroId !== 'FR-NENHUM') {
    avisos.push('Telha sanduíche já inclui forro de isopor integrado — forro avulso não cobrado.');
  } else if (!telha.forro_integrado && forro.preco > 0) {
    add(forro.nome, area * forro.fator_perda, 'm²', forro.preco);
  }

  // 3) Estrutura: preço médio por m² coberto
  if (estrutura.preco_por_m2 > 0) add(estrutura.nome, area, 'm²', estrutura.preco_por_m2);

  // 4) Fixação (sempre que há telha) — qualquer acessório com consumo_por_m2 entra automático
  const ac = catalogo.acessorios;
  for (const item of Object.values(ac)) {
    if (item.consumo_por_m2 > 0) add(item.nome, area * item.consumo_por_m2, item.unidade, item.preco);
  }

  // 5) Acabamentos por metro linear (informados pelo cliente; 0 = não quer)
  add(ac.cumeeira.nome, Number(pedido.cumeeiraM) || 0, ac.cumeeira.unidade, ac.cumeeira.preco);
  add(ac.rufo.nome, Number(pedido.rufoM) || 0, ac.rufo.unidade, ac.rufo.preco);
  add(ac.calha.nome, Number(pedido.calhaM) || 0, ac.calha.unidade, ac.calha.preco);

  // 6) Frete por localidade — tabela cadastrável no catálogo (nunca inventado)
  const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cidade = normalizar(pedido.cidade);
  const regraFrete = (catalogo.fretes?.tabela || []).find((f) => cidade.includes(normalizar(f.localidade)));
  if (regraFrete) {
    add(`Frete — ${pedido.cidade}`, 1, 'vb', regraFrete.valor);
  } else {
    avisos.push('Frete NÃO incluso — valor a confirmar pelo vendedor para sua localidade.');
  }

  const total = money(itens.reduce((s, i) => s + i.subtotal, 0));
  return { itens, total, avisos, escalarParaVendedor };
}

module.exports = { calcularOrcamento };
