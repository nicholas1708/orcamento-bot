/**
 * LISTA DE CONFERÊNCIA — o que o cliente vai levar, SEM PREÇO.
 *
 * Fonte única para os dois canais: o wizard do site mostra em tela e o
 * WhatsApp mostra em texto. Os dois deixam o cliente ajustar quantidade,
 * tirar e acrescentar item antes de fechar.
 *
 * A quantidade sai de `quantidadeDoComplemento` (engine.js) — a MESMA função
 * que o cálculo do preço usa. Se o cliente não mexer em nada, o orçamento
 * fecha exatamente igual ao que fecharia sem a conferência.
 *
 * montarLista  : pedido do motor  → linhas editáveis
 * aplicarLista : linhas editadas   → pedido do motor
 */
const { quantidadeDoComplemento } = require('./engine');

const m3 = (v) => Math.round(v * 1000) / 1000;
const m2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} pedido    { grupos, complementos, perfis }
 * @param {object} catalogo
 * @returns {{linhas: object[], metragemTotal: number, totalPecas: number, ambiente: object|null}}
 */
function montarLista({ grupos = [], complementos = [], perfis = [] }, catalogo) {
  const linhas = [];
  let metragemTotal = 0;
  let totalPecas = 0;

  // ── Telhas: uma linha por corte ───────────────────────────────────
  for (const g of grupos) {
    const telha = (catalogo.telhas || []).find((t) => t.id === g.telhaId);
    if (!telha) continue;
    // soma igual à do motor, senão o consumo por m² dos parafusos
    // poderia arredondar para um número diferente
    let metrosProduto = 0;
    for (const c of (g.cortes || [])) {
      const qtd = Math.floor(Number(c.quantidade)) || 0;
      const comp = Number(c.comprimentoM) || 0;
      if (qtd <= 0 || comp <= 0) continue;
      metrosProduto = m3(metrosProduto + m3(qtd * comp));
      totalPecas += qtd;
      linhas.push({
        tipo: 'telha', id: telha.id, nome: telha.nome, codigo: telha.codigo || null,
        imagem: telha.imagem || null, desenho: null,
        qtd, comp, rotulo: 'peças', temTamanho: true,
        detalhe: `${qtd} × ${comp.toFixed(2).replace('.', ',')}m`,
      });
    }
    metragemTotal = m3(metragemTotal + metrosProduto);
  }

  // ── Acabamentos e fixação ─────────────────────────────────────────
  for (const comp of complementos) {
    const item = (catalogo.complementos || []).find((x) => x.id === comp.produtoId);
    if (!item) continue;
    const q = quantidadeDoComplemento(item, comp, metragemTotal);
    if (!(q.qtd > 0)) continue;
    linhas.push({
      tipo: 'complemento', id: item.id, nome: item.nome, codigo: item.codigo || null,
      imagem: item.imagem || null, desenho: item.aplica_em || null,
      qtd: q.qtd, comp: null, rotulo: q.rotulo, temTamanho: false,
      detalhe: item.tipo === 'fixacao' ? 'calculado pelo tamanho do telhado' : null,
    });
  }

  // ── Estrutura ─────────────────────────────────────────────────────
  for (const p of perfis) {
    const perfil = (catalogo.perfis || []).find((x) => x.id === p.perfilId);
    if (!perfil) continue;
    const porUnidade = perfil.unidade === 'UN';
    const qtd = porUnidade ? Math.ceil(Number(p.quantidade) || 0) : m2(Number(p.metros) || 0);
    if (!(qtd > 0)) continue;
    linhas.push({
      tipo: 'perfil', id: perfil.id, nome: perfil.nome, codigo: perfil.codigo || null,
      imagem: perfil.imagem || null, desenho: perfil.tipo || null,
      qtd, comp: null, rotulo: porUnidade ? 'peças' : 'metros', temTamanho: false,
      detalhe: perfil.vao_maximo_m
        ? `aguenta até ${String(perfil.vao_maximo_m).replace('.', ',')}m sem apoio` : null,
    });
  }

  const ambiente = grupos.find((g) => g.ambiente)?.ambiente || null;
  return { linhas, metragemTotal, totalPecas, ambiente };
}

