/**
 * REDE DE VENDEDORES.
 *
 * Cada vendedor vende só as telhas que estão no cadastro dele, tem um link
 * próprio de venda e enxerga no painel apenas os orçamentos que saíram por
 * esse link. O admin vê tudo e é o único que cadastra produto.
 *
 * ⚠️ O motor NÃO muda. O vendedor é um FILTRO de catálogo e de visão do
 * painel, nunca um parâmetro de cálculo. Dois vendedores diferentes pedindo
 * a mesma telha, na mesma metragem, recebem exatamente o mesmo preço.
 *
 * Arquivo em dados/vendedores.json (volume) — não some no deploy.
 *
 * SEM ARQUIVO CADASTRADO o sistema continua como sempre foi: o PAINEL_SENHA
 * abre o painel como admin e o orçamento sai sem vendedor. Ninguém precisa
 * cadastrar nada para o que já existe continuar funcionando.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIR } = require('./catalogo-arquivo');

const ARQUIVO = path.join(DIR, 'vendedores.json');

/* ═══════════════ SENHA ═══════════════
 * scrypt com sal por usuário. Guardar senha em texto num arquivo que também
 * carrega telefone e endereço de cliente seria pedir problema.
 */
function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  return `scrypt$${sal}$${dk}`;
}

function conferirSenha(senha, hash) {
  const p = String(hash || '').split('$');
  if (p.length !== 3 || p[0] !== 'scrypt') return false;
  const dk = crypto.scryptSync(String(senha), p[1], 64);
  const esperado = Buffer.from(p[2], 'hex');
  // comparação de tempo constante: comparar com === vaza o tamanho do acerto
  return dk.length === esperado.length && crypto.timingSafeEqual(dk, esperado);
}

/* ═══════════════ ARQUIVO ═══════════════ */

function ler() {
  try {
    if (!fs.existsSync(ARQUIVO)) return [];
    const j = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return Array.isArray(j.vendedores) ? j.vendedores : [];
  } catch (e) {
    console.warn(`[vendedores] não consegui ler ${ARQUIVO}: ${e.message}`);
    return [];
  }
}

function gravar(lista) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = ARQUIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ vendedores: lista }, null, 2), 'utf8');
  fs.renameSync(tmp, ARQUIVO);          // troca atômica: nunca deixa arquivo pela metade
}

/* ═══════════════ CONSULTA ═══════════════ */

/** Sem senhaHash — é isto que pode ir para a tela. */
function publico(v) {
  if (!v) return null;
  const { senhaHash, ...resto } = v;
  return resto;
}

function listar() {
  return ler().map(publico);
}

function buscarPorId(id) {
  return ler().find((v) => v.id === id) || null;
}

/** Pelo slug do link de venda (/orcamento?v=slug). Só vendedor ativo. */
function buscarPorSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return null;
  return ler().find((v) => v.slug === s && v.ativo !== false) || null;
}

function buscarPorUsuario(usuario) {
  const u = String(usuario || '').trim().toLowerCase();
  if (!u) return null;
  return ler().find((v) => String(v.usuario).toLowerCase() === u) || null;
}

/* ═══════════════ LOGIN ═══════════════ */

/**
 * Confere usuário e senha.
 *
 * O admin do PAINEL_SENHA continua valendo, sempre. É a saída de emergência:
 * se o arquivo de vendedores se perder ou alguém errar o próprio cadastro,
 * ainda dá para entrar e arrumar.
 *
 * @returns {{id,nome,papel,slug,telhas}|null}
 */
function autenticar(usuario, senha) {
  const senhaAdmin = process.env.PAINEL_SENHA || '';
  const u = String(usuario || '').trim().toLowerCase();

  if (senhaAdmin && (u === 'admin' || u === '') && String(senha) === senhaAdmin) {
    return { id: 'admin', nome: 'Administrador', papel: 'admin', slug: null, telhas: null };
  }

  const v = buscarPorUsuario(u);
  if (!v || v.ativo === false) return null;
  if (!conferirSenha(senha, v.senhaHash)) return null;

  return {
    id: v.id,
    nome: v.nome,
    papel: v.papel === 'admin' ? 'admin' : 'vendedor',
    slug: v.slug,
    telhas: Array.isArray(v.telhas) ? v.telhas : null,
  };
}

