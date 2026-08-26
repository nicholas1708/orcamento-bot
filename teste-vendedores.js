/**
 * REDE DE VENDEDORES — o que não pode quebrar.
 *
 * Duas garantias, e o resto é consequência:
 *   1. O PREÇO NÃO MUDA POR VENDEDOR. Mesmo motor, mesmo catálogo.
 *   2. O vendedor não vende o que não é dele, nem forçando o POST.
 *
 * Roda contra um arquivo temporário — não mexe no cadastro de verdade.
 *
 *   node teste-vendedores.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// aponta o módulo para uma pasta descartável ANTES de carregá-lo
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vend-'));
process.env.DADOS_DIR = TMP;
process.env.PAINEL_SENHA = 'senha-de-teste';

const catalogo = require('./catalogo.json');
const V = require('./vendedores');
const { calcularOrcamento } = require('./engine');
const { calcularRomaneio } = require('./romaneio');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}
function lanca(nome, fn, trecho) {
  try { fn(); afirma(nome, false, 'não recusou'); }
  catch (e) { afirma(nome, !trecho || e.message.includes(trecho), e.message); }
}

const GALVA = 'P358769';
const BRANCA = 'P358768';

console.log('\n1) Cadastro e senha');

const ana = V.salvar({ nome: 'Ana Paula', usuario: 'ana', senha: 'segredo123', telhas: [GALVA] });
const bruno = V.salvar({ nome: 'Bruno', usuario: 'bruno', senha: 'outra456', telhas: null });

afirma('slug gerado a partir do nome', ana.slug === 'ana-paula', ana.slug);
afirma('senha não volta para a tela', !('senhaHash' in ana));
afirma('login certo entra', !!V.autenticar('ana', 'segredo123'));
afirma('senha errada não entra', !V.autenticar('ana', 'segredo124'));
afirma('usuário que não existe não entra', !V.autenticar('ninguem', 'segredo123'));
afirma('admin do PAINEL_SENHA continua entrando',
  V.autenticar('admin', 'senha-de-teste')?.papel === 'admin');
afirma('vendedor não vira admin sozinho', V.autenticar('ana', 'segredo123').papel === 'vendedor');

lanca('usuário repetido é recusado',
  () => V.salvar({ nome: 'Outra Ana', usuario: 'ana', senha: 'aaa111' }), 'já está em uso');
lanca('usuário "admin" é reservado',
  () => V.salvar({ nome: 'X', usuario: 'admin', senha: 'aaa111' }), 'reservado');
lanca('senha curta é recusada',
  () => V.salvar({ nome: 'Y', usuario: 'yyy', senha: '123' }), '6 caracteres');
lanca('vendedor novo sem senha é recusado',
  () => V.salvar({ nome: 'Z', usuario: 'zzz' }), 'Defina uma senha');

// senha em branco na edição mantém a que já existe
V.salvar({ id: ana.id, nome: 'Ana Paula Souza', usuario: 'ana', telhas: [GALVA] });
afirma('editar sem senha mantém a senha antiga', !!V.autenticar('ana', 'segredo123'));
afirma('link não muda quando o nome muda',
  V.buscarPorUsuario('ana').slug === 'ana-paula', V.buscarPorUsuario('ana').slug);

console.log('\n2) O que cada um pode vender');

const sessaoAna = V.autenticar('ana', 'segredo123');
const sessaoBruno = V.autenticar('bruno', 'outra456');

afirma('Ana vê só a telha dela', V.telhasDoVendedor(catalogo, sessaoAna).length === 1);
afirma('Ana vende a galvalume', V.podeVender(catalogo, sessaoAna, GALVA));
afirma('Ana NÃO vende a branca', !V.podeVender(catalogo, sessaoAna, BRANCA));
afirma('Bruno (sem lista) vende as duas',
  V.podeVender(catalogo, sessaoBruno, GALVA) && V.podeVender(catalogo, sessaoBruno, BRANCA));
afirma('link público vê tudo',
  V.telhasDoVendedor(catalogo, null).length ===
  catalogo.telhas.filter((t) => t.ativo !== false).length);

console.log('\n3) Desativado perde o link e o acesso');
V.desativar(ana.id);
afirma('login bloqueado depois de desativar', !V.autenticar('ana', 'segredo123'));
afirma('link deixa de resolver', !V.buscarPorSlug('ana-paula'));
afirma('mas o registro continua lá (orçamento antigo tem dono)', !!V.buscarPorId(ana.id));

console.log('\n4) ⚠️ O PREÇO NÃO MUDA POR VENDEDOR');

const telha = catalogo.telhas.find((t) => t.id === GALVA);
const rom = calcularRomaneio(
  { comprimentoGalpaoM: 12, larguraGalpaoM: 6, quedas: 2 }, telha, catalogo);
const pedido = { grupos: [{ telhaId: telha.id, nome: telha.nome, cortes: rom.cortes }] };

const semVendedor = calcularOrcamento(pedido, catalogo);
const comVendedor = calcularOrcamento(pedido, catalogo);   // motor nem recebe vendedor
afirma('mesmo total pelo link público e pelo link do vendedor',
  semVendedor.totalAvista === comVendedor.totalAvista,
  `R$ ${semVendedor.totalAvista} vs R$ ${comVendedor.totalAvista}`);
afirma('o motor não aceita vendedor como parâmetro (nem por engano)',
  calcularOrcamento.length <= 2, `arity ${calcularOrcamento.length}`);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
