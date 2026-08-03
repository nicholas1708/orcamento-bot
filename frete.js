/**
 * CÁLCULO DE FRETE — determinístico, a partir da tabela do catálogo.
 *
 * Passos:
 *   1) acha a unidade ativa mais próxima da obra (que tenha os produtos)
 *   2) mede a distância aproximada em km
 *   3) aplica a faixa de km da tabela: valor_fixo + metragem x valor_por_metro
 *   4) zera se o pedido passar do "frete grátis acima de"
 *
 * Nunca inventa valor: se faltar CEP, faixa ou valor cadastrado, devolve
 * { valor: null } e o orçamento sai com "frete a confirmar pelo vendedor".
 */
const { unidadeMaisProxima } = require('./distancia');

const money = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} destino  { cep?, cidade?, uf? }
 * @param {object} pedido   { metragemTotal, totalProdutos, codigos: [] }
 * @param {object} catalogo
 * @returns {Promise<{valor:number|null, km:number|null, unidade:object|null, descricao:string, aviso:string|null}>}
 */
async function calcularFrete(destino, pedido, catalogo) {
  const tabela = catalogo.fretes?.tabela || [];
  const unidades = catalogo.unidades || [];

  if (!tabela.length || !unidades.length) {
    return { valor: null, km: null, unidade: null, descricao: 'Frete a confirmar',
      aviso: 'Tabela de frete ou unidades não cadastradas — frete a confirmar pelo vendedor.' };
  }

  const proxima = await unidadeMaisProxima(destino, unidades, pedido.codigos || []);
  if (!proxima) {
    return { valor: null, km: null, unidade: null, descricao: 'Frete a confirmar',
      aviso: 'Não consegui localizar o endereço de entrega — frete a confirmar pelo vendedor.' };
  }

  const { unidade, km } = proxima;
  const faixa = tabela.find((f) => km >= f.km_de && km <= f.km_ate);
  if (!faixa || faixa.valor_fixo === null || faixa.valor_fixo === undefined) {
    return { valor: null, km, unidade, descricao: `Frete a confirmar (${km} km)`,
      aviso: `Distância de ${km} km sem valor cadastrado na tabela — frete a confirmar pelo vendedor.` };
  }

  // frete grátis por valor de pedido
  if (faixa.frete_gratis_acima_de && pedido.totalProdutos >= faixa.frete_gratis_acima_de) {
    return { valor: 0, km, unidade,
      descricao: `Frete GRÁTIS — saindo de ${unidade.cidade}/${unidade.uf} (${km} km)`, aviso: null };
  }

  const valor = money(
    Number(faixa.valor_fixo || 0) + Number(faixa.valor_por_metro || 0) * Number(pedido.metragemTotal || 0)
  );
  return {
    valor, km, unidade,
    descricao: `Frete — ${unidade.cidade}/${unidade.uf} → obra (${km} km)`,
    aviso: null,
  };
}

module.exports = { calcularFrete };
