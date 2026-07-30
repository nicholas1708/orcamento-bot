/**
 * PDF do orçamento — replica o layout do GestãoClick usado pela 4A
 * (referência: orçamento real nº 11247).
 * Estrutura: cabeçalho da empresa → formas de pagamento → metragem/frete →
 * dados do cliente → tabela de produtos → totais → pagamento → transportadora →
 * observações → garantias → assinatura.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const BRL = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM = (v, c = 3) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR');

const M = 40;            // margem
const W = 595.28 - M * 2; // largura útil A4

function gerarPDF({ cliente, pedido, orcamento, catalogo }, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const stream = doc.pipe(fs.createWriteStream(destino));

  const emp = catalogo.empresa;
  const txt = catalogo.textos_pdf || {};

  // ── helpers de layout ─────────────────────────────────────────────
  const faixa = (titulo) => {
    if (doc.y > 720) doc.addPage();
    doc.rect(M, doc.y, W, 16).fill('#e8e8e8');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(8.5)
      .text(titulo, M + 6, doc.y - 12.5);
    doc.moveDown(0.6);
  };
  const linhaTracejada = () => {
    doc.fillColor('#666').font('Helvetica').fontSize(6)
      .text('-'.repeat(160), M, doc.y, { width: W });
  };

  // ── CABEÇALHO ─────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
    .text(emp.razao_social, M, M, { width: W * 0.6 });
  doc.font('Helvetica').fontSize(7.5).fillColor('#333')
    .text(`CNPJ: ${emp.cnpj}`, { width: W * 0.6 })
    .text(emp.endereco, { width: W * 0.6 })
    .text(emp.cidade, { width: W * 0.6 });

  const yTopo = M;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000')
    .text(emp.telefones, M + W * 0.6, yTopo, { width: W * 0.4, align: 'right' })
    .text(emp.email, { width: W * 0.4, align: 'right' })
    .text(emp.site, { width: W * 0.4, align: 'right' })
    .font('Helvetica').text(`Vendedor: ${pedido.vendedor || emp.vendedor_padrao}`, { width: W * 0.4, align: 'right' })
    .text(`Aos cuidados de: ${cliente.nome}`, { width: W * 0.4, align: 'right' })
    .text(cliente.telefone || '', { width: W * 0.4, align: 'right' });

  doc.y = Math.max(doc.y, yTopo + 62);
  doc.moveDown(0.5);

  // ── TÍTULO ────────────────────────────────────────────────────────
  const yT = doc.y;
  doc.rect(M, yT, W, 18).fill('#f0f0f0');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(11)
    .text(`ORÇAMENTO Nº ${pedido.numero}`, M, yT + 4, { width: W, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(9)
    .text(dataBR(Date.now()), M, yT + 5, { width: W - 8, align: 'right' });
  doc.y = yT + 24;

  // ── FORMAS DE PAGAMENTO ───────────────────────────────────────────
  doc.font('Helvetica').fontSize(7.5).fillColor('#000');
  doc.text(`Formas Pagamentos: À Vista R$ ${BRL(orcamento.totalAvista)} ${catalogo.pagamento?.condicoes_avista || ''}`, M, doc.y, { width: W });
  for (const p of orcamento.pagamentos) {
    doc.text(`${p.descricao} R$ ${BRL(p.total)} = ${p.parcelas} x R$ ${BRL(p.valorParcela)}`, { width: W });
  }

  linhaTracejada();
  doc.font('Helvetica').fontSize(7.5).fillColor('#000')
    .text(`METRAGEM TOTAL..............: ${NUM(orcamento.metragemTotal)} mts`, M, doc.y, { width: W });
  linhaTracejada();
  doc.text(txt.frete || 'FRETE', M, doc.y, { width: W });
  linhaTracejada();
  doc.text(`Entrega em.........................: ${(cliente.cidade || '').toUpperCase()}`, M, doc.y, { width: W });
  doc.moveDown(0.4);

  // validade / previsão
  const yV = doc.y;
  doc.rect(M, yV, W / 2, 16).fill('#f0f0f0');
  doc.rect(M + W / 2, yV, W / 2, 16).fill('#f0f0f0');
  const prev = new Date(Date.now() + (catalogo.prazo_entrega_dias || 9) * 86400000);
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(8)
    .text(`VALIDADE DA PROPOSTA: ${catalogo.validade_orcamento_dias} DIA`, M + 6, yV + 4)
    .text(`PREVISÃO DE ENTREGA: ${dataBR(prev)}`, M + W / 2 + 6, yV + 4);
  doc.y = yV + 22;

  // ── DADOS DO CLIENTE ──────────────────────────────────────────────
  faixa('DADOS DO CLIENTE');
  const yC = doc.y;
  const cel = (label, valor, col, linha) => {
    const x = M + col * (W / 2);
    const y = yC + linha * 15;
    doc.rect(x, y, W / 2, 15).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000').text(label, x + 4, y + 4, { width: 55 });
    doc.font('Helvetica').fontSize(7.5).text(String(valor || ''), x + 62, y + 4, { width: W / 2 - 68 });
  };
  cel('Cliente:', cliente.nome, 0, 0);      cel('CNPJ/CPF:', cliente.documento, 1, 0);
  cel('Endereço:', cliente.endereco, 0, 1); cel('CEP:', cliente.cep, 1, 1);
  cel('Cidade:', cliente.cidade, 0, 2);     cel('Estado:', cliente.estado, 1, 2);
  cel('Telefone:', cliente.telefone, 0, 3); cel('E-mail:', cliente.email, 1, 3);
  doc.y = yC + 4 * 15 + 8;

  // ── PRODUTOS ──────────────────────────────────────────────────────
  faixa('PRODUTOS');
  const col = { item: M + 4, cod: M + 34, nome: M + 76, und: M + 330, qtd: M + 375, vr: M + 425, sub: M + 480 };
  const cabecalhoTabela = () => {
    const y = doc.y;
    doc.rect(M, y, W, 14).fill('#f5f5f5');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(7);
    doc.text('ITEM', col.item, y + 4);
    doc.text('CÓDIGO', col.cod, y + 4);
    doc.text('NOME', col.nome, y + 4);
    doc.text('UND.', col.und, y + 4);
    doc.text('QTD.', col.qtd, y + 4, { width: 40, align: 'right' });
    doc.text('VR. UNIT.', col.vr, y + 4, { width: 48, align: 'right' });
    doc.text('SUBTOTAL', col.sub, y + 4, { width: 71, align: 'right' });
    doc.y = y + 16;
  };
  cabecalhoTabela();

  doc.font('Helvetica').fontSize(7);
  orcamento.itens.forEach((it, i) => {
    const alturaNome = doc.heightOfString(it.nome, { width: 245 });
    const h = Math.max(alturaNome + 8, 22);
    if (doc.y + h > 760) { doc.addPage(); cabecalhoTabela(); doc.font('Helvetica').fontSize(7); }

    const y = doc.y;
    doc.rect(M, y, W, h).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.fillColor('#000');
    doc.text(String(i + 1), col.item, y + 4);
    doc.text(String(it.codigo || ''), col.cod, y + 4, { width: 38 });
    doc.text(it.nome, col.nome, y + 4, { width: 245 });
    doc.text(it.unidade, col.und, y + 4);
    doc.text(NUM(it.qtd), col.qtd, y + 4, { width: 40, align: 'right' });
    doc.text(NUM(it.precoUnit), col.vr, y + 4, { width: 48, align: 'right' });
    doc.text(BRL(it.subtotal), col.sub, y + 4, { width: 71, align: 'right' });
    doc.y = y + h;
  });

  // linha de TOTAL da tabela
  const yTot = doc.y;
  doc.rect(M, yTot, W, 16).fill('#f0f0f0');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
  doc.text('TOTAL', col.item, yTot + 4);
  doc.text(NUM(orcamento.totalPecas), col.qtd, yTot + 4, { width: 40, align: 'right' });
  doc.text(BRL(orcamento.totalAvista), col.sub, yTot + 4, { width: 71, align: 'right' });
  doc.y = yTot + 20;

  doc.font('Helvetica-Bold').fontSize(8.5)
    .text(`PRODUTOS: ${BRL(orcamento.totalAvista)}`, M, doc.y, { width: W - 4, align: 'right' })
    .fontSize(10)
    .text(`TOTAL: R$ ${BRL(orcamento.totalAvista)}`, M, doc.y + 2, { width: W - 4, align: 'right' });
  doc.moveDown(1);

  // ── DADOS DO PAGAMENTO ────────────────────────────────────────────
  faixa('DADOS DO PAGAMENTO');
  const yP = doc.y;
  doc.rect(M, yP, W, 15).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#000');
  doc.text('VENCIMENTO', M + 4, yP + 4);
  doc.text('VALOR', M + 90, yP + 4);
  doc.text('FORMA DE PAGAMENTO', M + 160, yP + 4);
  doc.text('OBSERVAÇÃO', M + 290, yP + 4);
  doc.rect(M, yP + 15, W, 15).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fontSize(7);
  doc.text(dataBR(Date.now()), M + 4, yP + 19);
  doc.text(BRL(orcamento.totalAvista), M + 90, yP + 19);
  doc.text('A Combinar', M + 160, yP + 19);
  doc.text(txt.pagamento_observacao || '', M + 290, yP + 19, { width: W - 294 });
  doc.y = yP + 36;

  // ── TRANSPORTADORA ────────────────────────────────────────────────
  if (txt.transportadora) {
    faixa('TRANSPORTADORA');
    doc.font('Helvetica').fontSize(7.5).fillColor('#000').text(txt.transportadora, M, doc.y, { width: W });
    doc.moveDown(0.5);
  }

  // ── OBSERVAÇÕES ───────────────────────────────────────────────────
  faixa('OBSERVAÇÕES');
  doc.font('Helvetica').fontSize(6.5).fillColor('#000');
  for (const u of (txt.unidades || [])) doc.text(u, M, doc.y, { width: W });
  linhaTracejada();
  doc.font('Helvetica-Bold').fontSize(7).text('Atenção!', M, doc.y);
  doc.font('Helvetica').fontSize(6.5);
  for (const a of (txt.atencao || [])) doc.text('• ' + a, M, doc.y, { width: W });
  doc.moveDown(0.4);
  if (txt.dados_bancarios) doc.text(txt.dados_bancarios, M, doc.y, { width: W });
  doc.moveDown(0.5);

  if (doc.y > 640) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(7.5).text('GARANTIAS E RESPONSABILIDADES', M, doc.y);
  doc.font('Helvetica').fontSize(6.5);
  for (const g of (txt.garantias || [])) doc.text(g, M, doc.y, { width: W });
  doc.moveDown(0.4);
  if (txt.observacao_final) {
    doc.font('Helvetica-Bold').fontSize(6.5).text('Observação:', M, doc.y);
    doc.font('Helvetica').text(txt.observacao_final, M, doc.y, { width: W });
  }
  if (orcamento.avisos?.length) {
    doc.moveDown(0.4).font('Helvetica-Oblique').fontSize(6.5)
      .text('Observações do sistema: ' + orcamento.avisos.join(' '), M, doc.y, { width: W });
  }

  // ── ASSINATURA ────────────────────────────────────────────────────
  doc.moveDown(1.5);
  if (doc.y > 740) doc.addPage();
  const yA = doc.y;
  doc.rect(M, yA, W, 42).strokeColor('#999').lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor('#000')
    .text('________________________________________________________', M, yA + 16, { width: W, align: 'center' })
    .text('Assinatura do cliente', M, yA + 28, { width: W, align: 'center' });

  doc.moveDown(1.5);
  doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#666')
    .text('Orçamento gerado automaticamente — 4A Representação', M, doc.y, { width: W, align: 'right' });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(destino));
    stream.on('error', reject);
  });
}

module.exports = { gerarPDF };
