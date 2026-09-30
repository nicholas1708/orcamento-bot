/**
 * PAGAMENTO ONLINE — InfinitePay Checkout (Pix e cartão no mesmo link).
 *
 * Fluxo:
 *   1. cliente clica em "Pagar agora"
 *   2. mandamos os itens para a InfinitePay e recebemos um link de checkout
 *   3. cliente paga (Pix ou cartão, até 12x)
 *   4. a InfinitePay chama nosso webhook
 *   5. ⚠️ NÃO acreditamos no webhook: consultamos /payment_check antes de
 *      marcar qualquer coisa como paga
 *
 * Por que isso é melhor que o Pix estático do PDF: o Pix estático não avisa
 * quando é pago — a baixa é no extrato, na mão. Aqui o orçamento muda de
 * status sozinho.
 *
 * ⚠️ VALOR EM CENTAVOS, INTEIRO. R$ 10,00 = 1000. Um arredondamento errado
 * aqui não é um bug de tela: cobra o valor errado do cliente.
 *
 * Doc: https://www.infinitepay.io/checkout-documentacao
 */
const axios = require('axios');

const API = 'https://api.checkout.infinitepay.io';
const TIMEOUT = Number(process.env.INFINITEPAY_TIMEOUT_MS || 12000);

/** Reais → centavos, sem erro de ponto flutuante. */
const centavos = (v) => Math.round(Number(v) * 100);

/** A handle (InfiniteTag) vem do catálogo, sem o "$" da frente. */
function config(catalogo) {
  const c = catalogo?.empresa?.infinitepay || {};
  const handle = String(c.handle || '').trim().replace(/^\$/, '');
  return {
    handle,
    ativo: !!handle && c.ativo !== false,
    base: String(c.url_publica || process.env.URL_PUBLICA || '').replace(/\/+$/, ''),
  };
}

/**
 * Monta os itens do checkout a partir do orçamento.
 *
 * Mandamos UMA linha com o total à vista, não item a item. Motivo: a soma dos
 * itens arredondados em centavos pode não fechar com o total do orçamento, e
 * aí o cliente é cobrado alguns centavos a mais ou a menos do que viu no PDF.
 * O detalhamento ele já tem no PDF.
 */
function itensDoOrcamento(orcamento) {
  const total = centavos(orcamento.totalAvista);
  if (!(total > 0)) throw new Error('Orçamento sem valor para cobrar.');
  return [{
    quantity: 1,
    price: total,
    description: `Orçamento ${orcamento.numero} — ${orcamento.totalPecas || 0} peças`
      + (orcamento.metragemTotal ? ` · ${orcamento.metragemTotal} mts` : ''),
  }];
}

/**
 * Cria o link de checkout.
 *
 * @param {object} orcamento  registro gravado (numero, totalAvista, cliente…)
 * @param {object} catalogo
 * @returns {Promise<{url, order_nsu}>}
 */
async function criarLink(orcamento, catalogo) {
  const cfg = config(catalogo);
  if (!cfg.ativo) throw new Error('Pagamento online não configurado — falta a InfiniteTag no cadastro da empresa.');
  if (!cfg.base) throw new Error('Falta a URL pública do sistema para receber o retorno do pagamento.');

  const cli = orcamento.cliente || {};
  const corpo = {
    handle: cfg.handle,
    items: itensDoOrcamento(orcamento),
    // é por aqui que o webhook sabe de qual orçamento está falando
    order_nsu: orcamento.numero,
    redirect_url: `${cfg.base}/pago?n=${encodeURIComponent(orcamento.numero)}`,
    webhook_url: `${cfg.base}/webhook/infinitepay`,
  };

  // dados já preenchidos = menos campos para o cliente digitar de novo
  if (cli.nome || cli.email || cli.telefone) {
    corpo.customer = {
      name: cli.nome || undefined,
      email: cli.email || undefined,
      phone_number: cli.telefone ? '+55' + String(cli.telefone).replace(/\D/g, '') : undefined,
    };
  }
  if (cli.cep) {
    corpo.address = {
      cep: String(cli.cep).replace(/\D/g, ''),
      street: cli.rua || undefined,
      neighborhood: cli.bairro || undefined,
      number: cli.numero || undefined,
      complement: cli.complemento || undefined,
    };
  }

  const { data } = await axios.post(`${API}/links`, corpo, { timeout: TIMEOUT });
  const url = data?.url || data?.link || data?.checkout_url;
  if (!url) throw new Error('A InfinitePay não devolveu o link de pagamento.');
  return { url, order_nsu: corpo.order_nsu };
}

/**
 * CONFIRMA O PAGAMENTO NA FONTE.
 *
 * ⚠️ O webhook é uma URL pública: qualquer um pode mandar um POST dizendo
 * "pago". Por isso o corpo que chega NÃO é prova de nada — ele serve só para
 * saber QUAL pedido conferir. A prova vem daqui.
 *
 * @returns {Promise<{pago, valor, parcelas, forma}|null>}
 */
async function conferirPagamento({ order_nsu, transaction_nsu, slug }, catalogo) {
  const cfg = config(catalogo);
  if (!cfg.ativo) return null;

  const { data } = await axios.post(`${API}/payment_check`, {
    handle: cfg.handle, order_nsu, transaction_nsu, slug,
  }, { timeout: TIMEOUT });

  if (!data || data.success !== true) return null;
  return {
    pago: data.paid === true,
    // amount = o que cobramos · paid_amount = o que o cliente pagou, já com o
    // juro do parcelamento que ele assumiu
    valor: Number(data.amount || 0) / 100,
    valorPago: Number(data.paid_amount || data.amount || 0) / 100,
    parcelas: Number(data.installments || 1),
    forma: data.capture_method === 'pix' ? 'Pix' : 'Cartão de crédito',
  };
}

module.exports = { criarLink, conferirPagamento, config, centavos, itensDoOrcamento };
