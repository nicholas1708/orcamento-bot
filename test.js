/**
 * TESTES DO MOTOR — conferidos contra ORÇAMENTOS OFICIAIS da 4A.
 * Rode com: npm test
 */
require('dotenv').config();
const { getCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { calcularRomaneio, parseCortes, complementosPorPerimetro } = require('./romaneio');
const { gerarPDF } = require('./pdf');
const path = require('path');

const BRL = (v) => Number(v).toFixed(2);
let falhas = 0;
const check = (label, obtido, esperado, tol = 0.02) => {
  const ok = Math.abs(Number(obtido) - Number(esperado)) <= tol;
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} ${String(label).padEnd(46)} ${String(obtido).padStart(11)}  (oficial ${esperado})`);
};

(async () => {
  const catalogo = await getCatalogo();
  // Para reproduzir o orçamento MANUAL, a tolerância precisa estar desligada:
  // o GestãoClick não concede desconto por proximidade. A regra da 4A no sistema
  // é testada logo depois, em bloco próprio.
  const semTolerancia = JSON.parse(JSON.stringify(catalogo));
  semTolerancia.regras.faixa_tolerancia_pct = 0;
  const telha = catalogo.telhas.find((t) => t.codigo === '358769');
  const cum = catalogo.complementos.find((c) => c.codigo === '148384');
  const fro = catalogo.complementos.find((c) => c.codigo === '143019');
  const lat = catalogo.complementos.find((c) => c.codigo === '152327');
  const pFix = catalogo.complementos.find((c) => c.codigo === '6391P4');
  const pCos = catalogo.complementos.find((c) => c.codigo === 'PA-101');

  /* ══════════════════════════════════════════════════════════════════
     COMPARAÇÃO COM O ORÇAMENTO OFICIAL Nº 11454
     Cliente: Angelica Andrade de Farias · Entrega: Frutal-MG
     Galpão deduzido: 10 x 10 m, 2 águas (20 telhas de 5,00 m = 100 mts)
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  COMPARAÇÃO — Orçamento oficial nº 11454 (Angelica A. de Farias)    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const orc = calcularOrcamento({
    grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 5.0, quantidade: 20 }] }],
    complementos: [
      { produtoId: cum.id,  quantidade: 10 },   // 10 m de cumeeira
      { produtoId: fro.id,  quantidade: 20 },   // 2 beirais x 10 m
      { produtoId: lat.id,  quantidade: 20 },   // 4 bordas x 5 m
      { produtoId: pFix.id },                   // 3/m²  → 300
      { produtoId: pCos.id },                   // 1,5/m² → 150
    ],
    frete: { embutido: true, valor: 0, descricao: 'Frete grátis' },
  }, semTolerancia);

  console.log('  ITEM                                              NOSSO      OFICIAL');
  console.log('  ' + '─'.repeat(70));
  const oficial = [
    { nome: 'Telha Confort PIR — 20 x 5,00m', qtd: 20, unit: 126.910, sub: 12691.00 },
    { nome: 'Cumeeira Galvalume',             qtd: 10, unit: 46.090,  sub: 460.90 },
    { nome: 'Acabamento Frontal',             qtd: 20, unit: 25.100,  sub: 502.00 },
    { nome: 'Acabamento Lateral',             qtd: 20, unit: 27.480,  sub: 549.60 },
    { nome: 'Parafuso Fixação',               qtd: 300, unit: 1.250,  sub: 375.00 },
    { nome: 'Parafuso Costura',               qtd: 150, unit: 0.450,  sub: 67.50 },
  ];
  orc.itens.forEach((it, i) => {
    const o = oficial[i] || {};
    console.log(`  ${String(i + 1).padStart(2)}. ${(o.nome || it.nome).slice(0, 34).padEnd(34)}` +
      ` ${String(it.qtd).padStart(6)} x ${BRL(it.precoUnit).padStart(7)} = ${BRL(it.subtotal).padStart(9)}` +
      `  | ${BRL(o.sub || 0).padStart(9)}`);
  });
  console.log('  ' + '─'.repeat(70));

  console.log('\n  Conferência linha a linha:\n');
  oficial.forEach((o, i) => {
    const it = orc.itens[i];
    if (!it) { falhas++; console.log(`❌ item ${i + 1} não gerado`); return; }
    check(`${o.nome} — quantidade`, it.qtd, o.qtd, 0.001);
    check(`${o.nome} — preço unitário`, it.precoUnit, o.unit, 0.005);
    check(`${o.nome} — subtotal`, it.subtotal, o.sub);
  });

  console.log('\n  Totais:\n');
  check('Metragem total (mts)', orc.metragemTotal, 100.000, 0.001);
  check('Soma das quantidades', orc.itens.reduce((s, i) => s + i.qtd, 0), 520, 0.001);
  check('TOTAL À VISTA (R$)', orc.totalAvista, 14646.00);

  console.log('\n  Parcelamentos:\n');
  const parcOficial = { 1: 15288.23, 3: 15750.16, 6: 16217.52, 10: 17242.74 };
  orc.pagamentos.forEach((p) => check(`${p.parcelas}x — total`, p.total, parcOficial[p.parcelas], 1.0));

  /* ══════════════════════════════════════════════════════════════════
     A REGRA DE DESCONTO DO SISTEMA — o online sai mais barato
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Mesmo pedido, agora com a regra de desconto do sistema             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const orcSistema = calcularOrcamento({
    grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 5.0, quantidade: 20 }] }],
    complementos: [
      { produtoId: cum.id, quantidade: 10 }, { produtoId: fro.id, quantidade: 20 },
      { produtoId: lat.id, quantidade: 20 }, { produtoId: pFix.id }, { produtoId: pCos.id },
    ],
    frete: { embutido: true, valor: 0, descricao: 'Frete grátis' },
  }, catalogo);                                   // catálogo real, com tolerância

  const tol = catalogo.regras.faixa_tolerancia_pct;
  const dif = orc.totalAvista - orcSistema.totalAvista;
  console.log(`  Tolerância configurada: ${tol}%  (limites efetivos: 47,5 / 95 / 190 m²)\n`);
  console.log(`  Orçamento manual (GestãoClick) ....... R$ ${BRL(orc.totalAvista).padStart(10)}`);
  console.log(`  Orçamento pelo sistema ............... R$ ${BRL(orcSistema.totalAvista).padStart(10)}`);
  console.log(`  ${'─'.repeat(48)}`);
  console.log(`  Cliente economiza .................... R$ ${BRL(dif).padStart(10)}` +
    `  (${(dif / orc.totalAvista * 100).toFixed(1)}%)\n`);
  console.log(`  Preço da telha: R$ ${BRL(orc.itens[0].precoUnit)}/m no manual` +
    ` → R$ ${BRL(orcSistema.itens[0].precoUnit)}/m no sistema`);
  if (dif > 0) console.log('  ✅ O orçamento online sai mais barato — é o incentivo para o cliente usar o sistema.');
  else console.log('  ⚠️  Sem diferença neste volume (a tolerância só age perto do limite da faixa).');

  /* ══════════════════════════════════════════════════════════════════
     O CAMINHO AUTOMÁTICO chega no mesmo lugar?
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  "Calcular pra mim" — galpão 10 x 10 m, 2 águas                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  const rom = calcularRomaneio({ comprimentoGalpaoM: 10, larguraGalpaoM: 10, quedas: 2 }, telha, catalogo);
  rom.memoria.forEach((m) => console.log('  · ' + m));
  console.log('  Cortes:', JSON.stringify(rom.cortes));
  console.log('  Perímetro:', JSON.stringify(rom.perimetro));
  check('Peças (10m ÷ 1,00m x 2 águas)', rom.cortes[0].quantidade, 20, 0);
  check('Cumeeira sugerida (m)', rom.perimetro.cumeeiraM, 10, 0.01);
  check('Frontal sugerido (m)', rom.perimetro.frontalM, 20, 0.01);
  check('Lateral sugerido (m)', rom.perimetro.lateralM, 20, 0.6);
  console.log('  ⚠️  O comprimento da telha sai um pouco maior (beiral + inclinação);');
  console.log('     no orçamento oficial o vendedor usou 5,00m exatos.');

  /* ══════════════════════════════════════════════════════════════════
     Faixas de preço (sem tolerância — confirmado pelo 11454)
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n═══ Faixas de preço ═══\n');
  console.log('  Tabela oficial (sem tolerância):');
  for (const c of [{ m: 30, p: 129.50 }, { m: 100, p: 126.91 }, { m: 150, p: 123.02 }, { m: 300, p: 120.73 }]) {
    const o = calcularOrcamento(
      { grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 10, quantidade: c.m / 10 }] }] }, semTolerancia);
    check(`${String(c.m).padStart(3)} m² → preço/m`, o.itens[0].precoUnit, c.p);
  }
  console.log('\n  Com a regra do sistema (tolerância de ' + catalogo.regras.faixa_tolerancia_pct + '%):');
  for (const m of [46, 48, 92, 96, 185, 195]) {
    const o = calcularOrcamento(
      { grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 1, quantidade: m }] }] }, catalogo);
    const s = calcularOrcamento(
      { grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 1, quantidade: m }] }] }, semTolerancia);
    const ganhou = o.itens[0].precoUnit < s.itens[0].precoUnit;
    console.log(`   ${ganhou ? '🎁' : '  '} ${String(m).padStart(3)} m² → R$ ${BRL(o.itens[0].precoUnit)}/m` +
      (ganhou ? `  (manual seria R$ ${BRL(s.itens[0].precoUnit)} — economiza R$ ${BRL(s.totalAvista - o.totalAvista)})` : ''));
  }

  /* PDF de exemplo, reproduzindo o orçamento oficial */
  const pdfPath = path.join(__dirname, 'out', 'comparacao-11454.pdf');
  await gerarPDF({
    cliente: { nome: 'ANGELICA ANDRADE DE FARIAS', telefone: '(17)98142-6610',
      cidade: 'Cedral', estado: 'SP', documento: '396.687.878-03', cep: '15895-314',
      email: 'atelieangelicafarias@gmail.com',
      endereco: 'Rua Carolina Capuano Montanhim, 353 (CASA) - Residencial Recanto Antonio Silva Filho' },
    pedido: { numero: '11454-TESTE', vendedor: 'André Luis' },
    orcamento: orc, catalogo,
  }, pdfPath);
  console.log(`\n📄 PDF comparativo: ${pdfPath}`);

  console.log(falhas === 0
    ? '\n🎉 TODOS OS VALORES BATEM COM O ORÇAMENTO OFICIAL.\n'
    : `\n⚠️  ${falhas} divergência(s) — revisar catálogo/motor.\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
