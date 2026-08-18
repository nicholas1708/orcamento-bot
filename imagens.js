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

/**
 * FOTO PRÓPRIA DA EMPRESA (ex: "/img/cumeeira.jpg").
 * O cadastro aceita tanto URL do CDN quanto arquivo servido pelo próprio
 * sistema. No segundo caso não há nada para baixar: o arquivo já está em
 * disco, é só apontar para ele.
 */
function arquivoDoProjeto(url) {
  if (!String(url).startsWith('/img/')) return undefined;   // não é foto local
  const nome = path.basename(url.split('?')[0]);            // barra a saída da pasta
  const destino = path.join(__dirname, 'img', nome);
  if (!EXT_OK.includes(path.extname(destino).toLowerCase())) return null;
  return fs.existsSync(destino) ? destino : null;
}

/** Baixa (se ainda não houver) e devolve o caminho local, ou null se falhar. */
async function garantirImagem(url) {
  if (!url) return null;
  if (memoria.has(url)) return memoria.get(url);

  const local = arquivoDoProjeto(url);
  if (local !== undefined) {
    if (!local) {
      // NÃO memoriza a ausência: o arquivo pode aparecer a qualquer momento
      // (upload pelo painel, cópia na mão) e o PDF seguinte já tem que achar.
      // Ler o disco é barato; ficar sem a foto até reiniciar não é.
      console.warn(`[imagens] foto local não encontrada: ${url}`);
      return null;
    }
    memoria.set(url, local);
    return local;
  }

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

/**
 * Esquece o que ficou guardado sobre uma URL.
 * Sem isto, uma foto que faltava no momento em que o PDF rodou ficaria
 * marcada como inexistente ate reiniciar o servidor — e o PDF seguiria
 * saindo sem ela mesmo depois do upload pelo painel.
 */
function esquecer(url) {
  if (url) memoria.delete(url);
  else memoria.clear();
}

module.exports = { garantirImagem, preCarregar, esquecer };
