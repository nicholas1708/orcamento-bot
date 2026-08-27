/**
 * PIX BR CODE — o payload é gerado por nós, sem banco no meio.
 *
 * Se o CRC estiver errado o app do banco recusa o código e o cliente acha que
 * o problema é a empresa. Se o valor ou a chave saírem errados, o dinheiro vai
 * para o lugar errado. Nada aqui pode sair no chute.
 *
 *   node teste-pix.js
 */
const { montarBrCode, crc16, normalizarChave } = require('./pix');
const catalogo = require('./catalogo.json');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

/** Desmonta o payload EMV de volta em campos: id → valor. */
function destrinchar(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const tam = parseInt(s.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(tam)) throw new Error(`tamanho inválido no campo ${id}`);
    out[id] = s.slice(i + 4, i + 4 + tam);
    i += 4 + tam;
  }
  return out;
}

console.log('\n1) CRC16-CCITT (o algoritmo, contra o vetor oficial)');
// Valor de conferência publicado da variante CCITT-FALSE, que é a exigida
// pelo Banco Central: init 0xFFFF, polinômio 0x1021, sem reflexão.
afirma('crc16("123456789") = 29B1', crc16('123456789') === '29B1', crc16('123456789'));
afirma('devolve sempre 4 dígitos', crc16('A').length === 4, crc16('A'));

console.log('\n2) Estrutura do payload');
const p = montarBrCode({
  chave: '44.627.801/0001-57', nome: '4A Comércio e Representação',
  cidade: 'Cedral', valor: 1234.5, txid: 'WEB-MT4BVQJI',
});
const c = destrinchar(p);

afirma('formato do payload = 01', c['00'] === '01');
afirma('moeda = 986 (real)', c['53'] === '986');
afirma('país = BR', c['58'] === 'BR');
afirma('valor com 2 casas', c['54'] === '1234.50', c['54']);
afirma('nome sem acento e em maiúscula',
  c['59'] === '4A COMERCIO E REPRESENTACAO'.slice(0, 25), c['59']);
afirma('nome no limite de 25', c['59'].length <= 25, `${c['59'].length}`);
afirma('cidade no limite de 15', c['60'].length <= 15, c['60']);

const conta = destrinchar(c['26']);
afirma('domínio do Pix', conta['00'] === 'br.gov.bcb.pix', conta['00']);
afirma('CNPJ só com dígitos', conta['01'] === '44627801000157', conta['01']);
afirma('txid leva o nº do orçamento', destrinchar(c['62'])['05'] === 'WEBMT4BVQJI',
  destrinchar(c['62'])['05']);

console.log('\n3) O CRC do payload fecha');
const corpo = p.slice(0, -4);
afirma('termina com o campo 6304', corpo.endsWith('6304'), corpo.slice(-4));
afirma('CRC confere', p.slice(-4) === crc16(corpo), `${p.slice(-4)} vs ${crc16(corpo)}`);

// 1 caractere trocado tem que quebrar o CRC — é essa a serventia dele
const adulterado = p.slice(0, -4).replace('1234.50', '9234.50');
afirma('valor adulterado invalida o CRC', crc16(adulterado) !== p.slice(-4));

console.log('\n4) Tipos de chave');
afirma('CNPJ formatado vira só dígitos',
  normalizarChave('44.627.801/0001-57') === '44627801000157');
afirma('CPF formatado vira só dígitos',
  normalizarChave('123.456.789-09') === '12345678909');
afirma('e-mail em minúscula', normalizarChave('Vendas@4A.COM.BR') === 'vendas@4a.com.br');
afirma('telefone ganha +55', normalizarChave('(17) 98173-4676') === '+5517981734676',
  normalizarChave('(17) 98173-4676'));
afirma('chave aleatória passa inteira',
  normalizarChave('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  === 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

let semChave = false;
try { montarBrCode({ nome: 'X', cidade: 'Y' }); } catch { semChave = true; }
afirma('sem chave, recusa em vez de gerar código quebrado', semChave);

console.log('\n5) Sem valor, o pagador digita');
const livre = destrinchar(montarBrCode({ chave: '44627801000157', nome: 'X', cidade: 'Y' }));
afirma('campo 54 ausente quando não há valor', livre['54'] === undefined);

console.log('\n6) A chave cadastrada no catálogo');
const pixCat = catalogo.empresa?.pix;
afirma('existe chave em empresa.pix', !!pixCat?.chave);
if (pixCat?.chave) {
  const d = String(pixCat.chave).replace(/\D/g, '');
  const cnpjEmpresa = String(catalogo.empresa?.cnpj || '').replace(/\D/g, '');
  afirma('chave é um CNPJ válido em tamanho', d.length === 14, `${d.length} dígitos`);
  if (cnpjEmpresa) {
    afirma('⚠️ chave Pix bate com o CNPJ da empresa', d === cnpjEmpresa,
      `pix ${d} vs cnpj ${cnpjEmpresa}`);
  }
}

console.log('\n⚠️  O teste confere o FORMATO, não a titularidade.');
console.log('   Confirme com a 4A que a chave ' + (pixCat?.chave || '(nenhuma)'));
console.log('   é a conta certa antes de gerar orçamento para cliente.\n');

console.log(falhas ? `${falhas} falha(s)\n` : 'Tudo certo.\n');
process.exit(falhas ? 1 : 0);
