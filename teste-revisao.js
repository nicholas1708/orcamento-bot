/**
 * EDIÇÃO DE ORÇAMENTO — a prova que importa é a mais chata:
 * reabrir e salvar SEM MEXER EM NADA tem que dar exatamente o mesmo valor.
 *
 * Se der diferente, é porque o pedido não foi gravado direito — e aí toda
 * edição estaria silenciosamente perdendo acabamento, parafuso ou estrutura.
 *
 *   node teste-revisao.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
process.env.DADOS_DIR = TMP;

const catalogo = require('./catalogo.json');
const { calcularRomaneio, compativeisDaTelha } = require('./romaneio');
const { calcularOrcamento } = require('./engine');
const { montarLista, aplicarLista, complementosSugeridos } = require('./lista');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

/* ── monta um orçamento completo, como o site faria ─────────────────── */
const telha = catalogo.telhas.find((t) => t.ativo !== false);
const L = 12, W = 6, quedas = 2;
const rom = calcularRomaneio(
  { comprimentoGalpaoM: L, larguraGalpaoM: W, quedas }, telha, catalogo);

const complementos = complementosSugeridos(L, rom.compTelha, quedas, catalogo, telha)
  .map((c) => {
    const s = (rom.complementos || []).find((x) => x.produtoId === c.produtoId);
    return s ? { produtoId: c.produtoId, metros: s.metros } : c;
  });

const ambiente = { comprimentoGalpaoM: L, larguraGalpaoM: W, quedas };
const pedidoOriginal = {
  grupos: [{ telhaId: telha.id, nome: telha.nome, cortes: rom.cortes, ambiente }],
  complementos,
  perfis: [],
};

const orcOriginal = calcularOrcamento(pedidoOriginal, catalogo);

console.log('\n1) O pedido gravado tem tudo que o motor precisa');
afirma('tem telha', (pedidoOriginal.grupos || []).length > 0);
afirma('tem acabamento', (pedidoOriginal.complementos || []).length > 0,
  `${pedidoOriginal.complementos.length} item(ns)`);
afirma('tem parafuso', pedidoOriginal.complementos.some((c) => {
  const i = catalogo.complementos.find((x) => x.id === c.produtoId);
  return i && i.tipo === 'fixacao';
}));

console.log('\n2) ⚠️ REABRIR E SALVAR SEM MEXER DÁ O MESMO VALOR');
// caminho real da edição: pedido gravado → lista de conferência → pedido de volta
const lista = montarLista(pedidoOriginal, catalogo);
const devolta = aplicarLista(lista.linhas, catalogo, ambiente);
const orcRevisao = calcularOrcamento(devolta, catalogo);

afirma('mesmo total à vista', orcOriginal.totalAvista === orcRevisao.totalAvista,
  `R$ ${orcOriginal.totalAvista} vs R$ ${orcRevisao.totalAvista}`);
afirma('mesma metragem', orcOriginal.metragemTotal === orcRevisao.metragemTotal,
  `${orcOriginal.metragemTotal} vs ${orcRevisao.metragemTotal}`);
afirma('mesmas peças', orcOriginal.totalPecas === orcRevisao.totalPecas);
afirma('mesma quantidade de linhas', orcOriginal.itens.length === orcRevisao.itens.length,
  `${orcOriginal.itens.length} vs ${orcRevisao.itens.length}`);

// item a item, para não passar batido uma troca compensada
for (const a of orcOriginal.itens) {
  const b = orcRevisao.itens.find((x) => x.codigo === a.codigo);
  afirma(`  ${String(a.nome).slice(0, 34)}`, !!b && b.qtd === a.qtd,
    b ? `${a.qtd} vs ${b.qtd}` : 'sumiu na revisão');
}

console.log('\n3) Mexer de verdade muda o valor');
const maior = lista.linhas.map((l) => ({ ...l }));
const linhaTelha = maior.find((l) => l.tipo === 'telha');
linhaTelha.qtd = linhaTelha.qtd + 4;
const orcMaior = calcularOrcamento(aplicarLista(maior, catalogo, ambiente), catalogo);
afirma('4 telhas a mais sobem o total', orcMaior.totalAvista > orcOriginal.totalAvista,
  `R$ ${orcOriginal.totalAvista} → R$ ${orcMaior.totalAvista}`);

console.log('\n4) A revisão no arquivo');
const orcamentosDb = require('./orcamentos');
const numero = 'TESTE-' + Date.now().toString(36).toUpperCase();
const cliente = { nome: 'Cliente Teste', telefone: '17999998888', cidade: 'Cedral',
  estado: 'SP', cep: '15895000', endereco: 'Rua Teste, 1' };

orcamentosDb.salvar({ numero, canal: 'painel', origem: 'vendedor',
  vendedor: 'Adriano', vendedorId: 'v1', cliente,
  orcamento: orcOriginal, grupos: pedidoOriginal.grupos, pedido: pedidoOriginal,
  pdfPath: '/tmp/orcamento-' + numero + '.pdf' });

const r1 = orcamentosDb.obter(numero);
afirma('nasce na revisão 1', r1.revisao === 1);
afirma('gravou o pedido do motor', !!r1.pedido && (r1.pedido.complementos || []).length > 0);

const r2 = orcamentosDb.revisar(numero, {
  cliente, orcamento: orcMaior, grupos: pedidoOriginal.grupos,
  pedido: pedidoOriginal, pdfPath: '/tmp/orcamento-' + numero + '-r2.pdf', por: 'Adriano' });

afirma('vira revisão 2', r2.revisao === 2);
afirma('número NÃO muda', r2.numero === numero);
afirma('valor atualizado', r2.totalAvista === orcMaior.totalAvista);
afirma('PDF anterior preservado', (r2.pdfsAnteriores || []).length === 1,
  JSON.stringify(r2.pdfsAnteriores));
afirma('PDF novo é outro arquivo', r2.pdf !== r1.pdf);
afirma('histórico registra quem e o quê',
  r2.historico.some((h) => h.revisao === 2 && h.por === 'Adriano' && /R\$/.test(h.nota || '')),
  JSON.stringify(r2.historico.slice(-1)));

console.log('\n5) O que a revisão NÃO pode mexer');
afirma('dono continua o mesmo', r2.vendedorId === 'v1');
afirma('data de criação intacta', r2.criadoEm === r1.criadoEm);
afirma('canal e origem intactos', r2.canal === 'painel' && r2.origem === 'vendedor');
afirma('revisar o que não existe devolve null',
  orcamentosDb.revisar('NAO-EXISTE', { orcamento: orcOriginal, grupos: [] }) === null);

console.log('\n6) O server.js ainda tem as travas');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
afirma('fechado é barrado', /status === 'fechado'/.test(src));
afirma('vendedor não alcança orçamento de outro',
  src.includes("o.vendedorId !== usuario.id"));
afirma('edição confere a permissão de novo no POST',
  src.includes('orcamentoEditavel(req.body.editar, req.usuario)'));
afirma('assinatura do PDF é do dono, não de quem edita',
  src.includes('(editando && editando.vendedor)'));

fs.rmSync(TMP, { recursive: true, force: true });
try { fs.unlinkSync(path.join(__dirname, 'orcamentos', numero + '.json')); } catch {}

console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
