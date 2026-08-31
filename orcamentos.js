/**
 * REGISTRO DE ORÇAMENTOS — histórico de tudo que o sistema gerou.
 *
 * Um arquivo JSON por orçamento (mesmo padrão de sessions/ e clientes/).
 * Guarda o suficiente para o painel: quem pediu, o que pediu, quanto deu,
 * por qual canal e em que pé está a negociação.
 *
 * ⚠️ Contém dados pessoais (nome, telefone, endereço) — o acesso ao painel
 * é protegido por senha e o diretório nunca é servido como estático.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'orcamentos');
fs.mkdirSync(DIR, { recursive: true });

const STATUS = ['novo', 'em_negociacao', 'fechado', 'perdido'];
const arquivo = (numero) => path.join(DIR, String(numero).replace(/[^A-Za-z0-9_-]/g, '') + '.json');

/**
 * Grava o orçamento recém-gerado.
 *
 * @param {object} p.pedido  a ENTRADA do motor ({grupos, complementos, perfis}).
 *   É o que permite reabrir o orçamento para editar depois. Sem ela sobra só o
 *   resumo de exibição, que não tem produtoId nem quantidade em formato de
 *   motor — o orçamento voltaria sem acabamento e sem parafuso.
 * @param {number} p.revisao  1 na criação; o editar() cuida de incrementar.
 */
function salvar({ numero, canal, origem, vendedor, vendedorId, vendedorSlug,
  cliente, orcamento, grupos, pedido, pdfPath }) {
  const registro = {
    numero,
    revisao: 1,
    canal,                                  // 'whatsapp' | 'web'
    origem: origem || 'cliente',            // 'cliente' (autoatendimento) | 'vendedor' (interno)
    vendedor: vendedor || null,             // nome de quem gerou
    // ⚠️ É POR AQUI que o painel decide quem enxerga o orçamento. Gravado a
    // partir do cadastro, nunca do que a tela mandou. Orçamento sem dono
    // (link público) fica null e só o admin vê.
    vendedorId: vendedorId || null,
    vendedorSlug: vendedorSlug || null,     // qual link trouxe o cliente
    criadoEm: new Date().toISOString(),
    status: 'novo',
    cliente: {
      nome: cliente.nome || null,
      documento: cliente.documento || null,
      telefone: cliente.telefone || null,
      email: cliente.email || null,
      cep: cliente.cep || null,
      rua: cliente.rua || null,
      numero: cliente.numero || null,
      bairro: cliente.bairro || null,
      complemento: cliente.complemento || null,
      cidade: cliente.cidade || null,
      estado: cliente.estado || null,
      endereco: cliente.endereco || null,
    },
    produtos: (orcamento.resumoPorProduto || []).map((p) => ({
      nome: p.nome, pecas: p.pecas, metros: p.metros, subtotal: p.subtotal,
    })),
    cortes: (grupos || []).map((g) => ({
      nome: g.nome,
      cortes: g.cortes,
      ambiente: g.ambiente || null,
    })),
    // ⚠️ ENTRADA EXATA DO MOTOR — é isto que permite reabrir e editar.
    // Guardado separado do resumo acima: aquele é para mostrar na tela, este
    // é para recalcular. Refazer o orçamento a partir do resumo perderia os
    // acabamentos e os parafusos.
    pedido: pedido ? {
      grupos: pedido.grupos || [],
      complementos: pedido.complementos || [],
      perfis: pedido.perfis || [],
    } : null,
    metragemTotal: orcamento.metragemTotal,
    totalPecas: orcamento.totalPecas,
    totalProdutos: orcamento.totalProdutos,
    totalFrete: orcamento.totalFrete ?? null,
    totalAvista: orcamento.totalAvista,
    frete: orcamento.frete ? {
      valor: orcamento.frete.valor, km: orcamento.frete.km,
      unidade: orcamento.frete.unidade?.nome || null,
      descricao: orcamento.frete.descricao,
    } : null,
    avisos: orcamento.avisos || [],
    precisouVendedor: !!orcamento.escalarParaVendedor,
    pdf: pdfPath ? '/out/' + path.basename(pdfPath) : null,
    historico: [{ em: new Date().toISOString(), status: 'novo', nota: 'Gerado pelo sistema' }],
  };
  try {
    fs.writeFileSync(arquivo(numero), JSON.stringify(registro, null, 2));
  } catch (e) {
    console.error('[orcamentos] falha ao gravar:', e.message);
  }
  return registro;
}

/** Todos os orçamentos, do mais recente para o mais antigo. */
function listar() {
  let arquivos = [];
  try { arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of arquivos) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))); } catch { /* ignora corrompido */ }
  }
  return out.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
}

function obter(numero) {
  try { return JSON.parse(fs.readFileSync(arquivo(numero), 'utf8')); } catch { return null; }
}

/**
 * REVISA UM ORÇAMENTO — mesmo número, revisão nova.
 *
 * O cliente já tem um PDF na mão. Trocar o valor sem deixar rastro faria o
 * documento dele deixar de bater com o sistema, sem ninguém saber quando nem
 * por quê. Então: número igual (é por ele que se fala no telefone), `revisao`
 * incrementa, o PDF antigo continua no ar e o histórico guarda o antes/depois.
 *
 * Não mexe em: criadoEm, canal, origem e o dono (vendedorId). Quem criou,
 * criou — editar não transfere a comissão para quem editou.
 *
 * @returns {object|null} o registro atualizado, ou null se não existir
 */
