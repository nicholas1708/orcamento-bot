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

/**
 * MIGRAÇÃO ÚNICA: leva o vínculo acabamento↔telha para o catálogo EM USO.
 *
 * O problema que ela resolve: a semente do repositório já traz `compativeis`
 * nas telhas, mas a semente só é copiada na PRIMEIRA execução. Num servidor
 * que já roda há tempo, `dados/catalogo.json` existe e nunca é sobrescrito —
 * então o vínculo novo nunca chegaria, e a telha branca continuaria saindo
 * com cumeeira galvalume.
 *
 * Regras que a tornam segura de rodar em toda subida:
 *   · só mexe em telha que NÃO tem vínculo nenhum — nunca sobrescreve escolha
 *   · só copia id que existe de verdade no catálogo em uso
 *   · telha cadastrada depois (não está na semente) fica de fora, e o painel
 *     avisa que ela está sem acabamento
 *   · grava backup antes e é idempotente: na segunda vez não faz nada
 */
function migrarVinculos() {
  const arq = caminhoCatalogo();
  if (arq === SEMENTE) return { migradas: 0 };      // rodando do repositório

  let vivo, semente;
  try {
    vivo = JSON.parse(fs.readFileSync(arq, 'utf8'));
    semente = JSON.parse(fs.readFileSync(SEMENTE, 'utf8'));
  } catch (e) {
    console.warn(`[vínculos] não consegui ler os catálogos (${e.message}) — nada migrado.`);
    return { migradas: 0 };
  }

  const existentes = (ids, lista) =>
    (ids || []).filter((id) => (lista || []).some((x) => x.id === id));

  const nomes = [];
  for (const t of vivo.telhas || []) {
    if (t.compativeis) continue;                    // já escolhido: não encosta
    const ref = (semente.telhas || []).find((x) => x.id === t.id);
    if (!ref || !ref.compativeis) continue;         // telha só do servidor
    t.compativeis = {
      complementos: existentes(ref.compativeis.complementos, vivo.complementos),
      perfis: existentes(ref.compativeis.perfis, vivo.perfis),
    };
    nomes.push(t.nome || t.id);
  }

  if (!nomes.length) return { migradas: 0 };

  try {
    // backup próprio, para não apagar o backup do último salvamento do painel
    fs.writeFileSync(path.join(DIR, 'catalogo.antes-do-vinculo.json'), fs.readFileSync(arq));
    fs.writeFileSync(arq, JSON.stringify(vivo, null, 2));
    console.log(`[vínculos] acabamentos vinculados em ${nomes.length} telha(s): ${nomes.join(' · ')}`);
  } catch (e) {
    console.warn(`[vínculos] não consegui gravar (${e.message}) — catálogo intacto.`);
    return { migradas: 0 };
  }
  return { migradas: nomes.length, telhas: nomes };
}

module.exports = { caminhoCatalogo, caminhoBackup, migrarVinculos, DIR };
