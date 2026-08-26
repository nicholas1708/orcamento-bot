/**
 * GERA A PROPOSTA + CONTRATO EM UM ÚNICO PDF.
 *
 *   node contrato-pdf.js
 *   → out/proposta-contrato-4a.pdf
 *
 * Parte 1 — PROPOSTA: o que o sistema resolve, o que faz, quanto custa.
 *                     É o que convence.
 * Parte 2 — CONTRATO: o que se assina quando ele disser sim.
 *
 * Usa o pdfkit que o projeto já tem. Não depende de internet.
 *
 * ⚠️ Regra de conteúdo: a proposta só afirma o que o sistema realmente faz.
 * Nada de "aumente 300% suas vendas" — número inventado destrói a confiança
 * na primeira conferida.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const M = 56;
const LARGURA = 595.28 - M * 2;
const ALTURA = 841.89;
const MARCA = '#01A79D';
const MARCA_D = '#036C62';
const TINTA = '#0E1416';
const SUAVE = '#5B6B6E';

const destino = path.join(__dirname, 'out', 'proposta-contrato-4a.pdf');
fs.mkdirSync(path.dirname(destino), { recursive: true });

const doc = new PDFDocument({ size: 'A4', margins: { top: M, bottom: M + 18, left: M, right: M } });
doc.pipe(fs.createWriteStream(destino));

const hoje = new Date();
const dataBR = (d) => d.toLocaleDateString('pt-BR');
const validade = new Date(hoje.getTime() + 15 * 86400000);

/* ── rodapé ──────────────────────────────────────────────────────── */
let pagina = 0;
let secao = 'Proposta comercial';
const rodape = () => {
  pagina += 1;
  if (pagina === 1) return;                 // capa sem rodapé
  // ⚠️ O rodapé é escrito ABAIXO da margem inferior. Sem zerar a margem,
  // o pdfkit entende que o texto não coube, cria outra página, dispara este
  // mesmo rodapé e entra em recursão até estourar a pilha.
  const margemBaixo = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const y = ALTURA - M + 2;
  doc.save();
  doc.moveTo(M, y - 8).lineTo(M + LARGURA, y - 8).lineWidth(0.5).strokeColor('#DDE3E4').stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(SUAVE)
    .text(secao, M, y, { width: LARGURA, lineBreak: false })
    .text(String(pagina - 1), M, y, { width: LARGURA, align: 'right', lineBreak: false });
  doc.restore();

  doc.page.margins.bottom = margemBaixo;
  doc.y = M;                                // volta o cursor para o topo útil
};
doc.on('pageAdded', rodape);

/* ── blocos ──────────────────────────────────────────────────────── */
const espaco = (altura) => { if (doc.y + altura > ALTURA - M - 24) doc.addPage(); };

const h1 = (t) => {
  espaco(64);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(TINTA)
    .text(t.toUpperCase(), M, doc.y, { width: LARGURA, characterSpacing: 0.3 });
  doc.moveTo(M, doc.y + 5).lineTo(M + 54, doc.y + 5).lineWidth(2.5).strokeColor(MARCA).stroke();
  doc.y += 16;
};

const h2 = (t) => {
  espaco(46);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(MARCA_D).text(t, M, doc.y + 6, { width: LARGURA });
  doc.y += 5;
};

const h3 = (t) => {
  espaco(34);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA).text(t, M, doc.y + 4, { width: LARGURA });
  doc.y += 3;
};

/** Parágrafo com **negrito** inline. */
const p = (t, opts = {}) => {
  const { size = 9.5, cor = TINTA, recuo = 0, gap = 5 } = opts;
  const largura = LARGURA - recuo;
  const partes = String(t).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  doc.fontSize(size).fillColor(cor);
  espaco(doc.heightOfString(String(t).replace(/\*\*/g, ''), { width: largura }) + 8);
  const y0 = doc.y;
  partes.forEach((parte, i) => {
    const negrito = parte.startsWith('**');
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica')
      .text(negrito ? parte.slice(2, -2) : parte,
        i === 0 ? M + recuo : undefined, i === 0 ? y0 : undefined,
        { width: largura, continued: i < partes.length - 1, lineGap: 1.6 });
  });
  doc.y += gap;
};

