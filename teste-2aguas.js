/**
 * REGRESSÃO — orçamento WEB-MT4BVQJI, galpão 12 x 6m de 2 águas.
 *
 * Este é o orçamento que a empresa conferiu e aprovou. Ele fixa TRÊS regras
 * que já erramos uma vez:
 *
 *   1. o acréscimo de 30% de 2 águas vale só para o COMPRIMENTO DA TELHA;
 *   2. cumeeira e frontal saem do perímetro puro, sem acréscimo;
 *   3. acabamento lateral é faturado em BARRA FECHADA de 3m.
 *
 * Uso: node teste-2aguas.js
 */
const { getCatalogo } = require('./pricing');
const { calcularRomaneio } = require('./romaneio');
const { calcularOrcamento } = require('./engine');

const L = 12, W = 6, QUEDAS = 2;

const ESPERADO = {
  compTelha: 4.03,
  pecas: 24,
  metragem: 96.72,
  cumeeira: 12,     // P148384 — un
  frontal: 24,      // P143019 — un
  lateral: 18,      // P152327 — metros (6 barras de 3m)
  parafusoFix: 291, // 6391P4  — 3 por m²
  parafusoCost: 146, // PA-101 — 1,5 por m²
};

let falhas = 0;
const confere = (rot, obtido, esperado, tol = 0.005) => {
  const ok = Math.abs(Number(obtido) - Number(esperado)) <= tol;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✅' : '❌'} ${rot}: ${obtido}${ok ? '' : `   (esperado ${esperado})`}`);
};

(async () => {
  const catalogo = await getCatalogo();
  const telha = catalogo.telhas.find((t) => t.codigo === '358769') || catalogo.telhas[0];

  console.log(`\n═══ ORÇAMENTO WEB-MT4BVQJI — ${L}x${W}m, ${QUEDAS} águas ═══`);
  console.log(`Telha: ${telha.nome}\n`);

  const rom = calcularRomaneio(
    { comprimentoGalpaoM: L, larguraGalpaoM: W, quedas: QUEDAS }, telha, catalogo
  );

  console.log('Romaneio');
  confere('comprimento da telha', rom.compTelha, ESPERADO.compTelha);
  confere('peças no total', rom.totalPecas, ESPERADO.pecas);
  confere('metragem', rom.cortes.reduce((s, c) => s + c.quantidade * c.comprimentoM, 0), ESPERADO.metragem, 0.02);

  // quantidades finais passam pelo motor (é ele que converte metros em peças)
  const complementos = (rom.complementos || []).map((c) => ({ produtoId: c.produtoId, metros: c.metros }));
  for (const item of (catalogo.complementos || [])) {
    if (Number(item.consumo_por_m2) > 0 && !complementos.some((c) => c.produtoId === item.id)) {
      complementos.push({ produtoId: item.id });
    }
  }
  const orc = calcularOrcamento(
    { grupos: [{ telhaId: telha.id, cortes: rom.cortes }], complementos }, catalogo
  );

  const qtdDe = (codigo) => {
    const it = orc.itens.find((x) => String(x.codigo) === codigo);
    return it ? it.qtd : 0;
  };

  console.log('\nAcabamentos e fixação');
  confere('cumeeira (un)', qtdDe('148384'), ESPERADO.cumeeira);
  confere('frontal (un)', qtdDe('143019'), ESPERADO.frontal);
  confere('lateral (m)', qtdDe('152327'), ESPERADO.lateral);
  confere('parafuso fixação (un)', qtdDe('6391P4'), ESPERADO.parafusoFix);
  confere('parafuso costura (un)', qtdDe('PA-101'), ESPERADO.parafusoCost);

  console.log('\nMemória de cálculo');
  for (const m of rom.memoria) console.log(`  · ${m}`);

  console.log(falhas ? `\n❌ ${falhas} divergência(s).\n` : '\n✅ Bate com o orçamento aprovado.\n');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('\n💥', e.message); process.exit(1); });
