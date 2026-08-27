/**
 * CONFERIR UM CÁLCULO PASSO A PASSO.
 *
 * Mostra tudo que o motor fez para uma telha e uma medida — o cadastro que
 * ele leu, cada conta, a lista de cortes e os acabamentos. Serve para comparar
 * com o que o vendedor faz à mão e achar exatamente onde diverge.
 *
 *   node conferir.js <codigo-da-telha> <comprimento> <largura> <quedas>
 *
 * Exemplos:
 *   node conferir.js 2005 12 6 2
 *   node conferir.js 358769 12 6 2     (o orçamento aprovado, para comparar)
 *   node conferir.js                    (lista as telhas cadastradas)
 *
 * Lê o catálogo EM USO (dados/catalogo.json), o mesmo do site.
 */
const { getCatalogo } = require('./pricing');
const { calcularRomaneio } = require('./romaneio');
const { calcularOrcamento } = require('./engine');

const N = (v, c = 2) => (v === null || v === undefined || v === '')
  ? '— não cadastrado —' : Number(v).toFixed(c).replace('.', ',');

(async () => {
  const catalogo = await getCatalogo();
  const [alvo, argL, argW, argQ] = process.argv.slice(2);

  if (!alvo) {
    console.log('\nTelhas no catálogo em uso:\n');
    for (const t of catalogo.telhas || []) {
      console.log(`  ${String(t.codigo || t.id).padEnd(10)} ${t.nome}`
        + `${t.ativo === false ? '   [INATIVA]' : ''}`);
    }
    console.log('\nUso: node conferir.js <codigo> <comprimento> <largura> <quedas>\n');
    return;
  }

  const telha = (catalogo.telhas || []).find(
    (t) => String(t.codigo) === String(alvo) || String(t.id) === String(alvo));
  if (!telha) return console.error(`\nNão achei telha com código/id "${alvo}". Rode sem argumentos para ver a lista.\n`);

  const L = Number(argL), W = Number(argW), quedas = Number(argQ) === 1 ? 1 : 2;
  if (!(L > 0) || !(W > 0)) return console.error('\nInforme comprimento e largura. Ex: node conferir.js 2005 12 6 2\n');

  const eng = catalogo.engenharia;
  const lin = (r, v) => console.log(`  ${String(r).padEnd(34)} ${v}`);

  console.log(`\n${'═'.repeat(66)}`);
  console.log(`  ${telha.nome}`);
  console.log(`  Galpão ${L} x ${W} m · ${quedas} água(s)`);
  console.log('═'.repeat(66));

  console.log('\n── CADASTRO DA TELHA (é daqui que sai tudo) ──');
  lin('Largura útil', N(telha.largura_util_m) + ' m');
  lin('Largura total', N(telha.largura_total_m) + ' m');
  lin('Comprimento máx. de fábrica', N(telha.comprimento_maximo_m) + ' m');
  lin('Comprimento mínimo', N(telha.comprimento_minimo_m) + ' m');
  lin('Inclinação mínima', N(telha.inclinacao_minima_pct, 0) + ' %');
  lin('Vão máximo entre terças', N(telha.vao_maximo_m) + ' m');
  lin('Núcleo', telha.atributos?.nucleo || '— não cadastrado —');

  // Erros de cadastro que distorcem o cálculo sem dar erro na tela
  const alertas = [];
  if (!(Number(telha.largura_util_m) > 0)) alertas.push('SEM LARGURA ÚTIL — o cálculo nem roda.');
  if (telha.largura_total_m && Number(telha.largura_util_m) >= Number(telha.largura_total_m)) {
    alertas.push(`Largura útil (${N(telha.largura_util_m)}) >= total (${N(telha.largura_total_m)}). `
      + 'A útil é a que sobra DEPOIS do encaixe, tem que ser menor.');
  }
  if (!(Number(telha.comprimento_maximo_m) > 0)) {
    alertas.push(`Sem comprimento máximo próprio — assumindo o padrão de ${N(eng.comprimento_maximo_fabricacao_m)} m. `
      + 'Se a fábrica desta telha corta menos que isso, a divisão em emendas sai errada.');
  }
  if (!telha.compativeis) alertas.push('Sem acabamento vinculado — vai aceitar qualquer um do catálogo.');
  else if (!(telha.compativeis.complementos || []).length) alertas.push('Nenhum acabamento marcado — sai só telha, sem cumeeira nem parafuso.');

  if (alertas.length) {
    console.log('\n⚠️  ATENÇÃO NO CADASTRO');
    for (const a of alertas) console.log(`  · ${a}`);
  }

  const rom = calcularRomaneio(
    { comprimentoGalpaoM: L, larguraGalpaoM: W, quedas }, telha, catalogo);

  console.log('\n── COMO O MOTOR CHEGOU NO RESULTADO ──');
  for (const m of rom.memoria) console.log(`  · ${m}`);

  console.log('\n── CONFERÊNCIA DAS CONTAS ──');
  const projecao = quedas === 2 ? W / 2 : W;
  const pct = Number(eng.acrescimo_2_quedas_pct);
  lin('Projeção da água', `${W} ${quedas === 2 ? '÷ 2 ' : ''}= ${N(projecao)} m`);
  lin('+ beiral', `${N(projecao)} + ${N(eng.beiral_m)} = ${N(projecao + eng.beiral_m)} m`);
  if (quedas === 2 && pct > 0) {
    lin(`+ ${pct}% (ângulo da telha)`, `× 1,${String(pct).padStart(2, '0')} = ${N(rom.compTelha)} m`);
  }
  lin('COMPRIMENTO DA TELHA', `${N(rom.compTelha)} m`);

  const lu = Number(telha.largura_util_m);
  const exato = L / lu;
  lin('Peças por água', `${L} ÷ ${N(lu)} = ${exato.toFixed(4).replace('.', ',')} → ${Math.ceil(exato)} peças`);
  if (Math.abs(exato - Math.round(exato)) > 0.001) {
    console.log(`     ↳ sobra ${N(Math.ceil(exato) * lu - L)} m de telha na última peça (arredondou pra cima)`);
  }
  lin('Peças no total', `${Math.ceil(exato)} × ${quedas} água(s) = ${rom.totalPecas}`);

  const metragem = rom.cortes.reduce((s, c) => s + c.quantidade * c.comprimentoM, 0);
  lin('METRAGEM', `${N(metragem)} m²`);

  console.log('\n── LISTA DE CORTES ──');
  for (const c of rom.cortes) {
    console.log(`  ${String(c.quantidade).padStart(4)} peças de ${N(c.comprimentoM)} m`);
  }
  if (rom.cortes.length > 1) {
    console.log('\n  ⚠️  A telha foi EMENDADA porque passou do comprimento de fábrica.');
    console.log(`     Isso multiplica a quantidade de peças. Máximo desta telha: ${N(telha.comprimento_maximo_m || eng.comprimento_maximo_fabricacao_m)} m.`);
  }

  console.log('\n── ACABAMENTOS (pelo perímetro, SEM o acréscimo) ──');
  lin('Frontal', `${N(rom.perimetro.frontalM)} m`);
  lin('Lateral', `${N(rom.perimetro.lateralM)} m`);
  lin('Cumeeira', `${N(rom.perimetro.cumeeiraM)} m`);

  // quantidades finais, já convertidas pelo motor (peça, barra ou metro)
  const complementos = (rom.complementos || []).map((c) => ({ produtoId: c.produtoId, metros: c.metros }));
  const { compativeisDaTelha } = require('./romaneio');
  for (const item of compativeisDaTelha(catalogo, telha, 'complementos')) {
    if (Number(item.consumo_por_m2) > 0 && !complementos.some((c) => c.produtoId === item.id)) {
      complementos.push({ produtoId: item.id });
    }
  }
  const orc = calcularOrcamento(
    { grupos: [{ telhaId: telha.id, cortes: rom.cortes }], complementos }, catalogo);

  console.log('\n── O QUE VAI NO ORÇAMENTO ──');
  for (const i of orc.itens) {
    console.log(`  ${String(i.qtd).padStart(6)} ${String(i.unidade || '').padEnd(4)} ${String(i.nome).slice(0, 44).padEnd(44)} R$ ${N(i.subtotal)}`);
  }
  console.log(`\n  ${' '.repeat(11)}${'TOTAL À VISTA'.padEnd(44)} R$ ${N(orc.totalAvista)}`);

  if (rom.avisos.length) {
    console.log('\n── AVISOS DO MOTOR ──');
    for (const a of rom.avisos) console.log(`  · ${a}`);
  }
  console.log('');
})().catch((e) => { console.error('\n💥', e.message, '\n'); process.exit(1); });