const li = (t, marcador = '•') => {
  espaco(24);
  const y = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(MARCA).text(marcador, M + 8, y, { lineBreak: false });
  doc.fillColor(TINTA);
  p(t, { recuo: 24, gap: 2 });
};

const nota = (t, cor = '#F2FAF9', barra = MARCA, texto = '#2A4A48') => {
  doc.fontSize(8.8);
  const alt = doc.heightOfString(String(t).replace(/\*\*/g, ''), { width: LARGURA - 30 }) + 18;
  espaco(alt + 10);
  const y = doc.y + 4;
  doc.rect(M, y, LARGURA, alt).fill(cor);
  doc.rect(M, y, 3, alt).fill(barra);
  doc.y = y + 9;
  p(t, { size: 8.8, cor: texto, recuo: 15, gap: 0 });
  doc.y = y + alt + 8;
};

const tabela = (cabecalho, linhas, larguras) => {
  const altPadrao = 20;
  espaco(altPadrao * (linhas.length + 1) + 12);
  let y = doc.y + 4;
  doc.rect(M, y, LARGURA, altPadrao).fill('#F1F4F4');
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SUAVE);
  let x = M;
  cabecalho.forEach((c, i) => {
    doc.text(c, x + 8, y + 6, { width: larguras[i] - 12, lineBreak: false });
    x += larguras[i];
  });
  y += altPadrao;
  doc.font('Helvetica').fontSize(9);
  linhas.forEach((linha) => {
    const alt = Math.max(altPadrao, ...linha.map((c, i) =>
      doc.heightOfString(String(c), { width: larguras[i] - 12 }) + 11));
    doc.rect(M, y, LARGURA, alt).strokeColor('#E2E7E8').lineWidth(0.5).stroke();
    x = M;
    linha.forEach((c, i) => {
      doc.font('Helvetica').fillColor(TINTA).fontSize(9)
        .text(String(c), x + 8, y + 6, { width: larguras[i] - 12 });
      x += larguras[i];
    });
    y += alt;
  });
  doc.y = y + 10;
};

/** Cartões lado a lado com número grande — usados na proposta. */
const numeros = (itens) => {
  espaco(80);
  const larg = (LARGURA - (itens.length - 1) * 10) / itens.length;
  const y = doc.y + 4;
  itens.forEach((it, i) => {
    const x = M + i * (larg + 10);
    doc.rect(x, y, larg, 62).lineWidth(0.8).fillAndStroke('#FFFFFF', '#E2E7E8');
    doc.rect(x, y, larg, 3).fill(MARCA);
    doc.font('Helvetica-Bold').fontSize(21).fillColor(MARCA_D)
      .text(it[0], x + 10, y + 13, { width: larg - 20 });
    doc.font('Helvetica').fontSize(8.2).fillColor(SUAVE)
      .text(it[1], x + 10, y + 38, { width: larg - 20 });
  });
  doc.y = y + 72;
};

const assinatura = (esq, dir) => {
  espaco(80);
  const meia = LARGURA / 2 - 14;
  const y = doc.y + 22;
  doc.moveTo(M, y).lineTo(M + meia, y).lineWidth(0.7).strokeColor('#9AA8AC').stroke();
  doc.moveTo(M + meia + 28, y).lineTo(M + LARGURA, y).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA);
  doc.text(esq[0], M, y + 6, { width: meia });
  doc.text(dir[0], M + meia + 28, y + 6, { width: meia });
  doc.font('Helvetica').fontSize(8.5).fillColor(SUAVE);
  esq.slice(1).forEach((l, i) => doc.text(l, M, y + 19 + i * 11, { width: meia }));
  dir.slice(1).forEach((l, i) => doc.text(l, M + meia + 28, y + 19 + i * 11, { width: meia }));
  doc.y = y + 19 + Math.max(esq.length, dir.length) * 11 + 12;
};

