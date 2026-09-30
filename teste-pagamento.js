/**
 * PAGAMENTO ONLINE — mexe com dinheiro, então o teste é implicante.
 *
 * O que não pode acontecer, em ordem de gravidade:
 *   1. marcar como pago sem confirmar na fonte (o webhook é URL pública)
 *   2. cobrar valor diferente do que o cliente viu no orçamento
 *   3. desmarcar um pagamento já registrado
 *   4. qualquer um varrer os orçamentos pelo número
 *
 *   node teste-pagamento.js
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

const { centavos, itensDoOrcamento, config } = require('./infinitepay');
const catalogo = require('./catalogo.json');
const servidor = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

console.log('\n1) ⚠️ Centavos — errar aqui cobra o valor errado');
afirma('R$ 10,00 = 1000', centavos(10) === 1000);
afirma('R$ 0,01 = 1', centavos(0.01) === 1);
afirma('R$ 1,10 = 110 (ponto flutuante não atrapalha)', centavos(1.10) === 110, String(centavos(1.10)));
afirma('R$ 8.542,35 = 854235', centavos(8542.35) === 854235, String(centavos(8542.35)));
afirma('R$ 141,75 = 14175', centavos(141.75) === 14175, String(centavos(141.75)));
// 0.1+0.2 clássico: 1.005 em float é 1.00499...
afirma('não trunca para baixo por float', centavos(1.005) >= 100, String(centavos(1.005)));

console.log('\n2) O que é cobrado é o total do orçamento');
const orc = { numero: 'WEB-TESTE', totalAvista: 8542.35, totalPecas: 24, metragemTotal: 96.72 };
const itens = itensDoOrcamento(orc);
afirma('uma linha só', itens.length === 1);
afirma('valor bate com o total à vista', itens[0].price === centavos(orc.totalAvista),
  `${itens[0].price} vs ${centavos(orc.totalAvista)}`);
afirma('quantidade 1', itens[0].quantity === 1);
afirma('descrição leva o número do orçamento', itens[0].description.includes('WEB-TESTE'));

let semValor = false;
try { itensDoOrcamento({ numero: 'X', totalAvista: 0 }); } catch { semValor = true; }
afirma('orçamento sem valor é recusado', semValor);

console.log('\n3) Configuração');
afirma('desligado enquanto a InfiniteTag não for preenchida',
  config(catalogo).ativo === false, 'handle=' + config(catalogo).handle);
afirma('tira o $ da frente da handle',
  config({ empresa: { infinitepay: { handle: '$4atelhas' } } }).handle === '4atelhas');

console.log('\n4) ⚠️ O WEBHOOK NÃO É PROVA');
afirma('consulta a InfinitePay antes de gravar',
  /conferirPagamento\([\s\S]{0,200}\)/.test(servidor)
  && servidor.includes('webhook dizia pago, a consulta diz que não'));
afirma('só grava pago se a consulta confirmar',
  /if \(!conf \|\| !conf\.pago\)[\s\S]{0,200}return res\.status\(400\)/.test(servidor));
afirma('responde 400 no erro (faz a InfinitePay reenviar)',
  /res\.status\(400\)\.json\(\{ error: e\.message \}\);\s*\/\/ 400 faz eles reenviarem/.test(servidor));
afirma('webhook para orçamento inexistente é recusado',
  servidor.includes('webhook para orçamento inexistente'));
afirma('reenvio de webhook já tratado não duplica',
  /if \(o\.pagamento\?\.pago\) return res\.json\(\{ ok: true \}\)/.test(servidor));

console.log('\n5) Ninguém varre os orçamentos pelo número');
afirma('rota pública exige o token do PDF',
  /token !== tokenDoOrcamento\(o\)/.test(servidor));
afirma('token sai do nome do arquivo, 16 hex',
  /\[0-9a-f\]\{16\}\\?\.pdf\$/.test(servidor));
afirma('rota do painel exige login e dono',
  /app\.post\('\/api\/painel\/pagamento\/:numero', exigirLogin/.test(servidor)
  && /o\.vendedorId !== req\.usuario\.id/.test(servidor));
afirma('consulta pública de status não devolve valores',
  /esta rota é pública, responde só o que a tela precisa/.test(servidor));

console.log('\n6) ⚠️ NADA aparece ao cliente antes de o admin ligar');
const tela = fs.readFileSync(path.join(__dirname, 'orcamento.html'), 'utf8');
const painel = fs.readFileSync(path.join(__dirname, 'painel.html'), 'utf8');

afirma('uma regra só decide se está ligado', /function pagamentoOnlineLigado/.test(servidor));
afirma('exige handle E url E ativo',
  /ip\.ativo === true[\s\S]{0,220}String\(ip\.handle[\s\S]{0,220}url_publica/.test(servidor));
afirma('o placeholder do catálogo não conta como configurado',
  servidor.includes("ip.handle !== 'DEFINIR_A_INFINITETAG'"));
afirma('a resposta do orçamento carrega o sinal',
  /pagamentoOnline: pagamentoOnlineLigado\(catalogo\)/.test(servidor));
afirma('a tela do cliente respeita o sinal',
  /if\(!r\|\|!r\.pdf\|\|!r\.pagamentoOnline\)return ''/.test(tela));
afirma('o painel esconde do vendedor quando desligado',
  /!\(EU&&EU\.pagamentoOnline\)/.test(painel));
afirma('gerar link recusa se estiver desligado',
  /if \(!pagamentoOnlineLigado\(catalogo\)\)[\s\S]{0,120}erroCliente/.test(servidor));
afirma('ligar sem os campos é recusado no servidor',
  /Informe a InfiniteTag para ligar/.test(servidor)
  && /Informe a URL p[úu]blica do sistema/.test(servidor));
afirma('só o admin abre as configurações',
  /app\.get\('\/painel\/config', exigirAdmin/.test(servidor)
  && /app\.post\('\/api\/painel\/config', exigirAdmin/.test(servidor));

console.log('\n7) Pagamento registrado não volta atrás');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pg-'));
const orcamentosDb = require('./orcamentos');
const numero = 'TESTEPG-' + Date.now().toString(36).toUpperCase();
orcamentosDb.salvar({ numero, canal: 'web', origem: 'cliente',
  cliente: { nome: 'Teste', telefone: '17999990000' },
  orcamento: { totalAvista: 100, metragemTotal: 10, totalPecas: 2, resumoPorProduto: [], avisos: [] },
  grupos: [], pedido: { grupos: [], complementos: [], perfis: [] } });

orcamentosDb.registrarPagamento(numero, { link: 'https://checkout/abc' });
afirma('guarda o link gerado', orcamentosDb.obter(numero).pagamento.link === 'https://checkout/abc');

orcamentosDb.registrarPagamento(numero, { pago: true, forma: 'Pix', parcelas: 1,
  valor: 100, valorPago: 100, em: new Date().toISOString() });
const pago = orcamentosDb.obter(numero);
afirma('marca como pago', pago.pagamento.pago === true);
afirma('mantém o link', pago.pagamento.link === 'https://checkout/abc');
afirma('registra no histórico', pago.historico.some((h) => /Pagamento confirmado/.test(h.nota || '')));

orcamentosDb.registrarPagamento(numero, { pago: false });
afirma('⚠️ NÃO desmarca um pagamento já feito',
  orcamentosDb.obter(numero).pagamento.pago === true);

try { fs.unlinkSync(path.join(__dirname, 'orcamentos', numero + '.json')); } catch {}
fs.rmSync(TMP, { recursive: true, force: true });

console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
