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
const { preCarregar } = require('./imagens');

const BRL = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM = (v, c = 3) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR');

const M = 40;            // margem
const W = 595.28 - M * 2; // largura útil A4

async function gerarPDF({ cliente, pedido, orcamento, catalogo }, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });

  // baixa (com cache) as fotos dos produtos e a logo antes de montar o documento
  const logoUrl = catalogo.empresa?.logo || null;
  const fotos = await preCarregar([...orcamento.itens.map((i) => i.imagem), logoUrl]);

  // Pix estático — null quando não há chave cadastrada, e o bloco some
  const { pixDoOrcamento } = require('./pix');
  const pix = await pixDoOrcamento(catalogo, {
    numero: pedido.numero, valor: orcamento.totalAvista,
  }).catch((e) => { console.warn('[pdf] Pix não gerado:', e.message); return null; });

  const doc = new PDFDocument({ size: 'A4', margin: M });
  const stream = doc.pipe(fs.createWriteStream(destino));

  const emp = catalogo.empresa;
  const txt = catalogo.textos_pdf || {};

  // ── helpers de layout ─────────────────────────────────────────────
  const LIMITE_Y = 780;                      // rodapé útil da A4
  /** Garante espaço para o próximo bloco; quebra a página se faltar. */
  const espaco = (altura) => {
    if (doc.y + altura > LIMITE_Y) { doc.addPage(); doc.y = M; }
  };
  /** Faixa de título (fundo cinza). Deixa o cursor logo abaixo dela. */
  const faixa = (titulo) => {
    espaco(30);
    const y = doc.y;
    doc.rect(M, y, W, 15).fill('#e8e8e8');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(8)
      .text(titulo, M + 6, y + 4, { width: W - 12, lineBreak: false });
    doc.y = y + 20;
  };
  /** Linha divisória tracejada, com espaçamento previsível. */
  const linhaTracejada = () => {
    const y = doc.y + 2;
    doc.moveTo(M, y).lineTo(M + W, y)
      .lineWidth(0.5).strokeColor('#bbb').dash(2, { space: 2 }).stroke().undash();
    doc.strokeColor('#999');
    doc.y = y + 5;
  };
  /** Parágrafo simples que sempre avança o cursor corretamente. */
  const par = (texto, opts = {}) => {
    const { size = 6.5, font = 'Helvetica', cor = '#000', gap = 0 } = opts;
    if (!texto) return;
    doc.font(font).fontSize(size).fillColor(cor);
    espaco(doc.heightOfString(String(texto), { width: W }) + 4);
    doc.text(String(texto), M, doc.y, { width: W });
    if (gap) doc.y += gap;
  };

  // ── CABEÇALHO ─────────────────────────────────────────────────────
  // A logo é opcional: se o download falhar, o texto ocupa o lugar dela e
  // o cabeçalho não quebra.
  const LOGO_W = 88, LOGO_H = 34;
  let xTexto = M;
  const logo = fotos.get(logoUrl);
  if (logo) {
    try {
      doc.image(logo, M, M - 2, { fit: [LOGO_W, LOGO_H], align: 'left', valign: 'top' });
      xTexto = M + LOGO_W + 12;
    } catch (e) { xTexto = M; }   // imagem corrompida — segue sem ela
  }
  const larguraEsq = W * 0.6 - (xTexto - M);

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
    .text(emp.razao_social, xTexto, M, { width: larguraEsq });
  doc.font('Helvetica').fontSize(7.5).fillColor('#333')
    .text(`CNPJ: ${emp.cnpj}`, { width: larguraEsq })
    .text(emp.endereco, { width: larguraEsq })
    .text(emp.cidade, { width: larguraEsq });

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

  // "frete grátis" aparece uma vez só, na linha de totais — aqui ficam
  // apenas metragem e destino
  linhaTracejada();
  doc.font('Helvetica').fontSize(7.5).fillColor('#000')
    .text(`METRAGEM TOTAL..............: ${NUM(orcamento.metragemTotal)} mts`, M, doc.y, { width: W });
  linhaTracejada();
  doc.text(`Entrega em.........................: ${(cliente.cidade || '').toUpperCase()}`
    + (cliente.estado ? ` - ${cliente.estado.toUpperCase()}` : ''), M, doc.y, { width: W });
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
  // colunas (com IMAGEM, como no orçamento original da 4A)
  const col = {
    item: M + 3, cod: M + 24, nome: M + 60, nomeW: 148,
    img: M + 212, imgW: 58, imgH: 42,
    und: M + 280, qtd: M + 305, qtdW: 38,
    vr: M + 355, vrW: 52, sub: M + 420, subW: 92,
  };
  const cabecalhoTabela = () => {
    const y = doc.y;
    doc.rect(M, y, W, 14).fill('#f5f5f5');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(6.5);
    doc.text('ITEM', col.item, y + 4);
    doc.text('CÓDIGO', col.cod, y + 4);
    doc.text('NOME', col.nome, y + 4);
    doc.text('IMAGEM', col.img, y + 4);
    doc.text('UND.', col.und, y + 4);
    doc.text('QTD.', col.qtd, y + 4, { width: col.qtdW, align: 'right' });
    doc.text('VR. UNIT.', col.vr, y + 4, { width: col.vrW, align: 'right' });
    doc.text('SUBTOTAL', col.sub, y + 4, { width: col.subW, align: 'right' });
    doc.y = y + 15;
  };
  cabecalhoTabela();

  doc.font('Helvetica').fontSize(6.5);
  orcamento.itens.forEach((it, i) => {
    const foto = fotos.get(it.imagem);
    const alturaNome = doc.heightOfString(it.nome, { width: col.nomeW });
    const h = Math.max(alturaNome + 8, foto ? col.imgH + 8 : 20);
    if (doc.y + h > 755) { doc.addPage(); cabecalhoTabela(); doc.font('Helvetica').fontSize(6.5); }

    const y = doc.y;
    doc.rect(M, y, W, h).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.fillColor('#000');
    const yTexto = y + Math.max(4, (h - alturaNome) / 2);
    doc.text(String(i + 1), col.item, yTexto);
    doc.text(String(it.codigo || ''), col.cod, yTexto, { width: 34 });
    doc.text(it.nome, col.nome, yTexto, { width: col.nomeW });

    // foto do produto (silenciosamente omitida se o download tiver falhado)
    if (foto) {
      try {
        doc.image(foto, col.img, y + (h - col.imgH) / 2, {
          fit: [col.imgW, col.imgH], align: 'center', valign: 'center',
        });
      } catch (e) { /* imagem corrompida — segue sem ela */ }
    }

    const yLin = y + h / 2 - 3;
    doc.text(it.unidade, col.und, yLin);
    doc.text(NUM(it.qtd), col.qtd, yLin, { width: col.qtdW, align: 'right' });

    // DE / POR — preço de tabela riscado em cima do preço praticado
    const temDesconto = it.precoBase > it.precoUnit + 0.001;
    if (temDesconto) {
      const de = NUM(it.precoBase);
      doc.fillColor('#888').text(de, col.vr, yLin - 4, { width: col.vrW, align: 'right' });
      const larguraDe = doc.widthOfString(de);
      const xFim = col.vr + col.vrW;
      doc.moveTo(xFim - larguraDe, yLin - 1).lineTo(xFim, yLin - 1)
        .strokeColor('#888').lineWidth(0.5).stroke();
      doc.fillColor('#0a7a3d').font('Helvetica-Bold')
        .text(NUM(it.precoUnit), col.vr, yLin + 4, { width: col.vrW, align: 'right' });
      doc.font('Helvetica').fillColor('#000');
    } else {
      doc.text(NUM(it.precoUnit), col.vr, yLin, { width: col.vrW, align: 'right' });
    }

    doc.font('Helvetica-Bold').text(BRL(it.subtotal), col.sub, yLin, { width: col.subW, align: 'right' });
    doc.font('Helvetica');
    doc.y = y + h;
  });

  // linha de TOTAL da tabela
  const yTot = doc.y;
  doc.rect(M, yTot, W, 16).fill('#f0f0f0');
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
  doc.text('TOTAL', col.item, yTot + 4);
  doc.text(NUM(orcamento.totalPecas), col.qtd, yTot + 4, { width: col.qtdW, align: 'right' });
  doc.text(BRL(orcamento.totalAvista), col.sub, yTot + 4, { width: col.subW, align: 'right' });
  doc.y = yTot + 20;

  // ── TOTAIS: frete é cobrado À PARTE, em linha própria ─────────────
  // O desconto por volume entra como VALOR, não como texto explicativo:
  // o "de/por" já aparece riscado na linha de cada produto.
  if (orcamento.economiaTotal > 0) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#555')
      .text(`SUBTOTAL: ${BRL(orcamento.totalProdutos + orcamento.economiaTotal)}`,
        M, doc.y, { width: W - 4, align: 'right' });
    doc.fillColor('#0a7a3d')
      .text(`DESCONTO: - ${BRL(orcamento.economiaTotal)}`,
        M, doc.y + 1, { width: W - 4, align: 'right' });
  }

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000')
    .text(`PRODUTOS: ${BRL(orcamento.totalProdutos)}`, M, doc.y + 1, { width: W - 4, align: 'right' });

  const fr = orcamento.frete;
  if (fr) {
    const linhaFrete = fr.embutido
      ? 'FRETE: GRÁTIS'
      : !Number.isFinite(fr.valor)
        ? 'FRETE: a confirmar pelo vendedor'
        : fr.valor === 0 ? 'FRETE: GRÁTIS' : `FRETE: ${BRL(fr.valor)}`;
    doc.fontSize(8.5).text(linhaFrete, M, doc.y + 1, { width: W - 4, align: 'right' });
    // só a ORIGEM abaixo da linha — repetir "frete grátis" aqui seria redundante
    if (fr.unidade?.cidade) {
      doc.font('Helvetica').fontSize(6.8).fillColor('#555')
        .text(`sai da unidade de ${fr.unidade.cidade} - ${fr.unidade.uf}` +
          (fr.km ? ` (${fr.km} km)` : ''), M, doc.y, { width: W - 4, align: 'right' });
      doc.font('Helvetica-Bold').fillColor('#000');
    }
  }

  doc.fontSize(10)
    .text(`TOTAL: R$ ${BRL(orcamento.totalAvista)}`, M, doc.y + 3, { width: W - 4, align: 'right' });
  if (fr && !fr.embutido && !Number.isFinite(fr.valor)) {
    doc.font('Helvetica-Oblique').fontSize(6.8).fillColor('#7a5b00')
      .text('Total sem o frete — o vendedor confirma o valor da entrega.', M, doc.y + 1, { width: W - 4, align: 'right' });
    doc.fillColor('#000');
  }
  doc.moveDown(1);

  // ── DADOS DO PAGAMENTO ────────────────────────────────────────────
  espaco(70);
  faixa('DADOS DO PAGAMENTO');
  const cP = { venc: M + 4, val: M + 95, forma: M + 175, obs: M + 300 };
  const yP = doc.y;
  doc.rect(M, yP, W, 16).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#000');
  doc.text('VENCIMENTO', cP.venc, yP + 5, { lineBreak: false });
  doc.text('VALOR', cP.val, yP + 5, { lineBreak: false });
  doc.text('FORMA DE PAGAMENTO', cP.forma, yP + 5, { lineBreak: false });
  doc.text('OBSERVAÇÃO', cP.obs, yP + 5, { lineBreak: false });

  doc.rect(M, yP + 16, W, 18).strokeColor('#ccc').stroke();
  doc.font('Helvetica').fontSize(7);
  doc.text(dataBR(Date.now()), cP.venc, yP + 22, { lineBreak: false });
  doc.text(BRL(orcamento.totalAvista), cP.val, yP + 22, { lineBreak: false });
  doc.text('A Combinar', cP.forma, yP + 22, { lineBreak: false });
  doc.text(
    orcamento.frete && Number.isFinite(orcamento.frete.valor) && orcamento.frete.valor > 0
      ? 'FRETE COBRADO À PARTE — INCLUÍDO NO TOTAL'
      : (txt.pagamento_observacao || ''),
    cP.obs, yP + 22, { width: W - (cP.obs - M) - 6, lineBreak: false }
  );
  doc.y = yP + 34 + 10;

  // ── PIX ───────────────────────────────────────────────────────────
  // Estático: sem banco, sem taxa e sem aviso de pagamento — a baixa é
  // pelo extrato. Some do PDF quando não há chave cadastrada.
  if (pix) {
    espaco(120);
    faixa('PAGUE COM PIX');
    const yPix = doc.y;
    const larguraQr = 96;

    if (pix.png) {
      try { doc.image(pix.png, M, yPix, { fit: [larguraQr, larguraQr] }); }
      catch (e) { /* QR inválido — segue com o copia e cola */ }
    }
    const xTexto = M + (pix.png ? larguraQr + 14 : 0);
    const larguraTexto = W - (xTexto - M);

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000')
      .text(`Valor: R$ ${BRL(orcamento.totalAvista)}`, xTexto, yPix + 2, { width: larguraTexto });
    doc.font('Helvetica').fontSize(7).fillColor('#333')
      .text(`Favorecido: ${pix.nome}${pix.banco ? ' · ' + pix.banco : ''}`, xTexto, doc.y, { width: larguraTexto })
      .text(`Chave: ${pix.chave}`, xTexto, doc.y, { width: larguraTexto });

    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#000')
      .text('COPIA E COLA', xTexto, doc.y + 4, { width: larguraTexto });
    doc.font('Courier').fontSize(5.6).fillColor('#444')
      .text(pix.payload, xTexto, doc.y, { width: larguraTexto });

    doc.font('Helvetica-Oblique').fontSize(6.3).fillColor('#7a5b00')
      .text('Confira sempre o favorecido antes de concluir o pagamento. '
        + 'O pedido só é confirmado após a conferência do comprovante pela equipe.',
        xTexto, doc.y + 3, { width: larguraTexto });

    doc.fillColor('#000');
    doc.y = Math.max(doc.y, yPix + (pix.png ? larguraQr : 0)) + 10;
  }

  // ── TRANSPORTADORA ────────────────────────────────────────────────
  if (txt.transportadora) {
    faixa('TRANSPORTADORA');
    par(txt.transportadora, { size: 7.5, gap: 8 });
  }

  // ── OBSERVAÇÕES ───────────────────────────────────────────────────
  // As unidades saem do cadastro (sem telefone: o contato é do representante,
  // e já aparece no cabeçalho). Cai nos textos fixos se ainda não houver cadastro.
  faixa('OBSERVAÇÕES');
  // O cliente não conhece "Est. 101" — o que identifica a fábrica é a cidade.
  const unidadesTexto = (catalogo.unidades || []).filter((u) => u.ativa).length
    ? catalogo.unidades.filter((u) => u.ativa).map((u) =>
        `UNIDADE - ${String(u.cidade || '').toUpperCase()}/${u.uf} | ${u.endereco || ''} | CEP ${u.cep}`)
    : (txt.unidades || []);
  for (const u of unidadesTexto) par(u, { size: 6.3, cor: '#333' });
  linhaTracejada();
  par('Atenção!', { size: 7, font: 'Helvetica-Bold' });
  for (const a of (txt.atencao || [])) par('• ' + a, { size: 6.3, cor: '#333' });
  doc.y += 6;
  par(txt.dados_bancarios, { size: 6.3, cor: '#333', gap: 10 });

  // ── GARANTIAS ─────────────────────────────────────────────────────
  espaco(90);
  par('GARANTIAS E RESPONSABILIDADES', { size: 7.5, font: 'Helvetica-Bold' });
  doc.y += 2;
  for (const g of (txt.garantias || [])) par(g, { size: 6.3, cor: '#333' });
  if (txt.observacao_final) {
    doc.y += 6;
    par('Observação:', { size: 6.5, font: 'Helvetica-Bold' });
    par(txt.observacao_final, { size: 6.3, cor: '#333' });
  }
  if (orcamento.avisos?.length) {
    doc.y += 6;
    par('Observações do sistema: ' + orcamento.avisos.join(' '), { size: 6.3, font: 'Helvetica-Oblique', cor: '#7a5b00' });
  }

  // ── ASSINATURA ────────────────────────────────────────────────────
  doc.y += 16;
  espaco(60);
  const yA = doc.y;
  doc.rect(M, yA, W, 44).strokeColor('#999').lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor('#000')
    .text('_____________________________________________________', M, yA + 18, { width: W, align: 'center', lineBreak: false })
    .text('Assinatura do cliente', M, yA + 30, { width: W, align: 'center', lineBreak: false });
  doc.y = yA + 52;

  espaco(20);
  doc.font('Helvetica-Oblique').fontSize(6.5).fillColor('#666')
    .text('Orçamento gerado automaticamente — 4A Representação', M, doc.y, { width: W, align: 'right' });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(destino));
    stream.on('error', reject);
  });
}

module.exports = { gerarPDF };