const caixas = (itens) => itens.forEach((t) => {
  espaco(20);
  const y = doc.y + 2;
  doc.rect(M + 6, y, 9, 9).lineWidth(0.8).strokeColor('#9AA8AC').stroke();
  doc.font('Helvetica').fontSize(9.5).fillColor(TINTA).text(t, M + 22, y - 1, { width: LARGURA - 22 });
  doc.y = y + 14;
});

/* ══════════════════════════════════════════════════════════════════
   PARTE 1 — PROPOSTA
   ══════════════════════════════════════════════════════════════════ */
rodape();

/* ── capa ── */
doc.rect(0, 0, 595.28, 250).fill('#0E1416');
doc.rect(M, 62, 54, 3).fill(MARCA);
doc.font('Helvetica').fontSize(10).fillColor(MARCA)
  .text('PROPOSTA COMERCIAL', M, 80, { characterSpacing: 2 });
doc.font('Helvetica-Bold').fontSize(30).fillColor('#FFFFFF')
  .text('Orçamento de telhas', M, 106, { width: LARGURA });
doc.fillColor(MARCA).text('no automático', { width: LARGURA });
doc.font('Helvetica').fontSize(11).fillColor('#C9D4D6')
  .text('O cliente monta sozinho, recebe o PDF na hora,\ne você só entra para fechar.',
    M, 196, { width: LARGURA, lineGap: 2 });

doc.y = 288;
tabela(['', ''], [
  ['Para', '4A Comércio e Representação Materiais de Construção'],
  ['CNPJ', '44.627.801/0001-57'],
  ['De', '[SEU NOME / EMPRESA]'],
  ['Data', dataBR(hoje)],
  ['Validade desta proposta', dataBR(validade)],
], [LARGURA * 0.32, LARGURA * 0.68]);

doc.y += 6;
nota('Este documento tem duas partes. **A proposta** explica o que é o sistema e quanto custa. '
  + '**O contrato**, a partir da página 6, é o instrumento a ser assinado — ele já está pronto, '
  + 'para não haver uma segunda rodada de conversa depois do "sim".');

/* ── o problema ── */
doc.addPage();
h1('O problema de hoje');
p('Cada orçamento de telha passa por uma pessoa. Alguém precisa entender a obra, calcular '
  + 'quantas peças e de que comprimento, lembrar da cumeeira, dos acabamentos de borda, dos '
  + 'parafusos, conferir a faixa de preço e digitar tudo no sistema.');
p('Isso cria três custos que não aparecem em lugar nenhum:');
li('**Tempo do vendedor.** Boa parte do dia vai em orçamento que nunca vira pedido.');
li('**Cliente que espera.** Quem pede orçamento no sábado à noite recebe na segunda — e até lá '
  + 'já pediu em outros dois lugares.');
li('**Erro de conta.** Esquecer o acabamento lateral ou usar a faixa de preço errada custa '
  + 'margem, e só se descobre depois.');
p('E existe um custo maior, silencioso: **o orçamento que não foi pedido** porque a pessoa não '
  + 'quis ligar, não quis falar com vendedor, ou só queria saber o preço antes de decidir.');

h1('A proposta');
p('Um sistema que faz o orçamento inteiro sozinho, com as suas regras, pelo site e pelo '
  + 'WhatsApp, 24 horas por dia — e entrega ao cliente o mesmo PDF que hoje sai do escritório.');
numeros([
  ['2 min', 'do primeiro clique ao PDF pronto'],
  ['24 h', 'inclusive fora do expediente'],
  ['0', 'orçamento perdido por falta de resposta'],
]);
nota('**O que ele NÃO faz:** não negocia, não fecha pedido e não substitui o vendedor. '
  + 'Ele tira do vendedor a parte mecânica — a conta e a digitação — e entrega a ele o cliente '
  + 'já com o orçamento na mão, pronto para a conversa que importa.');

