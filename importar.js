/**
 * IMPORTADOR VIA LINHA DE COMANDO — lê os CSVs de planilhas/ e grava o catálogo.
 * A empresa normalmente usa a tela /painel/dados; este script é para uso técnico.
 *
 * Uso:  node importar.js
 */
const fs = require('fs');
const path = require('path');
const { processar, aplicar } = require('./importador');

const DIR = path.join(__dirname, 'planilhas');
const DESTINO = path.join(__dirname, 'catalogo.json');
const ler = (f) => { try { return fs.readFileSync(path.join(DIR, f), 'utf8'); } catch { return null; } };

console.log('\n📥 Importando planilhas de planilhas/ ...\n');

const catalogo = JSON.parse(fs.readFileSync(DESTINO, 'utf8'));
const r = processar({
  produtosCsv: ler('1-produtos.csv'),
  fretesCsv: ler('2-fretes.csv'),
  unidadesCsv: ler('3-unidades.csv'),
}, catalogo);

console.log('  Produtos por família:');
Object.entries(r.resumo.porFamilia).forEach(([f, n]) => console.log(`     • ${f}: ${n}`));
console.log(`\n  Total: ${r.resumo.produtos} produtos em ${r.resumo.familias} famílias`);
console.log(`  Frete: ${r.resumo.faixasFrete} faixas`);
console.log(`  Unidades: ${r.resumo.unidadesAtivas} ativas de ${r.resumo.unidadesTotal}`);

if (r.alertas.length) {
  console.log('\n⚠️  Avisos:');
  r.alertas.forEach((a) => console.log('   - ' + a));
}
if (!r.ok) {
  console.log('\n❌ Erros — nada foi gravado:');
  r.erros.forEach((e) => console.log('   - ' + e));
  process.exit(1);
}

fs.writeFileSync(DESTINO, JSON.stringify(aplicar(catalogo, r), null, 2));
console.log('\n✅ catalogo.json atualizado. Rode "npm test" para conferir os cálculos.\n');
