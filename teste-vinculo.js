/**
 * REGRESSÃO: acabamento vinculado à telha.
 *
 * O defeito real: a telha BRANCA/BRANCA (P358768) recebia a cumeeira
 * GALVALUME (P148384), porque o código pegava qualquer complemento ativo com
 * o `aplica_em` certo. Agora quem manda é `compativeis` no cadastro da telha.
 *
 *   node teste-vinculo.js
 */
const catalogo = require('./catalogo.json');
const { compativeisDaTelha, complementosPorPerimetro } = require('./romaneio');
const { complementosSugeridos } = require('./lista');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

const galva = catalogo.telhas.find((t) => t.id === 'P358769');
const branca = catalogo.telhas.find((t) => t.id === 'P358768');
const ids = (arr) => arr.map((x) => x.id);

console.log('\n1) Cadastro — quem acompanha cada telha');

const cGalva = ids(compativeisDaTelha(catalogo, galva, 'complementos'));
const cBranca = ids(compativeisDaTelha(catalogo, branca, 'complementos'));

afirma('galvalume leva a cumeeira galvalume', cGalva.includes('P148384'));
afirma('galvalume NÃO leva a cumeeira branca', !cGalva.includes('P148474'));
afirma('branca leva a cumeeira branca', cBranca.includes('P148474'));
afirma('branca NÃO leva a cumeeira galvalume', !cBranca.includes('P148384'),
  cBranca.join(', '));

console.log('\n2) Todo id do vínculo existe no catálogo');
for (const t of catalogo.telhas) {
  const v = t.compativeis;
  if (!v) continue;
  for (const id of (v.complementos || [])) {
    afirma(`${t.id} → complemento ${id}`,
      (catalogo.complementos || []).some((c) => c.id === id), 'id não existe no catálogo');
  }
  for (const id of (v.perfis || [])) {
    afirma(`${t.id} → perfil ${id}`,
      (catalogo.perfis || []).some((p) => p.id === id), 'id não existe no catálogo');
  }
}

console.log('\n3) Os parafusos continuam entrando');
for (const t of catalogo.telhas) {
  const sug = complementosSugeridos(12, 4.03, 2, catalogo, t)
    .map((c) => (catalogo.complementos || []).find((x) => x.id === c.produtoId))
    .filter(Boolean);
  const fixacao = sug.filter((c) => c.tipo === 'fixacao');
  afirma(`${t.id} sugere parafuso`, fixacao.length >= 1,
    fixacao.map((f) => f.nome).join(' + ') || 'nenhum parafuso sugerido');
  const cumeeiras = sug.filter((c) => c.aplica_em === 'cumeeira');
  afirma(`${t.id} sugere UMA cumeeira só`, cumeeiras.length === 1,
    cumeeiras.map((c) => c.id).join(', '));
}

console.log('\n4) Sem vínculo no cadastro, nada muda (compatibilidade)');
const semVinculo = { ...branca, compativeis: null };
const todos = (catalogo.complementos || []).filter((c) => c.ativo !== false).length;
afirma('telha sem vínculo aceita todos os ativos',
  compativeisDaTelha(catalogo, semVinculo, 'complementos').length === todos);
afirma('telha inexistente também aceita todos',
  compativeisDaTelha(catalogo, null, 'complementos').length === todos);

console.log('\n5) O perímetro respeita o vínculo');
const perim = complementosPorPerimetro(12, 4.03, 2, catalogo, branca);
afirma('perímetro da branca sem cumeeira galvalume',
  !perim.complementos.some((c) => c.produtoId === 'P148384'),
  perim.complementos.map((c) => c.produtoId).join(', '));

console.log('\n6) Cadastrando a TERCEIRA telha (o caso do dia a dia)');
// Telha nova, branca, salva com o vínculo copiado da irmã branca.
// É o caminho que o painel faz: copiar → ajustar → salvar.
const novaBranca = {
  id: 'P999999', nome: 'Confort PIR 40mm Trapézio 40/1000 — Branco / Branco',
  ativo: true, largura_util_m: 1.0, comprimento_maximo_m: 8,
  compativeis: JSON.parse(JSON.stringify(branca.compativeis)),
};
const cat3 = { ...catalogo, telhas: [...catalogo.telhas, novaBranca] };

const c3 = ids(compativeisDaTelha(cat3, novaBranca, 'complementos'));
afirma('telha nova leva a cumeeira branca', c3.includes('P148474'));
afirma('telha nova NÃO leva a galvalume', !c3.includes('P148384'), c3.join(', '));
afirma('telha nova leva os parafusos',
  c3.includes('P6391P4') && c3.includes('PPA-101'));

// Acabamento novo NÃO entra sozinho nas telhas já cadastradas — é isso que a
// lista de vínculo garante, e é por isso que o painel avisa do órfão.
const cat4 = { ...cat3, complementos: [...catalogo.complementos,
  { id: 'P777', nome: 'Cumeeira Vermelha', tipo: 'acabamento', aplica_em: 'cumeeira', ativo: true }] };
afirma('acabamento novo não vaza para telha antiga',
  !ids(compativeisDaTelha(cat4, branca, 'complementos')).includes('P777'));

const orfao = (cat4.telhas || []).filter((t) => {
  const v = t.compativeis && t.compativeis.complementos;
  return Array.isArray(v) ? v.indexOf('P777') >= 0 : true;
});
afirma('e o cadastro consegue apontar o órfão', orfao.length === 0,
  `${orfao.length} telha(s) usam`);

console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
