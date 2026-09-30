/**
 * DE ONDE O MATERIAL SAI.
 *
 * ⚠️ REGRA DE OPERAÇÃO DA 4A: a carga sai inteira do mesmo lugar. Quem manda
 * é a TELHA — se ela sai de X, a cumeeira, o frontal, o parafuso e a estrutura
 * saem de X também. Nunca telha de um lugar e acabamento de outro.
 *
 * Isso é decisão de negócio, não dedução. Este teste existe para ela não se
 * perder na próxima refatoração.
 *
 *   node teste-origem.js
 */
const { unidadesDoPedido, unidadeMaisProxima } = require('./distancia');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n1) Quem manda é a telha');
afirma('telha sem marcador → qualquer unidade',
  unidadesDoPedido([{ id: 'T1' }]) === null);
afirma('telha marcada → só aquela unidade',
  eq(unidadesDoPedido([{ id: 'T1', unidades: ['cedral'] }]), ['cedral']));
afirma('marcador vazio no cadastro conta como sem marcador',
  unidadesDoPedido([{ id: 'T1', unidades: [] }]) === null);
afirma('pedido sem telha nenhuma → qualquer unidade',
  unidadesDoPedido([]) === null);

console.log('\n2) O acabamento NÃO entra nessa conta');
// se um dia alguém passar complementos aqui, o teste denuncia
const telhas = [{ id: 'T1', unidades: ['cedral'] }];
const comAcabamento = [...telhas, { id: 'C1', unidades: ['est-101'] }];
afirma('só telha → Cedral', eq(unidadesDoPedido(telhas), ['cedral']));
afirma('⚠️ misturar acabamento quebraria a origem',
  eq(unidadesDoPedido(comAcabamento), []),
  'é por isso que server.js só passa as telhas');

console.log('\n3) Duas telhas no mesmo pedido');
afirma('mesma origem → mantém',
  eq(unidadesDoPedido([
    { id: 'T1', unidades: ['cedral'] },
    { id: 'T2', unidades: ['cedral'] }]), ['cedral']));
afirma('origens que se cruzam → a comum',
  eq(unidadesDoPedido([
    { id: 'T1', unidades: ['cedral', 'est-101'] },
    { id: 'T2', unidades: ['est-101'] }]), ['est-101']));
afirma('uma marcada e outra livre → a marcada manda',
  eq(unidadesDoPedido([
    { id: 'T1', unidades: ['cedral'] },
    { id: 'T2' }]), ['cedral']));
afirma('origens que não se cruzam → vazio (conflito, não chute)',
  eq(unidadesDoPedido([
    { id: 'T1', unidades: ['cedral'] },
    { id: 'T2', unidades: ['est-101'] }]), []));

console.log('\n4) ⚠️ Vazio NÃO é "sem restrição"');
const UNIDADES = [
  { id: 'cedral', nome: 'EPS', cidade: 'Cedral', uf: 'SP', lat: -20.9, lon: -49.2, ativa: true },
  { id: 'est-101', nome: 'Est. 101', cidade: 'Anápolis', uf: 'GO', lat: -16.3, lon: -48.9, ativa: true },
];
const destino = { cidade: 'São José do Rio Preto', uf: 'SP' };

(async () => {
  // conflito: marcador existe e nenhuma unidade atende → null, não a mais perto
  const conflito = await unidadeMaisProxima(destino, UNIDADES, [], []);
  afirma('conflito devolve null em vez de escolher sozinho', conflito === null,
    conflito ? `escolheu ${conflito.unidade.id}` : '');

  // sem marcador: escolhe a mais próxima normalmente
  const livre = await unidadeMaisProxima(destino, UNIDADES, [], null);
  afirma('sem marcador escolhe a mais perto', !!livre && livre.unidade.id === 'cedral',
    livre ? `${livre.unidade.id} a ${livre.km} km` : 'não achou');

  // marcador manda mesmo quando a outra é mais perto
  const forcado = await unidadeMaisProxima(destino, UNIDADES, [], ['est-101']);
  afirma('marcador vence a distância', !!forcado && forcado.unidade.id === 'est-101',
    forcado ? `${forcado.unidade.id} a ${forcado.km} km` : 'não achou');

  // unidade marcada mas sem coordenada: não inventa outra
  const semCoord = [{ id: 'cedral', nome: 'EPS', ativa: true }, UNIDADES[1]];
  const pendente = await unidadeMaisProxima(destino, semCoord, [], ['cedral']);
  afirma('unidade sem coordenada não cai na vizinha', pendente === null,
    pendente ? `escolheu ${pendente.unidade.id}` : '');

  console.log('\n5) O server.js passa só as telhas');
  const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
  afirma('produtosDoPedido sai de catalogo.telhas',
    /produtosDoPedido\s*=\s*grupos[\s\S]{0,120}catalogo\.telhas/.test(src));

  console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('\n💥', e.message, '\n'); process.exit(1); });