/* ═══════════════ CADASTRO ═══════════════ */

// Marcas de acento que o NFD deixa soltas. Montado com new RegExp para o
// arquivo não depender de caractere invisível no código-fonte.
const ACENTO = new RegExp('[\\u0300-\\u036f]', 'g');

const slugificar = (s) => String(s || '')
  .normalize('NFD').replace(ACENTO, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 40);

/**
 * Cria ou atualiza. Senha em branco na edição = mantém a que já existe.
 * @throws {Error} com mensagem pronta para a tela
 */
function salvar(dados) {
  const lista = ler();
  const nome = String(dados.nome || '').trim();
  const usuario = String(dados.usuario || '').trim().toLowerCase();

  if (!nome) throw new Error('Informe o nome do vendedor.');
  if (!/^[a-z0-9._-]{3,}$/.test(usuario)) {
    throw new Error('Usuário: mínimo 3 caracteres, só letras, números, ponto, hífen ou sublinhado.');
  }
  if (usuario === 'admin') throw new Error('O usuário "admin" é reservado.');

  const id = dados.id || crypto.randomUUID();
  const i = lista.findIndex((v) => v.id === id);
  const atual = i >= 0 ? lista[i] : null;

  const repetido = lista.find((v) => v.id !== id && String(v.usuario).toLowerCase() === usuario);
  if (repetido) throw new Error(`O usuário "${usuario}" já está em uso por ${repetido.nome}.`);

  if (!atual && !dados.senha) throw new Error('Defina uma senha para o novo vendedor.');
  if (dados.senha && String(dados.senha).length < 6) {
    throw new Error('A senha precisa de pelo menos 6 caracteres.');
  }

  // o link não muda quando o nome muda: link impresso ou já enviado continua valendo
  let slug = atual ? atual.slug : slugificar(dados.slug || nome);
  if (!slug) slug = 'v-' + id.slice(0, 6);
  while (lista.some((v) => v.id !== id && v.slug === slug)) slug += '-2';

  const registro = {
    id,
    nome,
    usuario,
    senhaHash: dados.senha ? gerarHash(dados.senha) : atual.senhaHash,
    papel: dados.papel === 'admin' ? 'admin' : 'vendedor',
    slug,
    telefone: String(dados.telefone || '').trim() || null,
    unidade: dados.unidade || null,
    // null = vende TODAS as telhas ativas. Lista vazia = não vende nenhuma.
    telhas: Array.isArray(dados.telhas) ? dados.telhas : null,
    ativo: dados.ativo !== false,
    criadoEm: atual ? atual.criadoEm : new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };

  if (i >= 0) lista[i] = registro; else lista.push(registro);
  gravar(lista);
  return publico(registro);
}

/** Desativa em vez de apagar: orçamento antigo tem que continuar com dono. */
function desativar(id) {
  const lista = ler();
  const v = lista.find((x) => x.id === id);
  if (!v) throw new Error('Vendedor não encontrado.');
  v.ativo = false;
  v.atualizadoEm = new Date().toISOString();
  gravar(lista);
  return publico(v);
}

/* ═══════════════ O QUE ELE PODE VENDER ═══════════════ */

/**
 * Telhas que este vendedor pode oferecer.
 *
 * Sem vendedor (link público) ou sem lista cadastrada → todas as ativas.
 * É o que mantém o site de hoje funcionando igual enquanto a rede não existe.
 *
 * @param {object|null} vendedor  registro ou sessão (precisa só de .telhas)
 */
function telhasDoVendedor(catalogo, vendedor) {
  const ativas = (catalogo.telhas || []).filter((t) => t.ativo !== false);
  const permitidas = vendedor && vendedor.telhas;
  if (!Array.isArray(permitidas)) return ativas;
  return ativas.filter((t) => permitidas.indexOf(t.id) >= 0);
}

/** Confere no servidor, não na tela: a tela pode ser burlada. */
function podeVender(catalogo, vendedor, telhaId) {
  return telhasDoVendedor(catalogo, vendedor).some((t) => t.id === telhaId);
}

module.exports = {
  listar, buscarPorId, buscarPorSlug, buscarPorUsuario,
  autenticar, salvar, desativar,
  telhasDoVendedor, podeVender,
  gerarHash, conferirSenha, slugificar,
  ARQUIVO,
};
