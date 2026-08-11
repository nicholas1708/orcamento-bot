/**
 * TESTES DO MOTOR — validam as regras reais da 4A.
 * Rode com: npm test
 */
require('dotenv').config();
const { getCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { calcularRomaneio, parseCortes, corteComTamanho } = require('./romaneio');
const { gerarPDF } = require('./pdf');
const path = require('path');

const BRL = (v) => Number(v).toFixed(2);
let falhas = 0;
const check = (label, obtido, esperado, tol = 0.02) => {
  const ok = Math.abs(Number(obtido) - Number(esperado)) <= tol;
  if (!ok) falhas++;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${obtido} (esperado ${esperado})`);
};

(async () => {
  const catalogo = await getCatalogo();
  const telha = catalogo.telhas[0];               // Confort PIR 30mm Galvalume/Branco

  // ══ TESTE 1: preço por FAIXA DE METRAGEM ═══════════════════════════
  console.log('\n═══ TESTE 1 — Desconto por volume (faixas de metragem) ═══\n');
  const casos = [
    { m: 30,  esperado: 129.50, faixa: 'até 50 m²' },
    { m: 80,  esperado: 126.91, faixa: '50–100 m²' },
    { m: 150, esperado: 123.02, faixa: '100–200 m²' },
    { m: 300, esperado: 120.73, faixa: 'acima de 200 m²' },
  ];
  for (const c of casos) {
    const o = calcularOrcamento(
      { grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 10, quantidade: c.m / 10 }] }] },
      catalogo
    );
    check(`${String(c.m).padStart(3)} m² (${c.faixa}) → preço/m`, o.itens[0].precoUnit, c.esperado);
  }

  // ══ TESTE 2: acabamentos POR BARRA (arredonda pra cima) ════════════
  console.log('\n═══ TESTE 2 — Acabamentos vendidos por barra de 3m ═══\n');
  const lateral = catalogo.complementos.find((c) => c.aplica_em === 'lateral');
  const oBarras = calcularOrcamento({
    grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 6, quantidade: 10 }] }],
    complementos: [{ produtoId: lateral.id, metros: 20 }],   // 20m → 7 barras de 3m
  }, catalogo);
  const itemBarra = oBarras.itens.find((i) => String(i.codigo) === String(lateral.codigo));
  console.log(`  ${itemBarra.nome}`);
  check('20m de acabamento → barras', itemBarra.qtd, 7, 0);
  check('Subtotal das barras', itemBarra.subtotal, 7 * lateral.preco);

  // ══ TESTE 3: fixação por consumo/m² ════════════════════════════════
  console.log('\n═══ TESTE 3 — Parafusos por consumo/m² ═══\n');
  const paraf = catalogo.complementos.find((c) => c.tipo === 'fixacao');
  const oParaf = calcularOrcamento({
    grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 5, quantidade: 10 }] }], // 50 m²
    complementos: [{ produtoId: paraf.id }],
  }, catalogo);
  const itemParaf = oParaf.itens.find((i) => String(i.codigo) === String(paraf.codigo));
  check(`50 m² x ${paraf.consumo_por_m2}/m² → parafusos`, itemParaf.qtd, 50 * paraf.consumo_por_m2, 0);

  // ══ TESTE 4: frete EMBUTIDO não soma no total ══════════════════════
  console.log('\n═══ TESTE 4 — Frete embutido no preço ═══\n');
  const oFrete = calcularOrcamento({
    grupos: [{ telhaId: telha.id, cortes: [{ comprimentoM: 6, quantidade: 10 }] }],
    frete: { embutido: true, valor: 0, descricao: 'Frete incluso', km: 120, unidade: { cidade: 'Cambuí', uf: 'MG' } },
  }, catalogo);
  check('Frete não soma no total', oFrete.totalAvista, oFrete.totalProdutos);
  check('Total de frete zerado', oFrete.totalFrete, 0);

  // ══ TESTE 5: engenharia — ambiente → romaneio ══════════════════════
  console.log('\n═══ TESTE 5 — Galpão 20x10m, 2 águas ═══\n');
  const rom = calcularRomaneio({ comprimentoGalpaoM: 20, larguraGalpaoM: 10, quedas: 2 }, telha, catalogo);
  rom.memoria.forEach((m) => console.log('  · ' + m));
  console.log('  Cortes:', JSON.stringify(rom.cortes));
  check('Peças por água (20m ÷ 1,00m)', rom.cortes[0].quantidade, 40, 0); // 20 peças x 2 águas

  // ══ TESTE 6: água maior que o máximo → opções de emenda ════════════
  console.log('\n═══ TESTE 6 — Galpão 20x25m (água de 25m > máx 12m) ═══\n');
  const romLongo = calcularRomaneio({ comprimentoGalpaoM: 20, larguraGalpaoM: 25, quedas: 1 }, telha, catalogo);
  console.log(`  Água: ${romLongo.compTelha}m · máximo de fábrica: ${telha.comprimento_maximo_m}m`);
  romLongo.opcoes.forEach((o, i) =>
    console.log(`   ${i + 1}. ${o.titulo.padEnd(40)} ${o.emendas} emenda(s) · ${o.materialM}m`));
  check('Gerou opções de emenda', romLongo.opcoes.length >= 2 ? 1 : 0, 1, 0);
  check('Nenhuma peça acima do máximo',
    Math.max(...romLongo.cortes.map((c) => c.comprimentoM)) <= telha.comprimento_maximo_m ? 1 : 0, 1, 0);

  const custom = corteComTamanho(romLongo.compTelha, 10, telha, catalogo);
  console.log(`  Personalizado (peças de 10m): ${custom.erro || custom.titulo}`);

  // ══ TESTE 7: parser de texto livre ═════════════════════════════════
  console.log('\n═══ TESTE 7 — Parser de lista de cortes ═══\n');
  const parsed = parseCortes('3 de 4m, 9 de 4,75 e 5x6.20');
  console.log('  "3 de 4m, 9 de 4,75 e 5x6.20" →', JSON.stringify(parsed));
  check('Cortes reconhecidos', parsed.length, 3, 0);

  // ══ PDF de exemplo ════════════════════════════════════════════════
  const orc = calcularOrcamento({
    grupos: [{ telhaId: telha.id, cortes: [
      { comprimentoM: 6.20, quantidade: 12 },
      { comprimentoM: 4.75, quantidade: 8 },
    ] }],
    complementos: [
      { produtoId: lateral.id, metros: 24 },
      { produtoId: paraf.id },
    ],
    frete: { embutido: true, valor: 0, descricao: 'Frete incluso — sai de Cambuí/MG (180 km)', km: 180 },
  }, catalogo);

  console.log('\n═══ ORÇAMENTO DE EXEMPLO ═══\n');
  orc.itens.forEach((i) => console.log(
    `  ${String(i.qtd).padStart(5)} ${i.unidade.padEnd(3)} ${i.nome.slice(0, 52).padEnd(52)} R$ ${BRL(i.subtotal).padStart(10)}`));
  console.log('  ' + '─'.repeat(80));
  console.log(`  ${orc.metragemTotal} mts · TOTAL R$ ${BRL(orc.totalAvista)}`);
  orc.pagamentos.forEach((p) => console.log(`    ${p.parcelas}x de R$ ${BRL(p.valorParcela)} (total R$ ${BRL(p.total)})`));

  const pdfPath = path.join(__dirname, 'out', 'orcamento-exemplo.pdf');
  await gerarPDF({
    cliente: { nome: 'ENG SANTANA', telefone: '(17) 99154-1795', cidade: 'São José do Rio Preto - SP',
      estado: 'SP', endereco: 'Rua Exemplo, 100 - Centro', documento: '', cep: '', email: '' },
    pedido: { numero: 'TESTE-001', vendedor: catalogo.empresa.vendedor_padrao },
    orcamento: orc, catalogo,
  }, pdfPath);
  console.log(`\n📄 PDF: ${pdfPath}`);

  console.log(falhas === 0 ? '\n🎉 Todos os testes passaram.\n' : `\n⚠️  ${falhas} verificação(ões) falharam.\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
