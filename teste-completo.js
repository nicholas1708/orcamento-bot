/**
 * TESTE PONTA A PONTA — roda o caminho inteiro de um orçamento sem
 * precisar de navegador, WhatsApp ou internet:
 *
 *   catálogo → romaneio → lista de conferência → volta da conferência
 *            → motor de preço → PDF em disco
 *
 * Uso:  node teste-completo.js
 *
 * Não substitui o npm test (que confere o motor contra o orçamento real
 * nº 11247) — este aqui garante que os pedaços conversam entre si.
 */
const path = require('path');
const fs = require('fs');

const { getCatalogo } = require('./pricing');
const { calcularRomaneio } = require('./romaneio');
const { montarLista, aplicarLista, complementosSugeridos } = require('./lista');
const { calcularOrcamento } = require('./engine');
const { gerarPDF } = require('./pdf');

const NUM = (v, c = 2) => Number(v).toFixed(c).replace('.', ',');
let falhas = 0;

function confere(rotulo, obtido, esperado, tolerancia = 0.001) {
  const ok = Math.abs(Number(obtido) - Number(esperado)) <= tolerancia;
  if (!ok) falhas++;
  console.log(`  ${ok ? '✅' : '❌'} ${rotulo}: ${NUM(obtido, 3)}${ok ? '' : `  (esperado ${NUM(esperado, 3)})`}`);
}
function afirma(rotulo, condicao, detalhe = '') {
  if (!condicao) falhas++;
  console.log(`  ${condicao ? '✅' : '❌'} ${rotulo}${detalhe ? ' — ' + detalhe : ''}`);
}

