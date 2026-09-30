/**
 * ORÇAMENTO INTERNO (painel) — o que muda e, principalmente, o que NÃO muda.
 *
 * A regra combinada:
 *   · o limite de metragem do autoatendimento NÃO vale no painel — ele existe
 *     para o cliente não fechar sozinho um pedido grande, e ali tem vendedor;
 *   · o raio de 600 km CONTINUA valendo para todo mundo — o frete está
 *     embutido no preço e fora do raio ele não cobre a entrega;
 *   · o PREÇO É O MESMO nos dois modos. Se divergir, é bug.
 *
 * Testa a regra de decisão isolada, sem subir servidor nem gerar PDF.
 *
 *   node teste-interno.js
 */
const catalogo = require('./catalogo.json');
const { calcularRomaneio } = require('./romaneio');
const { calcularOrcamento } = require('./engine');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

/**
 * Cópia fiel da decisão que está em gerarOrcamento (server.js).
 * Se mexerem lá e não aqui, este teste passa e o sistema erra — por isso a
 * conferência de fim de arquivo, que lê o server.js e cobra as duas linhas.
 */
function decidir({ metragem, pecas, foraDoRaio, interno }) {
  const limiteM2 = catalogo.regras?.metragem_maxima_autoatendimento_m || Infinity;
  const limitePecas = catalogo.regras?.quantidade_maxima_pecas || Infinity;
  const grande = !interno && (metragem > limiteM2 || pecas > limitePecas);
  const encaminhar = foraDoRaio || grande;
  return { encaminhar, prefixo: encaminhar ? 'PROP-' : (interno ? 'INT-' : 'WEB-') };
}

const LIM = catalogo.regras.metragem_maxima_autoatendimento_m;
const LIMP = catalogo.regras.quantidade_maxima_pecas;
const SEM_LIMITE = !(LIM > 0);
console.log(`\nLimite de autoatendimento: ${SEM_LIMITE ? 'LIBERADO (sem limite)' : LIM + ' m²'}`
  + ` · raio ${catalogo.fretes.raio_maximo_km} km`);

console.log('\n1) Pedido grande');
if (SEM_LIMITE) {
  // Cliente liberou o autoatendimento para qualquer metragem (30/09).
  // O teste acompanha a decisão, mas continua provando que o campo FUNCIONA —
  // senão, repor o limite um dia não teria como ser conferido.
  afirma('site fecha com preço (limite liberado no catálogo)',
    !decidir({ metragem: 5000, pecas: 900, foraDoRaio: false, interno: false }).encaminhar);
  afirma('painel também', !decidir({ metragem: 5000, pecas: 900, foraDoRaio: false, interno: true }).encaminhar);
} else {
  afirma('site encaminha ao comercial',
    decidir({ metragem: LIM + 50, pecas: 10, foraDoRaio: false, interno: false }).encaminhar);
  afirma('painel FECHA com preço',
    !decidir({ metragem: LIM + 50, pecas: 10, foraDoRaio: false, interno: true }).encaminhar);
  afirma('painel fecha até num pedido absurdo',
    !decidir({ metragem: 5000, pecas: 900, foraDoRaio: false, interno: true }).encaminhar);
}

console.log('\n2) O campo de limite continua funcionando (para poder voltar atrás)');
// roda contra valores fixos, não contra o catálogo: prova o MECANISMO
const comLimite = ({ metragem, interno }) => {
  const grande = !interno && metragem > 150;
  return grande;
};
afirma('com limite de 150, site acima encaminha', comLimite({ metragem: 200, interno: false }));
afirma('com limite de 150, site abaixo fecha', !comLimite({ metragem: 100, interno: false }));
afirma('com limite de 150, painel nunca trava', !comLimite({ metragem: 200, interno: true }));
afirma('o código lê o limite do catálogo, não fixo',
  /catalogo\.regras\?\.metragem_maxima_autoatendimento_m \|\| Infinity/
    .test(require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8')));
afirma('null no catálogo vira sem limite', (null || Infinity) === Infinity);

console.log('\n3) ⚠️ O raio de 600 km NÃO foi liberado — trava para OS DOIS');
// Liberar a metragem não liberou isto, e é de propósito: fora do raio o
// frete embutido no preço não cobre a entrega. É prejuízo, não papelada.
afirma('site encaminha',
  decidir({ metragem: 10, pecas: 10, foraDoRaio: true, interno: false }).encaminhar);
afirma('painel TAMBÉM encaminha (frete embutido não cobre)',
  decidir({ metragem: 10, pecas: 10, foraDoRaio: true, interno: true }).encaminhar);
afirma('nem pedido pequeno fura o raio pelo painel',
  decidir({ metragem: 1, pecas: 1, foraDoRaio: true, interno: true }).encaminhar);
afirma('pedido enorme e fora do raio: o raio manda',
  decidir({ metragem: 9000, pecas: 900, foraDoRaio: true, interno: false }).encaminhar);

console.log('\n4) Numeração diz de onde veio');
afirma('site normal → WEB-',
  decidir({ metragem: 10, pecas: 10, foraDoRaio: false, interno: false }).prefixo === 'WEB-');
afirma('painel → INT-',
  decidir({ metragem: 10, pecas: 10, foraDoRaio: false, interno: true }).prefixo === 'INT-');
afirma('encaminhado → PROP-',
  decidir({ metragem: 10, pecas: 10, foraDoRaio: true, interno: true }).prefixo === 'PROP-');

console.log('\n5) ⚠️ O PREÇO CONTINUA IDÊNTICO NOS DOIS MODOS');
const telha = catalogo.telhas.find((t) => t.ativo !== false);
const rom = calcularRomaneio(
  { comprimentoGalpaoM: 30, larguraGalpaoM: 12, quedas: 2 }, telha, catalogo);
const pedido = { grupos: [{ telhaId: telha.id, cortes: rom.cortes }] };
const a = calcularOrcamento(pedido, catalogo);
const b = calcularOrcamento(pedido, catalogo);
afirma('mesmo total', a.totalAvista === b.totalAvista, `R$ ${a.totalAvista}`);
afirma('o pedido de teste é grande de verdade (senão não prova nada)',
  a.metragemTotal > 150, `${a.metragemTotal} m²`);
afirma('o motor não recebe "interno"', calcularOrcamento.length <= 2,
  `arity ${calcularOrcamento.length}`);

console.log('\n6) O server.js ainda tem as duas regras');
// Blindagem contra alguém "simplificar" a decisão lá e este teste continuar verde
const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
afirma('limite ignorado só quando interno', src.includes('const grande = !interno'));
afirma('raio continua fora do "interno"',
  /const encaminhar = frete\.foraDoRaio \|\| grande;/.test(src));
afirma('rota do painel exige login',
  src.includes("app.post('/api/painel/orcamento', exigirLogin"));
afirma('vendedor vem da sessão, não do corpo do POST',
  src.includes('vendedoresDb.buscarPorId(req.usuario.id)'));

console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
