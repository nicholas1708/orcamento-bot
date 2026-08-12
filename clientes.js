/**
 * CADASTRO DE CLIENTES — persiste os dados entre orçamentos.
 * Chave: o número de telefone (no WhatsApp ele É a identidade autenticada:
 * a mensagem só pode vir de quem controla aquele número).
 *
 * ⚠️ SEGURANÇA: NÃO exponha consulta por telefone em API pública — qualquer
 * pessoa digitando um número recuperaria nome e endereço de outra. No canal
 * web usamos armazenamento do próprio navegador, nunca busca no servidor.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'clientes');
fs.mkdirSync(DIR, { recursive: true });

const soDigitos = (t) => String(t || '').replace(/\D/g, '');
const arquivo = (tel) => path.join(DIR, soDigitos(tel) + '.json');

/** Dados salvos de um cliente, ou null se for a primeira vez. */
function carregar(telefone) {
  const tel = soDigitos(telefone);
  if (tel.length < 8) return null;
  const f = arquivo(tel);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

/** Grava/atualiza o cadastro após um orçamento concluído. */
function salvar(cliente) {
  const tel = soDigitos(cliente?.telefone);
  if (tel.length < 8 || !cliente.nome) return null;
  const anterior = carregar(tel) || { criadoEm: new Date().toISOString(), orcamentos: 0 };
  const registro = {
    ...anterior,
    telefone: tel,
    nome: cliente.nome || anterior.nome || null,
    cidade: cliente.cidade || anterior.cidade || null,
    estado: cliente.estado || anterior.estado || null,
    endereco: cliente.endereco || anterior.endereco || null,
    cep: cliente.cep || anterior.cep || null,
    documento: cliente.documento || anterior.documento || null,
    email: cliente.email || anterior.email || null,
    orcamentos: (anterior.orcamentos || 0) + 1,
    ultimoOrcamentoEm: new Date().toISOString(),
  };
  fs.writeFileSync(arquivo(tel), JSON.stringify(registro, null, 2));
  return registro;
}

/**
 * Edição manual pelo painel — não incrementa o contador de orçamentos.
 * O telefone é a chave: mudá-lo criaria outro cadastro, então ele é fixo.
 */
function atualizar(telefone, dados) {
  const atual = carregar(telefone);
  if (!atual) return null;
  const campos = ['nome', 'cidade', 'endereco', 'cep', 'documento', 'email', 'observacao'];
  const registro = { ...atual };
  for (const c of campos) {
    if (dados[c] !== undefined) registro[c] = dados[c] === '' ? null : dados[c];
  }
  registro.atualizadoEm = new Date().toISOString();
  fs.writeFileSync(arquivo(atual.telefone), JSON.stringify(registro, null, 2));
  return registro;
}

/**
 * Todos os cadastros, do último atendimento para o mais antigo.
 * ⚠️ Só para a área interna: a lista inteira tem dados pessoais.
 */
function listar() {
  let arquivos = [];
  try { arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of arquivos) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))); } catch { /* ignora corrompido */ }
  }
  return out.sort((a, b) =>
    String(b.ultimoOrcamentoEm || b.criadoEm || '').localeCompare(String(a.ultimoOrcamentoEm || a.criadoEm || '')));
}

/**
 * true quando há dados suficientes para pular as perguntas.
 * CPF/CNPJ e CEP entram na conta: sem eles o orçamento não fecha
 * (documento vai na nota; CEP define a unidade de origem e o raio).
 */
function completo(c) {
  return !!(c && c.nome && c.documento && c.cep && c.cidade && c.endereco);
}

/** O que ainda falta no cadastro — o painel mostra isso na lista. */
function pendencias(c) {
  const f = [];
  if (!c?.nome) f.push('nome');
  if (!c?.cidade) f.push('cidade');
  if (!c?.endereco) f.push('endereço');
  if (!c?.documento) f.push('CPF/CNPJ');
  if (!c?.email) f.push('e-mail');
  return f;
}

module.exports = { carregar, salvar, atualizar, listar, completo, pendencias };
