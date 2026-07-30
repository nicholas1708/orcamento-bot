/**
 * TESTE DE REGRESSÃO — reproduz o orçamento REAL nº 11247 da 4A.
 * Se o motor estiver correto, deve bater exatamente:
 *   37 peças · 134,390 mts · R$ 4.502,07
 *   parcelamentos: 1x 4.699,49 · 3x 4.841,48 · 6x 4.985,14 · 10x 5.300,29
 *
 * Rode com: npm test
 */
require('dotenv').config();
const { getCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { calcularRomaneio, parseCortes } = require('./romaneio');
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

  // ══ TESTE 1: reproduzir o orçamento real nº 11247 ══════════════════
  console.log('\n═══ TESTE 1 — Orçamento real nº 11247 (ENG SANTANA) ═══\n');
  const pedidoReal = {
    telhaId: 'TL-GV-TP40-980',
    cortes: [
      { comprimentoM: 4.000, quantidade: 3 },
      { comprimentoM: 1.530, quantidade: 3 },
      { comprimentoM: 4.750, quantidade: 9 },
      { comprimentoM: 6.200, quantidade: 5 },
      { comprimentoM: 4.680, quantidade: 4 },
      { comprimentoM: 1.630, quantidade: 7 },
      { comprimentoM: 1.870, quantidade: 4 },
      { comprimentoM: 3.220, quantidade: 2 },
    ],
  };
  const orc = calcularOrcamento(pedidoReal, catalogo);

  for (const i of orc.itens) {
    console.log(`  ${String(i.qtd).padStart(2)} x ${String(i.comprimentoM.toFixed(3)).padStart(6)}m  →  R$ ${BRL(i.subtotal).padStart(9)}`);
  }
  console.log('  ' + '─'.repeat(46));
  check('Total de peças', orc.totalPecas, 37, 0);
  check('Metragem total (mts)', orc.metragemTotal, 134.390, 0.001);
  check('Total à vista (R$)', orc.totalAvista, 4502.07);

  console.log('\n  Formas de pagamento:');
  const esperadoPgto = { 1: 4699.49, 3: 4841.48, 6: 4985.14, 10: 5300.29 };
  for (const p of orc.pagamentos) {
    check(`  ${p.parcelas}x (R$)`, p.total, esperadoPgto[p.parcelas], 1.0);
  }

  // ══ TESTE 2: engenharia — ambiente → romaneio ══════════════════════
  console.log('\n═══ TESTE 2 — Ambiente 20x10m, 2 águas, com estrutura ═══\n');
  const telha = catalogo.telhas.find((t) => t.id === 'TL-GV-TP40-980');
  const rom = calcularRomaneio(
    { comprimentoGalpaoM: 20, larguraGalpaoM: 10, quedas: 2, comEstrutura: true },
    telha, catalogo
  );
  rom.memoria.forEach((m) => console.log('  · ' + m));
  console.log('  Cortes:', JSON.stringify(rom.cortes));
  console.log('  Perfis:', JSON.stringify(rom.perfis));
  if (rom.avisos.length) console.log('  Avisos:', rom.avisos.join(' | '));

  const orc2 = calcularOrcamento({ telhaId: telha.id, cortes: rom.cortes, perfis: rom.perfis }, catalogo);
  console.log(`  → ${orc2.totalPecas} peças · ${orc2.metragemTotal} mts · R$ ${BRL(orc2.totalAvista)}`);

  // ══ TESTE 2b: vários produtos no mesmo orçamento ═══════════════════
  console.log('\n═══ TESTE 2b — Orçamento com 3 produtos (fábrica) ═══\n');
  const multi = calcularOrcamento({
    grupos: [
      { telhaId: 'TL-GV-TP40-980', cortes: [{ comprimentoM: 6.2, quantidade: 20 }, { comprimentoM: 4.5, quantidade: 12 }] },
      { telhaId: 'TL-TRANS-ISOLUZ', cortes: [{ comprimentoM: 6.0, quantidade: 4 }] },
      { telhaId: 'TL-EPS-SAND', cortes: [{ comprimentoM: 5.0, quantidade: 8 }] },
    ],
  }, catalogo);
  multi.resumoPorProduto.forEach((p) =>
    console.log(`  ${p.nome.padEnd(45).slice(0, 45)} ${String(p.pecas).padStart(3)} pç · ${String(p.metros).padStart(8)} mts · R$ ${BRL(p.subtotal).padStart(10)}`));
  console.log('  ' + '─'.repeat(46));
  console.log(`  TOTAL: ${multi.totalPecas} peças · ${multi.metragemTotal} mts · R$ ${BRL(multi.totalAvista)}`);
  check('Produtos no orçamento', multi.resumoPorProduto.length, 3, 0);
  check('Peças somadas', multi.totalPecas, 44, 0);

  // ══ TESTE 3: parser de lista de cortes em texto livre ══════════════
  console.log('\n═══ TESTE 3 — Parser de texto livre ═══\n');
  const parsed = parseCortes('3 de 4m, 9 de 4,75 e 5x6.20');
  console.log('  "3 de 4m, 9 de 4,75 e 5x6.20" →', JSON.stringify(parsed));
  check('Cortes reconhecidos', parsed.length, 3, 0);

  // ══ PDF de exemplo ════════════════════════════════════════════════
  const pdfPath = path.join(__dirname, 'out', 'orcamento-exemplo.pdf');
  await gerarPDF({
    cliente: {
      nome: 'ENG SANTANA', telefone: '(17) 99154-1795',
      cidade: 'São José do Rio Preto - SP', estado: 'SP',
      endereco: 'Rua Exemplo, 100 - Centro', documento: '', cep: '', email: '',
    },
    pedido: { numero: '11247', vendedor: 'André Luis' },
    orcamento: orc,
    catalogo,
  }, pdfPath);
  console.log(`\n📄 PDF gerado: ${pdfPath}`);

  console.log(falhas === 0
    ? '\n🎉 Todos os testes passaram — motor bate com o orçamento real.\n'
    : `\n⚠️  ${falhas} verificação(ões) falharam — revisar catálogo/motor.\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