/* ── o que muda ── */
doc.addPage();
h1('O que muda na prática');
tabela(['Hoje', 'Com o sistema'], [
  ['Cliente liga ou manda mensagem e espera retorno',
   'Cliente monta o orçamento na hora, sozinho'],
  ['Vendedor calcula peças, acabamentos e parafusos',
   'O sistema calcula, sempre pela mesma regra'],
  ['Fim de semana e feriado: ninguém responde',
   'Funciona 24 horas, todos os dias'],
  ['Faixa de preço aplicada manualmente',
   'Desconto por volume entra automático'],
  ['Frete estimado por experiência',
   'Calculado pela distância até a unidade mais próxima'],
  ['Orçamento antigo se perde no WhatsApp',
   'Tudo registrado no painel, com cliente e histórico'],
], [LARGURA * 0.48, LARGURA * 0.52]);

h1('Como o cálculo funciona');
p('O cliente escolhe um dos dois caminhos:');
h3('1. "Eu calculo pra você"');
p('Ele informa comprimento, largura e quantas águas. O sistema monta a lista de corte, '
  + 'aplica o acréscimo de material de 2 águas, calcula cumeeira e acabamentos pelo perímetro, '
  + 'a parafusagem por metro quadrado e a estrutura pelo vão máximo.');
h3('2. "Já sei o que quero"');
p('Ele informa direto quantas peças e de que comprimento — respeitando o limite de corte '
  + 'cadastrado para cada telha.');
p('Nos dois casos aparece uma **tela de conferência sem preço**, onde ele ajusta quantidade, '
  + 'tira ou acrescenta item. Só depois vê o valor e baixa o PDF.');
nota('**O cálculo é determinístico.** A inteligência artificial, quando ativa, só conversa e '
  + 'entende o pedido — ela nunca calcula preço nem quantidade. Toda conta sai de regra '
  + 'cadastrada, e toda regra é editável por vocês no painel.');

/* ── controle ── */
doc.addPage();
h1('Você não perde o controle');
p('O autoatendimento tem limites, definidos por vocês:');
tabela(['Situação', 'O que o sistema faz'], [
  ['Obra a mais de 600 km da fábrica',
   'Gera o orçamento, guarda no painel e direciona o cliente ao comercial — sem mostrar valor'],
  ['Pedido acima de 150 m²',
   'Mesma coisa: registra e encaminha, porque volume grande merece negociação'],
  ['Peça acima do comprimento de promoção',
   'Marca o orçamento para revisão da equipe'],
  ['Medida fora do padrão de fábrica',
   'Recusa e explica, em vez de gerar preço errado'],
], [LARGURA * 0.36, LARGURA * 0.64]);
p('Todos esses números ficam no painel e podem ser alterados por vocês a qualquer momento, '
  + 'sem depender de mim.');

h1('O que está incluído');
h3('Módulo A — Sistema de orçamento · R$ 380,00/mês');
[
  'Orçamento pelo site, nos dois caminhos de cálculo;',
  'Orçamento pelo WhatsApp, em número dedicado;',
  'PDF no layout de vocês, com lista de corte, acabamentos, fixação e estrutura;',
  'Pix no orçamento, com QR e copia e cola;',
  'Painel de orçamentos, com situação e histórico de cada um;',
  'Painel de clientes, alimentado automaticamente pelos orçamentos;',
  'Cadastro de produtos, preços por faixa, fotos e dados técnicos;',
  'Importação de tabela de preços por planilha;',
  'Cálculo de frete pela distância entre a obra e as unidades;',
  'Hospedagem, certificado de segurança e monitoramento.',
].forEach(li);

h3('Módulo B — Site institucional · R$ 120,00/mês');
[
  'Site com as páginas acordadas no Anexo I;',
  'Página de vendas ligada ao orçamento;',
  'Hospedagem, certificado de segurança e publicação;',
  'Até 2 alterações de conteúdo por mês.',
].forEach(li);

