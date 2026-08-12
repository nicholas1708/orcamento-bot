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
const TIMEOUT_MS = Number(process.env.FRETE_TIMEOUT_MS || 8000);

/** Nunca deixa a geração do orçamento travar por causa de consulta externa. */
function comLimiteDeTempo(promessa, ms = TIMEOUT_MS) {
  return Promise.race([
    promessa,
    new Promise((r) => setTimeout(() => r(null), ms)),
  ]);
}

/**
 * @param {object} destino  { cep?, cidade?, uf? }
 * @param {object} pedido   { metragemTotal, totalProdutos, codigos: [] }
 * @param {object} catalogo
 * @returns {Promise<{valor:number|null, km:number|null, unidade:object|null, descricao:string, aviso:string|null}>}
 */
async function calcularFrete(destino, pedido, catalogo) {
  const tabela = catalogo.fretes?.tabela || [];
  const unidades = catalogo.unidades || [];

  // ── MODO EMBUTIDO ──────────────────────────────────────────────────
  // O frete já está dentro do preço por metro (por isso o preço cai com o
  // volume). Duas exceções: raio de entrega e pedido mínimo.
  if (catalogo.fretes?.modo === 'embutido') {
    const cfg = catalogo.fretes;
    const proxima = await comLimiteDeTempo(unidadeMaisProxima(destino, unidades, pedido.codigos || []));

    if (!proxima) {
      return { valor: 0, embutido: true, km: null, unidade: null,
        descricao: 'Frete grátis',
        aviso: 'Não consegui identificar a unidade de origem pelo endereço — o vendedor confirma o prazo de entrega.' };
    }

    const { unidade, km } = proxima;

    // FORA DO RAIO: não conclui sozinho — a 4A formaliza a proposta
    if (cfg.raio_maximo_km && km > cfg.raio_maximo_km) {
      return {
        valor: null, embutido: true, km, unidade,
        foraDoRaio: true,
        descricao: `Fora da área de entrega automática (${km} km da unidade de ${unidade.cidade}/${unidade.uf})`,
        mensagemCliente: cfg.mensagem_fora_do_raio,
        aviso: `Destino a ${km} km — acima do raio de ${cfg.raio_maximo_km} km. Proposta precisa ser formalizada pela equipe.`,
      };
    }

    // PEDIDO PEQUENO: R$ X de frete, DILUÍDO no preço por metro.
    // Inclui o pedido SEM TELHA (metragem 0) — só acabamento, parafuso ou
    // estrutura: lá o motor rateia o valor entre os itens.
    const metragem = Number(pedido.metragemTotal) || 0;
    if (cfg.metragem_minima_m2 && metragem < cfg.metragem_minima_m2) {
      return {
        valor: 0, embutido: true, km, unidade,
        diluir: money(cfg.frete_abaixo_do_minimo || 0),
        descricao: `Frete grátis — sai de ${unidade.cidade}/${unidade.uf} (${km} km)`,
        aviso: `Pedido abaixo de ${cfg.metragem_minima_m2} m²: frete de R$ ${(cfg.frete_abaixo_do_minimo || 0).toFixed(2).replace('.', ',')} diluído no valor dos produtos.`,
      };
    }

    return {
      valor: 0, embutido: true, km, unidade,
      descricao: `Frete grátis — material sai de ${unidade.cidade}/${unidade.uf} (${km} km)`,
      aviso: null,
    };
  }

  // ── MODO TABELA (frete cobrado à parte) ────────────────────────────
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
