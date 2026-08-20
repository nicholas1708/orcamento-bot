/**
 * ONDE MORA O CATÁLOGO EM USO.
 *
 * O container é descartável: a cada deploy ele é destruído e recriado a
 * partir da imagem. Se o catálogo ficasse na raiz do projeto, todo produto
 * cadastrado, preço alterado e foto vinculada pelo painel voltaria ao que
 * está no repositório — a empresa perderia o cadastro a cada atualização.
 *
 * Por isso o arquivo EM USO fica em dados/, que é montado como volume:
 *
 *   catalogo.json          → semente, versionada no git
 *   dados/catalogo.json    → o que o sistema lê e o painel grava
 *
 * Na primeira subida a semente é copiada. Depois disso o repositório NUNCA
 * sobrescreve o que está em uso — atualização de código não mexe em dado.
 *
 * Para mudar o lugar (ex: outro ponto de montagem), use DADOS_DIR.
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.DADOS_DIR || path.join(__dirname, 'dados');
const SEMENTE = path.join(__dirname, 'catalogo.json');
const EM_USO = path.join(DIR, 'catalogo.json');
const BACKUP = path.join(DIR, 'catalogo.backup.json');

/**
 * Garante que existe um catálogo em uso e devolve o caminho dele.
 * Só copia a semente quando não há nada — nunca por cima.
 */
function caminhoCatalogo() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (!fs.existsSync(EM_USO)) {
      fs.copyFileSync(SEMENTE, EM_USO);
      console.log(`[catálogo] primeira execução: semente copiada para ${EM_USO}`);
    }
    return EM_USO;
  } catch (e) {
    // Volume somente-leitura ou pasta sem permissão: segue com o do
    // repositório em vez de derrubar o sistema. O painel vai falhar ao
    // gravar, e é melhor falhar ali, com mensagem, do que não subir.
    console.warn(`[catálogo] não consegui usar ${EM_USO} (${e.message}) — lendo do repositório.`);
    return SEMENTE;
  }
}

/** Onde a cópia de segurança é gravada antes de sobrescrever. */
function caminhoBackup() {
  return caminhoCatalogo() === SEMENTE
    ? path.join(__dirname, 'catalogo.backup.json')
    : BACKUP;
}

module.exports = { caminhoCatalogo, caminhoBackup, DIR };