/* ── investimento ── */
doc.addPage();
h1('Investimento');
tabela(['Item', 'Mensal'], [
  ['Módulo A — Sistema de orçamento', 'R$ 380,00'],
  ['Módulo B — Site institucional', 'R$ 120,00'],
  ['Total', 'R$ 500,00'],
], [LARGURA * 0.7, LARGURA * 0.3]);
p('**Sem taxa de implantação.** O desenvolvimento já está feito e entra diluído na '
  + 'mensalidade — por isso o contrato prevê permanência mínima de 6 meses.');

h2('A conta que interessa');
p('R$ 500 por mês são **R$ 16,60 por dia**. Preencha com os números de vocês:');
tabela(['Pergunta', 'Resposta'], [
  ['Quantos orçamentos vocês fazem por semana?', '[_____]'],
  ['Quanto tempo leva cada um, em média?', '[_____] min'],
  ['Quantas horas por mês isso dá?', '[_____] h'],
  ['Qual a margem média de um pedido fechado?', 'R$ [_____]'],
], [LARGURA * 0.62, LARGURA * 0.38]);
nota('Não vou prometer aumento de vendas — quem vende é vocês, não o software. '
  + 'O que dá para afirmar é objetivo: **o tempo gasto montando orçamento sai da conta**, e '
  + 'quem pede preço fora do horário comercial passa a receber resposta.');

h2('Custos que não são meus');
p('Ficam por conta de vocês, no valor de custo, sem margem minha: servidor, domínio, a linha '
  + 'telefônica do WhatsApp e, se optarem pelo atendimento conversacional, os tokens de '
  + 'inteligência artificial conforme o uso.');

h1('Como começa');
tabela(['Etapa', 'Prazo'], [
  ['Assinatura e cadastro dos produtos e preços', 'Dia 1'],
  ['Publicação do sistema e do site', 'Até 5 dias úteis'],
  ['Conexão do número de WhatsApp dedicado', 'Até 7 dias úteis'],
  ['Treinamento da equipe (remoto, 1 hora)', 'Na mesma semana'],
], [LARGURA * 0.7, LARGURA * 0.3]);

h1('Próximo passo');
p('Se fizer sentido, o contrato já está a seguir. Basta preencher os campos, assinar e '
  + 'devolver uma via — começamos no mesmo dia.');
p('Dúvida em qualquer ponto, me chame antes de assinar. É melhor ajustar agora do que '
  + 'descobrir divergência no terceiro mês.');
doc.y += 8;
p('**[SEU NOME]**   ·   [telefone]   ·   [e-mail]');

/* ══════════════════════════════════════════════════════════════════
   PARTE 2 — CONTRATO
   ══════════════════════════════════════════════════════════════════ */
doc.addPage();
secao = 'Contrato de licença de uso e prestação de serviços';

doc.rect(M, doc.y, LARGURA, 3).fill(MARCA);
doc.y += 18;
doc.font('Helvetica-Bold').fontSize(21).fillColor(TINTA)
  .text('CONTRATO DE LICENÇA DE USO DE SOFTWARE', M, doc.y, { width: LARGURA });
doc.text('E PRESTAÇÃO DE SERVIÇOS', { width: LARGURA });
doc.y += 18;

nota('**Antes de assinar:** este documento foi redigido para este caso específico e não '
  + 'substitui análise jurídica. Recomenda-se revisão por advogado, em especial das cláusulas '
  + '5 (propriedade intelectual), 8 (rescisão) e 9 (responsabilidade). Os campos entre '
  + 'colchetes devem ser preenchidos antes da assinatura.', '#FFF8E6', '#C6952B', '#5C4407');

h1('Partes');
p('**CONTRATADA:** [SEU NOME / RAZÃO SOCIAL], inscrita no CNPJ/CPF sob nº [___], com sede em '
  + '[endereço], doravante denominada CONTRATADA.');
