/**
 * PIX ESTÁTICO (BR Code) — gerado aqui, sem banco e sem API.
 *
 * O "copia e cola" do Pix é uma string no formato EMV®QRCPS definido pelo
 * Banco Central: campos numerados, cada um com id + tamanho + valor, e um
 * CRC16 no fim. Não precisa de PSP, certificado nem mensalidade.
 *
 * ⚠️ O QUE ELE NÃO FAZ: não avisa quando é pago. Pix estático não tem
 * webhook — a conciliação é no extrato. Para baixa automática seria preciso
 * um PSP (Efí, Asaas, Inter, Mercado Pago) com cobrança dinâmica.
 *
 * Referência dos campos usados:
 *   00 Payload Format Indicator ....... sempre "01"
 *   26 Merchant Account Information ... 00 = "br.gov.bcb.pix", 01 = chave
 *   52 Merchant Category Code ......... "0000" (não especificado)
 *   53 Transaction Currency ........... "986" (BRL)
 *   54 Transaction Amount ............. opcional; sem ele o pagador digita
 *   58 Country Code ................... "BR"
 *   59 Merchant Name .................. até 25 caracteres
 *   60 Merchant City .................. até 15 caracteres
 *   62 Additional Data ................ 05 = txid (usamos o nº do orçamento)
 *   63 CRC16 .......................... sobre tudo, incluindo "6304"
 */

/** Campo EMV: id + tamanho com 2 dígitos + valor. */
const campo = (id, valor) => {
  const v = String(valor);
  return id + String(v.length).padStart(2, '0') + v;
};

/**
 * Só ASCII maiúsculo e sem acento: leitores de banco engasgam com o resto.
 * "REPRESENTAÇÃO" vira "REPRESENTACAO".
 */
function limpar(texto, limite) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limite);
}

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF) — exigido pela spec. */
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * A chave pode vir formatada (CNPJ com pontos, telefone com parênteses).
 * CPF/CNPJ e telefone viajam só com dígitos; e-mail e aleatória, como estão.
 */
function normalizarChave(chave) {
  const bruta = String(chave || '').trim();
  if (!bruta) return '';
  if (bruta.includes('@')) return bruta.toLowerCase();          // e-mail
  const digitos = bruta.replace(/\D/g, '');
  if (digitos.length === 11 || digitos.length === 14) return digitos;   // CPF/CNPJ
  if (/^\+?\d{12,13}$/.test(bruta.replace(/\D/g, ''))) return '+' + digitos; // telefone
  return bruta;                                                  // chave aleatória
}

/**
 * Monta o "copia e cola".
 * @param {object} p
 *   chave   — chave Pix do recebedor (CNPJ, telefone, e-mail ou aleatória)
 *   nome    — nome do recebedor como consta na conta (máx. 25)
 *   cidade  — cidade do recebedor (máx. 15)
 *   valor   — opcional; omitido, o pagador digita o valor
 *   txid    — identificador (usamos o número do orçamento), máx. 25
 * @returns {string} payload pronto para colar no app do banco
 */
function montarBrCode({ chave, nome, cidade, valor, txid }) {
  const k = normalizarChave(chave);
  if (!k) throw new Error('Chave Pix não informada.');

  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', k);
  const idTx = limpar(txid || '***', 25).replace(/[^A-Z0-9]/g, '') || '***';

  let payload =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (Number(valor) > 0 ? campo('54', Number(valor).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', limpar(nome, 25) || 'RECEBEDOR') +
    campo('60', limpar(cidade, 15) || 'BRASIL') +
    campo('62', campo('05', idTx));

  payload += '6304';
  return payload + crc16(payload);
}

/**
 * PNG do QR, para o PDF e para a tela. Devolve null se a lib não estiver
 * instalada — o "copia e cola" continua valendo, e o orçamento não quebra
 * por causa de uma dependência.
 */
async function gerarQrPng(payload, tamanho = 220) {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toBuffer(payload, {
      type: 'png', width: tamanho, margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch (e) {
    console.warn('[pix] QR não gerado (rode `npm install qrcode`):', e.message);
    return null;
  }
}

/**
 * Tudo que o orçamento precisa para mostrar o Pix.
 * Sem chave cadastrada em empresa.pix, devolve null e ninguém percebe.
 */
async function pixDoOrcamento(catalogo, { numero, valor }) {
  const pix = catalogo?.empresa?.pix;
  if (!pix?.chave) return null;

  const payload = montarBrCode({
    chave: pix.chave,
    nome: pix.nome || catalogo.empresa.razao_social,
    cidade: pix.cidade || 'CEDRAL',
    valor,
    txid: numero,
  });
  return {
    payload,
    png: await gerarQrPng(payload),
    chave: pix.chave,
    nome: pix.nome || catalogo.empresa.razao_social,
    banco: pix.banco || null,
  };
}

module.exports = { montarBrCode, gerarQrPng, pixDoOrcamento, crc16, normalizarChave };