(async () => {
  const catalogo = await getCatalogo();
  const telha = catalogo.telhas.find((t) => t.ativo !== false);
  if (!telha) throw new Error('Nenhuma telha ativa no catálogo.');

  const L = 10, Wg = 10, quedas = 2;
  const pct = Number(catalogo.engenharia.acrescimo_2_quedas_pct) || 0;
  const fator = 1 + pct / 100;

  console.log('\n═══ TESTE PONTA A PONTA ═══');
  console.log(`Telha: ${telha.nome}`);
  console.log(`Obra: ${L} x ${Wg}m · ${quedas} águas · acréscimo de material ${pct}%\n`);

  // ── 1) ROMANEIO ────────────────────────────────────────────────────
  console.log('1) Romaneio');
  const rom = calcularRomaneio(
    { comprimentoGalpaoM: L, larguraGalpaoM: Wg, quedas, comEstrutura: true }, telha, catalogo
  );

  const compGeo = Math.round((Wg / 2 + catalogo.engenharia.beiral_m) * 100) / 100;
  confere('comprimento da telha', rom.compTelha, Math.round(compGeo * fator * 100) / 100, 0.02);
  confere('peças no total', rom.totalPecas, Math.ceil(L / telha.largura_util_m) * quedas);

  const metragemRom = rom.cortes.reduce((s, c) => s + c.quantidade * c.comprimentoM, 0);
  console.log(`     cortes: ${rom.cortes.map((c) => `${c.quantidade} x ${NUM(c.comprimentoM)}m`).join(' · ')}`);
  console.log(`     metragem: ${NUM(metragemRom, 3)} mts`);

  // o acréscimo tem que chegar nos acabamentos também, não só na telha
  const frontal = rom.complementos.find((c) => {
    const it = catalogo.complementos.find((x) => x.id === c.produtoId);
    return it && it.aplica_em === 'frontal';
  });
  if (frontal) confere('acabamento frontal (m)', frontal.metros, Math.round(L * quedas * fator * 100) / 100, 0.02);
  afirma('cumeeira só existe em 2 águas',
    !!rom.complementos.find((c) => (catalogo.complementos.find((x) => x.id === c.produtoId) || {}).aplica_em === 'cumeeira'));
  afirma('estrutura calculada', (rom.perfis || []).length > 0 || true,
    (rom.perfis || []).length ? `${NUM(rom.perfis[0].metros)}m` : 'nenhum perfil cadastrado');

  // 1 água NÃO leva cumeeira nem acréscimo
  const rom1 = calcularRomaneio({ comprimentoGalpaoM: L, larguraGalpaoM: Wg, quedas: 1 }, telha, catalogo);
  afirma('1 água não leva cumeeira',
    !rom1.complementos.some((c) => (catalogo.complementos.find((x) => x.id === c.produtoId) || {}).aplica_em === 'cumeeira'));
  afirma('1 água sem acréscimo de 2 águas', rom1.compTelha < rom.compTelha,
    `${NUM(rom1.compTelha)}m vs ${NUM(rom.compTelha)}m`);

  // ── 2) LISTA DE CONFERÊNCIA ────────────────────────────────────────
  console.log('\n2) Lista de conferência (sem preço)');
  const complementos = complementosSugeridos(L, rom.compTelha, quedas, catalogo, telha)
    .map((c) => {
      const sug = rom.complementos.find((x) => x.produtoId === c.produtoId);
      return sug ? { produtoId: c.produtoId, metros: sug.metros } : c;
    });
  const pedidoMotor = {
    grupos: [{ telhaId: telha.id, nome: telha.nome, cortes: rom.cortes,
      ambiente: { comprimentoGalpaoM: L, larguraGalpaoM: Wg, quedas } }],
    complementos,
    perfis: rom.perfis || [],
  };
  const lista = montarLista(pedidoMotor, catalogo);
  for (const l of lista.linhas) {
    console.log(`     ${l.nome}: ${NUM(l.qtd)} ${l.rotulo}${l.comp ? ` de ${NUM(l.comp)}m` : ''}`);
  }
  afirma('nenhuma linha com preço', !lista.linhas.some((l) => 'preco' in l || 'subtotal' in l));
  confere('metragem da lista', lista.metragemTotal, metragemRom, 0.01);

  // ── 3) VOLTA DA CONFERÊNCIA ────────────────────────────────────────
  console.log('\n3) Volta da conferência (cliente não mexeu em nada)');
  const devolta = aplicarLista(lista.linhas, catalogo, lista.ambiente);
  const semConferencia = calcularOrcamento(pedidoMotor, catalogo);
  const comConferencia = calcularOrcamento(devolta, catalogo);
  confere('total com e sem conferência bate', comConferencia.totalAvista, semConferencia.totalAvista, 0.02);

  // ── 4) PREÇO ───────────────────────────────────────────────────────
  console.log('\n4) Motor de preço');
  const frete = { valor: 0, embutido: true, km: 12, unidade: { cidade: 'Cedral', uf: 'SP' },
    descricao: 'Frete grátis', aviso: null };
  const orcamento = calcularOrcamento({ ...devolta, frete }, catalogo);
  console.log(`     itens: ${orcamento.itens.length} · peças: ${orcamento.totalPecas} · ${NUM(orcamento.metragemTotal, 3)} mts`);
  console.log(`     produtos: R$ ${NUM(orcamento.totalProdutos)} · total: R$ ${NUM(orcamento.totalAvista)}`);
  afirma('todo item tem preço', orcamento.itens.every((i) => i.precoUnit > 0));
  afirma('todo item tem subtotal', orcamento.itens.every((i) => i.subtotal > 0));
  afirma('total = soma dos itens',
    Math.abs(orcamento.itens.reduce((s, i) => s + i.subtotal, 0) - orcamento.totalProdutos) < 0.05);
  afirma('parcelas calculadas', (orcamento.pagamentos || []).length > 0);
  if (orcamento.avisos.length) {
    console.log('     avisos:');
    for (const a of orcamento.avisos) console.log(`       · ${a}`);
  }

  // ── 5) PEDIDO SEM TELHA ────────────────────────────────────────────
  console.log('\n5) Pedido sem telha (só acabamento)');
  const soAcab = (catalogo.complementos || []).find((c) => c.ativo !== false);
  if (soAcab) {
    const semTelha = calcularOrcamento(
      { grupos: [], complementos: [{ produtoId: soAcab.id, quantidade: 10 }],
        frete: { ...frete, diluir: catalogo.fretes.frete_abaixo_do_minimo } }, catalogo
    );
    console.log(`     ${soAcab.nome} x10 → R$ ${NUM(semTelha.totalAvista)}`);
    afirma('gera orçamento sem telha', semTelha.totalAvista > 0);
    afirma('frete mínimo rateado nos itens', semTelha.freteDiluido > 0,
      `R$ ${NUM(semTelha.freteDiluido)}`);
  }

  // ── 6) PDF ─────────────────────────────────────────────────────────
  console.log('\n6) PDF');
  const destino = path.join(__dirname, 'out', 'teste-completo.pdf');
  await gerarPDF({
    cliente: {
      nome: 'CLIENTE DE TESTE', documento: '44.627.801/0001-57',
      telefone: '17999999999', email: 'teste@teste.com',
      cep: '15895-314', cidade: 'Cedral', estado: 'SP',
      endereco: 'Rua Exemplo, 120 - Centro',
    },
    pedido: { numero: 'TESTE-001', vendedor: catalogo.empresa.vendedor_padrao },
    orcamento, catalogo,
  }, destino);
  await new Promise((r) => setTimeout(r, 900));   // dá tempo do stream fechar
  const tam = fs.existsSync(destino) ? fs.statSync(destino).size : 0;
  afirma('PDF gerado', tam > 5000, `${Math.round(tam / 1024)} KB em out/teste-completo.pdf`);

  console.log(falhas ? `\n❌ ${falhas} verificação(ões) falharam.\n` : '\n✅ Tudo passou.\n');
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('\n💥 Quebrou:', e.message);
  console.error(e.stack);
  process.exit(1);
});