p('**CONTRATANTE:** 4A COMÉRCIO E REPRESENTAÇÃO MATERIAIS DE CONSTRUÇÃO, inscrita no CNPJ sob '
  + 'nº 44.627.801/0001-57, com sede na Rua Carolina Capuano Mantanhim, 329 — Recanto Antônio '
  + 'Silva Filho, Cedral/SP, CEP 15895-314, doravante denominada CONTRATANTE.');

h1('1. Objeto');
p('A CONTRATADA licencia à CONTRATANTE o uso de um sistema de orçamento automático de telhas, '
  + 'de sua propriedade, e presta os serviços de hospedagem, manutenção e suporte descritos '
  + 'neste contrato, nos termos da proposta que integra este instrumento.');

h2('1.1 O que está incluído');
p('Os itens listados na proposta, seções "O que está incluído" — Módulos A e B — e detalhados '
  + 'no Anexo I.');

h2('1.2 O que não está incluído');
p('Fica expresso que não integram este contrato, e serão orçados à parte:');
[
  'criação de páginas, telas, relatórios ou funcionalidades não listadas no Anexo I;',
  'integração com o ERP GestãoClick ou qualquer outro sistema de terceiros;',
  'criação de conteúdo, textos publicitários, fotografia ou design de peças;',
  'gestão de tráfego pago, redes sociais, SEO ou e-mail marketing;',
  'treinamento presencial;',
  'migração de dados de outros sistemas;',
  'emissão de nota fiscal, boleto, cobrança ou integração bancária;',
  'atendimento aos clientes finais da CONTRATANTE.',
].forEach(li);
nota('**Regra prática:** o que estiver no Anexo I é manutenção e está incluído. O que não '
  + 'estiver é escopo novo, com orçamento e prazo próprios, aprovado por escrito antes de começar.');

h1('2. Valor e pagamento');
p('**Valor mensal total: R$ 500,00** (Módulo A R$ 380,00 + Módulo B R$ 120,00).');
[
  'Vencimento todo dia [10] de cada mês, a partir de [___/___/______];',
  'Pagamento por Pix ou transferência para [dados bancários];',
  'Atraso superior a [10] dias corridos: multa de 2% e juros de 1% ao mês;',
  'Atraso superior a [30] dias: a CONTRATADA poderá suspender o acesso ao sistema e ao site, mediante aviso prévio de 5 dias, sem que isso configure rescisão nem afaste os valores devidos.',
].forEach(li);

h2('2.1 Reajuste');
p('O valor será reajustado anualmente pelo IPCA acumulado, ou pelo índice que o substituir, '
  + 'na data de aniversário do contrato.');

h2('2.2 Custos de terceiros');
p('Ficam por conta da CONTRATANTE, mediante repasse sem acréscimo:');
tabela(['Item', 'Estimativa mensal'], [
  ['Servidor / infraestrutura', 'R$ [___]'],
  ['Domínio', 'R$ [___]'],
  ['Linha telefônica dedicada ao WhatsApp', 'R$ [___]'],
  ['Tokens de inteligência artificial', 'variável, conforme uso'],
], [LARGURA * 0.62, LARGURA * 0.38]);

h1('3. Prazo');
p('Vigência de **[12] meses**, contados de [___/___/______], renovando-se automaticamente por '
  + 'iguais períodos, salvo manifestação de qualquer das partes com **[30] dias** de antecedência.');