/**
 * Caminho de volta: as linhas conferidas viram o pedido que o motor calcula.
 * Linha zerada é descartada — foi o jeito do cliente dizer "tira isso".
 */
function aplicarLista(linhas, catalogo, ambiente) {
  const porTelha = new Map();
  const complementos = [];
  const perfis = [];

  for (const l of (linhas || [])) {
    const qtd = Number(String(l.qtd).replace(',', '.'));
    if (!Number.isFinite(qtd) || qtd <= 0) continue;   // negativo e vazio caem fora

    const telha = (catalogo.telhas || []).find((t) => t.id === l.id);
    if (telha) {
      const comp = Number(l.comp);
      if (!(comp > 0)) continue;
      if (!porTelha.has(telha.id)) {
        porTelha.set(telha.id, { telhaId: telha.id, nome: telha.nome, cortes: [] });
      }
      // a mesma telha entra várias vezes, uma linha por comprimento.
      // Dois pedidos do MESMO comprimento viram uma linha só.
      // peça é inteira: 0,5 telha não existe, e arredondar pra baixo
      // zeraria a linha e derrubaria o motor com "Quantidade inválida: 0"
      const pecas = Math.ceil(qtd);
      const cortes = porTelha.get(telha.id).cortes;
      const igual = cortes.find((c) => Math.abs(c.comprimentoM - comp) < 0.001);
      if (igual) igual.quantidade += pecas;
      else cortes.push({ quantidade: pecas, comprimentoM: comp });
      continue;
    }

    const item = (catalogo.complementos || []).find((c) => c.id === l.id);
    if (item) {
      // vendido por metro corrido não arredonda: 24,5m são 24,5m
      complementos.push({ produtoId: item.id,
        quantidade: item.venda_por === 'metro' ? qtd : Math.ceil(qtd) });
      continue;
    }

    const perfil = (catalogo.perfis || []).find((p) => p.id === l.id);
    if (perfil) {
      if (perfil.unidade === 'UN') perfis.push({ perfilId: perfil.id, quantidade: Math.ceil(qtd) });
      else perfis.push({ perfilId: perfil.id, metros: qtd });
    }
  }

  const grupos = [...porTelha.values()];
  if (ambiente && grupos[0]) grupos[0].ambiente = ambiente;
  return { grupos, complementos, perfis };
}

/**
 * O QUE ACOMPANHA O TELHADO — acabamentos pelo perímetro e fixação por m².
 * Usado quando o cliente aceita "leva os acabamentos junto".
 *
 * @param {number|null} comprimentoGalpaoM  null quando não se sabe as medidas
 * @param {number|null} compTelhaM          maior corte (define as laterais)
 * @param {number} quedas
 */
function complementosSugeridos(comprimentoGalpaoM, compTelhaM, quedas, catalogo) {
  const { complementosPorPerimetro } = require('./romaneio');
  const ativos = (catalogo.complementos || []).filter((c) => c.ativo !== false);
  const out = [];

  // pelo perímetro: só dá pra calcular sabendo as medidas do telhado
  if (comprimentoGalpaoM > 0 && compTelhaM > 0) {
    const { complementos } = complementosPorPerimetro(comprimentoGalpaoM, compTelhaM, quedas, catalogo);
    for (const c of complementos) out.push({ produtoId: c.produtoId, metros: c.metros });
  }

  // por m²: o motor resolve a quantidade sozinho a partir da metragem
  for (const item of ativos) {
    if (out.some((x) => x.produtoId === item.id)) continue;
    if (Number(item.consumo_por_m2) > 0) out.push({ produtoId: item.id });
  }
  return out;
}

module.exports = { montarLista, aplicarLista, complementosSugeridos };
