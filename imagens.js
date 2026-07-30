/**
 * CACHE DE IMAGENS DOS PRODUTOS.
 * As fotos ficam no CDN da 4A. Para o PDF, elas precisam estar em disco —
 * baixamos uma vez e reaproveitamos. Se o download falhar, o PDF é gerado
 * SEM a imagem (nunca quebra o orçamento por causa de uma foto).
 *
 * pdfkit aceita apenas JPEG e PNG.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'img-cache');
fs.mkdirSync(DIR, { recursive: true });

const EXT_OK = ['.jpg', '.jpeg', '.png'];
const memoria = new Map(); // url → caminho local | null

function caminhoLocal(url) {
  const ext = (path.extname(new URL(url).pathname) || '.jpg').toLowerCase();
  const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
  return path.join(DIR, hash + (EXT_OK.includes(ext) ? ext : '.jpg'));
}

/** Baixa (se ainda não houver) e devolve o caminho local, ou null se falhar. */
async function garantirImagem(url) {
  if (!url) return null;
  if (memoria.has(url)) return memoria.get(url);

  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext && !EXT_OK.includes(ext)) { memoria.set(url, null); return null; }

  const destino = caminhoLocal(url);
  if (fs.existsSync(destino) && fs.statSync(destino).size > 0) {
    memoria.set(url, destino);
    return destino;
  }
  try {
    const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 12000 });
    fs.writeFileSync(destino, Buffer.from(data));
    memoria.set(url, destino);
    return destino;
  } catch (e) {
    console.warn(`[imagens] falha ao baixar ${url}: ${e.message}`);
    memoria.set(url, null);
    return null;
  }
}

/** Pré-carrega várias imagens em paralelo. Retorna Map(url → caminho|null). */
async function preCarregar(urls) {
  const unicas = [...new Set(urls.filter(Boolean))];
  const pares = await Promise.all(unicas.map(async (u) => [u, await garantirImagem(u)]));
  return new Map(pares);
}

module.exports = { garantirImagem, preCarregar };