h1('4. Obrigações');
h2('4.1 Da CONTRATADA');
[
  'Manter o sistema disponível conforme a cláusula 6;',
  'Corrigir defeitos que impeçam o uso normal, sem custo adicional;',
  'Manter cópia de segurança diária dos dados, com retenção de [7] dias;',
  'Guardar sigilo sobre dados comerciais e de clientes da CONTRATANTE;',
  'Avisar com antecedência sobre paradas programadas.',
].forEach(li);
h2('4.2 Da CONTRATANTE');
[
  'Pagar pontualmente;',
  'Manter atualizados, no painel, os preços, produtos e dados técnicos — o sistema apenas aplica o que está cadastrado;',
  'Conferir os orçamentos gerados antes de encaminhá-los a clientes finais;',
  'Fornecer os dados, fotos e textos necessários;',
  'Indicar um responsável único para solicitações;',
  'Manter ativa a linha do WhatsApp e o aparelho conectado.',
].forEach(li);

h1('5. Propriedade intelectual');
p('**5.1** O sistema, seu código-fonte, arquitetura, regras de cálculo e documentação são e '
  + 'permanecem de propriedade exclusiva da CONTRATADA.');
p('**5.2** Este contrato concede à CONTRATANTE licença de uso não exclusiva, intransferível e '
  + 'limitada ao prazo de vigência. Não há cessão, venda ou transferência de código.');
p('**5.3** São e permanecem de propriedade da CONTRATANTE: sua marca, logotipo, textos, '
  + 'fotografias, tabela de preços, cadastro de produtos, cadastro de clientes e o histórico de '
  + 'orçamentos gerados.');
p('**5.4** Encerrado o contrato, a CONTRATADA entregará, em até [10] dias e em formato aberto '
  + '(CSV ou JSON), os dados citados em 5.3. A entrega dos dados não inclui o código-fonte.');
p('**5.5** Havendo interesse futuro na aquisição do código-fonte, o valor será negociado à '
  + 'parte, em instrumento próprio.');

h1('6. Nível de serviço e suporte');
[
  'Disponibilidade: meta de 99% ao mês, excluídas paradas programadas e falhas de terceiros (provedor, WhatsApp, operadora, energia);',
  'Canal de suporte: [WhatsApp/e-mail], em dias úteis, das [9h] às [18h].',
].forEach(li);
tabela(['Situação', 'Início do atendimento'], [
  ['Sistema fora do ar ou orçamento não sendo gerado', 'até 4 horas úteis'],
  ['Erro que atrapalha, mas tem contorno', 'até 1 dia útil'],
  ['Dúvida, ajuste de conteúdo, alteração no site', 'até 3 dias úteis'],
], [LARGURA * 0.62, LARGURA * 0.38]);
p('**6.1** O WhatsApp é acessado por interface não oficial. Bloqueio ou banimento do número '
  + 'pela Meta não é falha do serviço e não gera abatimento, sem prejuízo do dever da '
  + 'CONTRATADA de auxiliar na reativação.');

h1('7. Proteção de dados (LGPD)');
p('**7.1** A CONTRATANTE é controladora dos dados pessoais dos seus clientes; a CONTRATADA '
  + 'atua como operadora, tratando-os apenas para executar este contrato.');
p('**7.2** A CONTRATADA adota medidas técnicas para proteger os dados e comunicará qualquer '
  + 'incidente de segurança em até [48] horas do conhecimento.');
p('**7.3** Encerrado o contrato e entregues os dados na forma da cláusula 5.4, a CONTRATADA os '
  + 'eliminará em até [30] dias, salvo obrigação legal de guarda.');

h1('8. Rescisão');
p('**8.1** Qualquer parte pode rescindir sem justa causa, mediante aviso escrito de **[30] dias**.');
p('**8.2** Rescisão pela CONTRATANTE antes de completados os **[6] primeiros meses** implica '
  + 'multa equivalente a **[3] mensalidades**, pelo investimento de implantação amortizado ao '
  + 'longo do prazo.');
p('**8.3** A rescisão por descumprimento — inclusive falta de pagamento por mais de [30] dias — '
  + 'é imediata, independente de aviso prévio, e não afasta os valores já devidos.');
p('**8.4** Em qualquer hipótese, a CONTRATADA entregará os dados na forma da cláusula 5.4.');

