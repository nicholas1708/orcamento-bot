/**
 * IMPORTADOR — lógica compartilhada entre a linha de comando (importar.js)
 * e a tela do painel (/painel/dados).
 *
 * Recebe o CONTEÚDO dos 3 CSVs, valida e devolve o resultado.
 * Não grava nada: quem chama decide se aplica.
 */

// ── leitura de CSV com ; ──────────────────────────────────────────────
function lerCSV(texto) {
  const limpo = String(texto || '').replace(/^﻿/, '');
  const linhas = limpo.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const cabecalho = linhas.shift().split(';').map((c) => c.trim().toLowerCase());
  return linhas.map((l, i) => {
    const cel = l.split(';');
    const o = { _linha: i + 2 };
    cabecalho.forEach((c, j) => { o[c] = (cel[j] || '').trim(); });
    return o;
  });
}

const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const lista = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const sim = (v) => /^(sim|s|true|1|x)$/i.test(String(v || '').trim());
const slug = (s) => String(s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 45);

// ── PRODUTOS ──────────────────────────────────────────────────────────
function importarProdutos(csv, erros, alertas) {
  const linhas = lerCSV(csv);
  const telhas = [];
  const ids = new Set();

  for (const r of linhas) {
    if (!r.nome) continue;
    if (r.ativo !== undefined && String(r.ativo).trim() && !sim(r.ativo)) continue;

    const preco = num(r.preco_por_metro);
    const larguraUtil = num(r.largura_util_m);
    const compMax = num(r.comprimento_maximo_m);
    const rot = `Linha ${r._linha} (${r.nome}${r.cor ? ' — ' + r.cor : ''})`;

    if (!larguraUtil) { erros.push(`${rot}: largura_util_m vazia — sem ela não dá pra calcular a quantidade de peças.`); continue; }
    if (!compMax) { erros.push(`${rot}: comprimento_maximo_m vazio.`); continue; }
    if (!preco) { erros.push(`${rot}: preco_por_metro vazio ou inválido.`); continue; }
    if (!r.familia) alertas.push(`${rot}: sem família — vai para "Outros".`);
    if (larguraUtil > 2) alertas.push(`${rot}: largura útil de ${larguraUtil}m parece alta — confira se não é a largura total ou se está em milímetros.`);
    if (preco > 1000) alertas.push(`${rot}: preço de R$ ${preco}/metro parece alto — confira.`);

    const id = r.codigo ? `P${slug(r.codigo)}` : slug(`${r.nome}-${r.cor || ''}`);
    if (ids.has(id)) { alertas.push(`${rot}: produto duplicado — mantive só o primeiro.`); continue; }
    ids.add(id);

    telhas.push({
      id,
      codigo: r.codigo || null,
      gc_id: null,
      familia: r.familia || 'Outros',
      nome: r.cor && !String(r.nome).toLowerCase().includes(String(r.cor).toLowerCase())
        ? `${r.nome} — ${r.cor}` : r.nome,
      atributos: r.cor ? { cor: r.cor } : {},
      unidade: 'M²',
      preco,
      largura_util_m: larguraUtil,
      comprimento_maximo_m: compMax,
      comprimento_minimo_m: num(r.comprimento_minimo_m) || 0.5,
      transpasse_m: num(r.transpasse_m) || null,
      vao_maximo_m: num(r.vao_maximo_m) || 1.8,
      inclinacao_minima_pct: num(r.inclinacao_minima_pct) || 10,
      forro_integrado: sim(r.forro_integrado),
      imagem: r.imagem_url || null,
      observacao: r.observacao || null,
    });
  }
  if (!telhas.length) erros.push('Nenhum produto válido encontrado na planilha de produtos.');
  return telhas;
}

// ── FRETES ────────────────────────────────────────────────────────────
function importarFretes(csv, erros, alertas) {
  const linhas = lerCSV(csv);
  const tabela = linhas
    .filter((r) => num(r.km_de) !== null && num(r.km_ate) !== null)
    .map((r) => ({
      km_de: num(r.km_de),
      km_ate: num(r.km_ate),
      valor_fixo: num(r.valor_fixo),
      valor_por_metro: num(r.valor_por_metro) || 0,
      frete_gratis_acima_de: num(r.frete_gratis_acima_de),
      observacao: r.observacao || null,
    }))
    .sort((a, b) => a.km_de - b.km_de);

  for (let i = 1; i < tabela.length; i++) {
    if (tabela[i].km_de > tabela[i - 1].km_ate + 1) {
      alertas.push(`Buraco na tabela de frete entre ${tabela[i - 1].km_ate} e ${tabela[i].km_de} km — pedidos nessa distância sairão como "frete a confirmar".`);
    }
  }
  if (!tabela.length) erros.push('Tabela de frete vazia.');
  return tabela;
}

// ── UNIDADES ──────────────────────────────────────────────────────────
function importarUnidades(csv, erros) {
  const linhas = lerCSV(csv);
  // sem telefone: o contato é do representante, não das fábricas
  const unidades = linhas.filter((r) => r.unidade && r.cep).map((r) => ({
    nome: r.unidade,
    cep: r.cep,
    cidade: r.cidade,
    uf: r.uf,
    endereco: r.endereco || null,
    ativa: sim(r.ativa),
    produtos: /^todos$/i.test(r.produtos_disponiveis || 'TODOS') ? [] : lista(r.produtos_disponiveis),
  }));
  if (!unidades.some((u) => u.ativa)) erros.push('Nenhuma unidade ativa — o frete não poderá ser calculado.');
  return unidades;
}

/**
 * Processa os 3 CSVs.
 * @returns {{ok, erros, alertas, telhas, fretes, unidades, resumo}}
 */
function processar({ produtosCsv, fretesCsv, unidadesCsv }, catalogoAtual = {}) {
  const erros = [], alertas = [];

  const telhas = produtosCsv ? importarProdutos(produtosCsv, erros, alertas) : (catalogoAtual.telhas || []);
  const fretes = fretesCsv ? importarFretes(fretesCsv, erros, alertas) : (catalogoAtual.fretes?.tabela || []);
  const unidades = unidadesCsv ? importarUnidades(unidadesCsv, erros) : (catalogoAtual.unidades || []);

  const porFamilia = telhas.reduce((m, t) => { m[t.familia] = (m[t.familia] || 0) + 1; return m; }, {});

  return {
    ok: erros.length === 0,
    erros, alertas,
    telhas, fretes, unidades,
    resumo: {
      produtos: telhas.length,
      familias: Object.keys(porFamilia).length,
      porFamilia,
      faixasFrete: fretes.length,
      unidadesAtivas: unidades.filter((u) => u.ativa).length,
      unidadesTotal: unidades.length,
    },
  };
}

/** Monta o novo catálogo preservando a configuração do sistema. */
function aplicar(catalogoAtual, resultado) {
  return {
    ...catalogoAtual,
    telhas: resultado.telhas,
    unidades: resultado.unidades,
    fretes: { ...(catalogoAtual.fretes || {}), tabela: resultado.fretes },
    _importado_em: new Date().toISOString(),
  };
}

module.exports = { processar, aplicar, lerCSV };
