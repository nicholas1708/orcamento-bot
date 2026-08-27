/**
 * MIGRAÇÃO DO VÍNCULO — ela escreve no catálogo de produção, então precisa
 * de teste mais do que qualquer outra coisa aqui.
 *
 * O que não pode acontecer, em ordem de gravidade:
 *   1. sobrescrever vínculo que o dono escolheu no painel
 *   2. apagar produto que só existe no servidor
 *   3. vincular id que não existe no catálogo em uso
 *   4. rodar duas vezes e mexer de novo
 *
 *   node teste-migracao.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-'));
process.env.DADOS_DIR = TMP;

const { migrarVinculos } = require('./catalogo-arquivo');
const semente = require('./catalogo.json');
const EM_USO = path.join(TMP, 'catalogo.json');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}
const escrever = (c) => fs.writeFileSync(EM_USO, JSON.stringify(c, null, 2));
const ler = () => JSON.parse(fs.readFileSync(EM_USO, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(semente));

/* ── 1) servidor antigo: catálogo sem vínculo nenhum ───────────────── */
console.log('\n1) Servidor que já rodava, sem vínculo no catálogo');
const velho = clone();
for (const t of velho.telhas) delete t.compativeis;
escrever(velho);

const r1 = migrarVinculos();
afirma('migrou as duas telhas', r1.migradas === 2, `${r1.migradas} telha(s)`);

const dep = ler();
const galva = dep.telhas.find((t) => t.id === 'P358769');
const branca = dep.telhas.find((t) => t.id === 'P358768');
afirma('galvalume ficou com a cumeeira galvalume',
  galva.compativeis.complementos.includes('P148384'));
afirma('branca ficou com a cumeeira branca',
  branca.compativeis.complementos.includes('P148474'));
afirma('branca NÃO ficou com a galvalume',
  !branca.compativeis.complementos.includes('P148384'),
  branca.compativeis.complementos.join(', '));
afirma('os parafusos entraram',
  branca.compativeis.complementos.includes('P6391P4')
  && branca.compativeis.complementos.includes('PPA-101'));
afirma('gravou o backup antes de mexer',
  fs.existsSync(path.join(TMP, 'catalogo.antes-do-vinculo.json')));

/* ── 2) rodar de novo não mexe em nada ─────────────────────────────── */
console.log('\n2) Subindo de novo (idempotência)');
const antes = fs.readFileSync(EM_USO, 'utf8');
const r2 = migrarVinculos();
afirma('não migrou nada na segunda vez', r2.migradas === 0);
afirma('arquivo byte a byte igual', fs.readFileSync(EM_USO, 'utf8') === antes);

/* ── 3) escolha do painel é intocável ──────────────────────────────── */
console.log('\n3) O que o dono escolheu no painel');
const escolhido = clone();
escolhido.telhas.find((t) => t.id === 'P358768').compativeis =
  { complementos: ['P143019'], perfis: [] };        // só frontal, de propósito
delete escolhido.telhas.find((t) => t.id === 'P358769').compativeis;
escrever(escolhido);

const r3 = migrarVinculos();
afirma('mexeu só na telha sem vínculo', r3.migradas === 1, `${r3.migradas} telha(s)`);
afirma('escolha manual preservada',
  JSON.stringify(ler().telhas.find((t) => t.id === 'P358768').compativeis.complementos)
  === JSON.stringify(['P143019']));

/* ── 4) catálogo do servidor diferente da semente ──────────────────── */
console.log('\n4) Catálogo do servidor com produto próprio');
const proprio = clone();
for (const t of proprio.telhas) delete t.compativeis;
// telha cadastrada direto no painel, que a semente não conhece
proprio.telhas.push({ id: 'P900000', nome: 'Telha só do servidor', ativo: true });
// e o servidor NÃO tem um dos acabamentos que a semente vincula
proprio.complementos = proprio.complementos.filter((c) => c.id !== 'P142962');
escrever(proprio);

const r4 = migrarVinculos();
afirma('telha só do servidor continua lá',
  ler().telhas.some((t) => t.id === 'P900000'));
afirma('telha desconhecida ficou sem vínculo (o painel avisa)',
  !ler().telhas.find((t) => t.id === 'P900000').compativeis);
afirma('não vinculou acabamento que não existe aqui',
  !ler().telhas.find((t) => t.id === 'P358768').compativeis.complementos.includes('P142962'));
afirma('e as duas conhecidas foram migradas', r4.migradas === 2, `${r4.migradas}`);

/* ── 4b) Pix chega no catálogo do servidor ─────────────────────────── */
console.log('\n4b) Pix (o motivo de o bloco sumir do PDF)');
const semPix = clone();
delete semPix.empresa.pix;
escrever(semPix);
migrarVinculos();
afirma('chave Pix preenchida',
  ler().empresa.pix?.chave === semente.empresa.pix.chave, ler().empresa.pix?.chave);

// e não pode trocar chave que já está lá — dinheiro indo pra conta errada
const outraChave = clone();
outraChave.empresa.pix = { chave: 'financeiro@4a.com.br', nome: 'X', cidade: 'Y' };
escrever(outraChave);
migrarVinculos();
afirma('chave já cadastrada é intocável',
  ler().empresa.pix.chave === 'financeiro@4a.com.br', ler().empresa.pix.chave);

/* ── 5) arquivo corrompido não derruba o serviço ───────────────────── */
console.log('\n5) Catálogo corrompido');
fs.writeFileSync(EM_USO, '{ isso não é json');
let quebrou = false;
try { migrarVinculos(); } catch { quebrou = true; }
afirma('não lança exceção (o servidor precisa subir)', !quebrou);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