h1('9. Limitação de responsabilidade');
p('**9.1** O sistema é ferramenta de apoio. Os valores e quantidades resultam exclusivamente '
  + 'dos dados cadastrados pela CONTRATANTE, que é responsável por mantê-los corretos e por '
  + 'conferir cada orçamento antes de enviá-lo ao cliente final.');
p('**9.2** A CONTRATADA não responde por prejuízo decorrente de:');
[
  'preço, medida ou dado técnico cadastrado incorretamente;',
  'orçamento enviado ao cliente final sem conferência;',
  'indisponibilidade de serviços de terceiros;',
  'uso do sistema por pessoa não autorizada com credencial da CONTRATANTE.',
].forEach(li);
p('**9.3** A responsabilidade da CONTRATADA, em qualquer hipótese, fica limitada ao valor das '
  + '**[3] últimas mensalidades** pagas.');

h1('10. Disposições gerais');
p('**10.1** Alterações só valem por escrito, assinadas por ambas as partes. Mensagens trocadas '
  + 'por WhatsApp ou e-mail servem para solicitar ajustes dentro do escopo, não para ampliá-lo.');
p('**10.2** A CONTRATADA poderá citar a CONTRATANTE como cliente em seu portfólio, salvo '
  + 'manifestação em contrário.    [   ] autorizo      [   ] não autorizo');
p('**10.3** Nenhuma das partes é responsável por descumprimento decorrente de caso fortuito ou '
  + 'força maior.');
p('**10.4** Fica eleito o foro da comarca de [___] para dirimir controvérsias.');

doc.y += 10;
p('E por estarem justas e contratadas, as partes assinam este instrumento em duas vias de '
  + 'igual teor.');
doc.y += 6;
p('[Cidade], ______ de ____________________ de ________.');
doc.y += 16;
assinatura(
  ['CONTRATADA', '[seu nome]', 'CPF/CNPJ: [___]'],
  ['CONTRATANTE', '4A Comércio e Representação', 'CNPJ: 44.627.801/0001-57']
);
doc.y += 8;
assinatura(['Testemunha 1', 'Nome:', 'CPF:'], ['Testemunha 2', 'Nome:', 'CPF:']);

/* ── anexo ── */
doc.addPage();
secao = 'Anexo I — Escopo entregue';
h1('Anexo I — Escopo entregue');
p('Preencha antes de assinar. É este anexo que decide o que é manutenção e o que é serviço '
  + 'novo — a cláusula 1.2 se apoia nele.');

h2('Sistema de orçamento');
caixas([
  'Orçamento pelo site em [endereço]',
  'Orçamento pelo WhatsApp no número [___]',
  'PDF do orçamento no layout da CONTRATANTE',
  'Pix estático no orçamento',
  'Painel de orçamentos',
  'Painel de clientes',
  'Cadastro de produtos, preços e fotos',
  'Importação de planilha',
  'Página de vendas em [endereço]',
]);

h2('Site institucional — páginas contratadas');
tabela(['#', 'Página'], [
  ['1', '[Home]'], ['2', '[Quem somos]'], ['3', '[Produtos — listagem]'],
  ['4', '[___]'], ['5', '[___]'], ['6', '[___]'],
], [40, LARGURA - 40]);

h2('Regras de cálculo cadastradas na assinatura');
tabela(['Regra', 'Valor'], [
  ['Acréscimo de material para telhado de 2 águas', '30%'],
  ['Raio máximo de entrega automática', '600 km'],
  ['Metragem máxima para autoatendimento', '150 m²'],
  ['Metragem mínima sem frete diluído', '40 m²'],
  ['Tolerância de faixa de preço', '5%'],
  ['Validade do orçamento', '1 dia'],
], [LARGURA * 0.66, LARGURA * 0.34]);
nota('Alterar qualquer uma destas regras é **manutenção** e está incluído. Criar regra nova, '
  + 'que hoje não existe, é **escopo novo**.');

doc.end();
console.log(`\n✅ Proposta + contrato gerados em: ${destino}\n`);