function revisar(numero, { cliente, orcamento, grupos, pedido, pdfPath, por }) {
  const r = obter(numero);
  if (!r) return null;

  const antes = { valor: r.totalAvista, metragem: r.metragemTotal, pecas: r.totalPecas };
  const agora = new Date().toISOString();
  const rev = (Number(r.revisao) || 1) + 1;

  // PDFs anteriores continuam acessíveis: o cliente pode estar com o link.
  r.pdfsAnteriores = (r.pdfsAnteriores || []).concat(
    r.pdf ? [{ revisao: r.revisao || 1, pdf: r.pdf, em: r.atualizadoEm || r.criadoEm }] : []);

  r.revisao = rev;
  r.atualizadoEm = agora;
  if (cliente) r.cliente = { ...r.cliente, ...cliente };
  r.produtos = (orcamento.resumoPorProduto || []).map((p) => ({
    nome: p.nome, pecas: p.pecas, metros: p.metros, subtotal: p.subtotal,
  }));
  r.cortes = (grupos || []).map((g) => ({
    nome: g.nome, cortes: g.cortes, ambiente: g.ambiente || null,
  }));
  if (pedido) {
    r.pedido = { grupos: pedido.grupos || [], complementos: pedido.complementos || [],
      perfis: pedido.perfis || [] };
  }
  r.metragemTotal = orcamento.metragemTotal;
  r.totalPecas = orcamento.totalPecas;
  r.totalProdutos = orcamento.totalProdutos;
  r.totalFrete = orcamento.totalFrete ?? null;
  r.totalAvista = orcamento.totalAvista;
  r.frete = orcamento.frete ? {
    valor: orcamento.frete.valor, km: orcamento.frete.km,
    unidade: orcamento.frete.unidade?.nome || null,
    descricao: orcamento.frete.descricao,
  } : null;
  r.avisos = orcamento.avisos || [];
  r.precisouVendedor = !!orcamento.escalarParaVendedor;
  if (pdfPath) r.pdf = '/out/' + path.basename(pdfPath);

  // o que mudou, em uma linha legível no painel
  const dif = [];
  if (antes.metragem !== r.metragemTotal) dif.push(`${antes.metragem} → ${r.metragemTotal} m²`);
  if (antes.pecas !== r.totalPecas) dif.push(`${antes.pecas} → ${r.totalPecas} peças`);
  if (antes.valor !== r.totalAvista) {
    dif.push(`R$ ${Number(antes.valor).toFixed(2)} → R$ ${Number(r.totalAvista).toFixed(2)}`);
  }
  r.historico = (r.historico || []).concat({
    em: agora, status: r.status, revisao: rev, por: por || null,
    nota: `Revisão ${rev}${dif.length ? ' — ' + dif.join(' · ') : ' — sem mudança de valor'}`,
  });

  try {
    fs.writeFileSync(arquivo(numero), JSON.stringify(r, null, 2));
  } catch (e) {
    console.error('[orcamentos] falha ao revisar:', e.message);
    return null;
  }
  return r;
}

/** Muda o status e registra no histórico (rastreabilidade). */
function atualizarStatus(numero, status, nota) {
  if (!STATUS.includes(status)) return null;
  const r = obter(numero);
  if (!r) return null;
  r.status = status;
  r.atualizadoEm = new Date().toISOString();
  r.historico = (r.historico || []).concat({ em: r.atualizadoEm, status, nota: nota || null });
  fs.writeFileSync(arquivo(numero), JSON.stringify(r, null, 2));
  return r;
}

/** Números do período para os cartões do painel. */
function estatisticas(lista) {
  const soma = (f) => lista.reduce((s, o) => s + (Number(f(o)) || 0), 0);
  const fechados = lista.filter((o) => o.status === 'fechado');
  return {
    quantidade: lista.length,
    valorTotal: Math.round(soma((o) => o.totalAvista) * 100) / 100,
    ticketMedio: lista.length ? Math.round((soma((o) => o.totalAvista) / lista.length) * 100) / 100 : 0,
    metragemTotal: Math.round(soma((o) => o.metragemTotal) * 1000) / 1000,
    fechados: fechados.length,
    valorFechado: Math.round(fechados.reduce((s, o) => s + (o.totalAvista || 0), 0) * 100) / 100,
    conversao: lista.length ? Math.round((fechados.length / lista.length) * 1000) / 10 : 0,
    precisaramVendedor: lista.filter((o) => o.precisouVendedor).length,
    porOrigem: {
      cliente: lista.filter((o) => (o.origem || 'cliente') === 'cliente').length,
      vendedor: lista.filter((o) => o.origem === 'vendedor').length,
    },
    porCanal: {
      whatsapp: lista.filter((o) => o.canal === 'whatsapp').length,
      web: lista.filter((o) => o.canal === 'web').length,
    },
  };
}

module.exports = { salvar, revisar, listar, obter, atualizarStatus, estatisticas, STATUS };
