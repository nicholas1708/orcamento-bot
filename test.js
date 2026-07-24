/**
 * TESTE LOCAL — roda sem WhatsApp e sem GestãoClick.
 * `npm test` → simula um pedido, imprime a lista de materiais e gera um PDF
 * de exemplo em ./out/. Use pra validar coeficientes/preços com a equipe.
 */
require('dotenv').config();
const { getCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { gerarPDF } = require('./pdf');
const path = require('path');

(async () => {
  const catalogo = await getCatalogo();

  // Pedido de exemplo: 100 m², telha sanduíche 40mm, estrutura metálica
  const pedido = {
    telhaId: 'TL-TERMO-40',
    forroId: 'FR-NENHUM',
    estruturaId: 'ES-METALON',
    areaM2: 100,
    cumeeiraM: 10,
    rufoM: 12,
    calhaM: 10,
  };

  const orc = calcularOrcamento(pedido, catalogo);

  console.log('\n=== LISTA DE MATERIAIS (100 m²) ===');
  for (const i of orc.itens) {
    console.log(
      `${i.nome.padEnd(45)} ${String(i.qtd).padStart(8)} ${i.unidade.padEnd(3)}` +
      ` x R$ ${i.precoUnit.toFixed(2).padStart(8)} = R$ ${i.subtotal.toFixed(2).padStart(10)}`
    );
  }
  console.log('-'.repeat(90));
  console.log(`TOTAL: R$ ${orc.total.toFixed(2)}`);
  if (orc.avisos.length) console.log('Avisos:', orc.avisos.join(' | '));

  const t = catalogo.telhas.find(x => x.id === pedido.telhaId);
  const e = catalogo.estruturas.find(x => x.id === pedido.estruturaId);
  const pdfPath = path.join(__dirname, 'out', 'orcamento-exemplo.pdf');
  await gerarPDF({
    cliente: { nome: 'Cliente Teste', cidade: 'Belo Horizonte - MG', telefone: '31999999999' },
    pedido: { ...pedido, numero: 'TESTE-001', telhaNome: t.nome, forroNome: 'Isopor integrado', estruturaNome: e.nome },
    orcamento: orc,
    catalogo,
    empresa: {
      nome: process.env.EMPRESA_NOME || 'Sua Empresa de Telhas LTDA',
      telefone: process.env.EMPRESA_TELEFONE || '(31) 99999-9999',
      cidade: process.env.EMPRESA_CIDADE || 'Belo Horizonte - MG',
    },
  }, pdfPath);
  console.log(`\nPDF de exemplo gerado em: ${pdfPath}\n`);
})();
