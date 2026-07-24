/**
 * Gera o PDF do orçamento com pdfkit. Layout simples: cabeçalho da empresa,
 * dados do cliente, tabela de itens, total, validade e observação legal.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const fmt = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');

function gerarPDF({ cliente, pedido, orcamento, catalogo, empresa }, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const stream = doc.pipe(fs.createWriteStream(destino));

  // Cabeçalho
  doc.fontSize(18).font('Helvetica-Bold').text(empresa.nome, { align: 'left' });
  doc.fontSize(10).font('Helvetica').fillColor('#555')
    .text(`${empresa.cidade}  ·  ${empresa.telefone}`)
    .moveDown(0.3)
    .text(`Orçamento nº ${pedido.numero}  ·  Emitido em ${new Date().toLocaleDateString('pt-BR')}`);
  doc.moveTo(50, doc.y + 8).lineTo(545, doc.y + 8).strokeColor('#999').stroke();
  doc.moveDown(1.2);

  // Cliente
  doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('Cliente');
  doc.fontSize(10).font('Helvetica')
    .text(`${cliente.nome} — ${cliente.cidade}`)
    .text(`WhatsApp: ${cliente.telefone}`);
  doc.moveDown(0.8);

  // Resumo do pedido
  doc.fontSize(11).font('Helvetica-Bold').text('Resumo');
  doc.fontSize(10).font('Helvetica')
    .text(`Área coberta: ${pedido.areaM2} m²  ·  Telha: ${pedido.telhaNome}`)
    .text(`Forro: ${pedido.forroNome}  ·  Estrutura: ${pedido.estruturaNome}`);
  doc.moveDown(0.8);

  // Tabela de itens
  const x = { item: 50, qtd: 300, un: 355, unit: 400, sub: 480 };
  const th = doc.y;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Item', x.item, th).text('Qtd', x.qtd, th).text('Un', x.un, th)
    .text('Unitário', x.unit, th).text('Subtotal', x.sub, th);
  doc.moveTo(50, doc.y + 3).lineTo(545, doc.y + 3).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fontSize(9);
  for (const it of orcamento.itens) {
    const y = doc.y + 6;
    doc.text(it.nome, x.item, y, { width: 240 });
    const yRow = doc.y - 11; // alinha na última linha do nome
    doc.text(String(it.qtd).replace('.', ','), x.qtd, yRow)
      .text(it.unidade, x.un, yRow)
      .text(fmt(it.precoUnit), x.unit, yRow)
      .text(fmt(it.subtotal), x.sub, yRow);
  }
  doc.moveTo(50, doc.y + 6).lineTo(545, doc.y + 6).strokeColor('#999').stroke();
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(13)
    .text(`TOTAL: ${fmt(orcamento.total)}`, 50, doc.y, { align: 'right' });

  // Rodapé
  doc.moveDown(1.2);
  doc.font('Helvetica').fontSize(8.5).fillColor('#555');
  doc.text(`Validade: ${catalogo.validade_orcamento_dias} dias.`, 50);
  doc.text(catalogo.regras.observacao_pdf, { width: 495 });
  if (orcamento.avisos.length) {
    doc.moveDown(0.4).font('Helvetica-Oblique')
      .text('Observações: ' + orcamento.avisos.join(' '), { width: 495 });
  }

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(destino));
    stream.on('error', reject);
  });
}

module.exports = { gerarPDF };
