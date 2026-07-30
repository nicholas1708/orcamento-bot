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
    endereco: cliente.endereco || anterior.endereco || null,
    documento: cliente.documento || anterior.documento || null,
    email: cliente.email || anterior.email || null,
    orcamentos: (anterior.orcamentos || 0) + 1,
    ultimoOrcamentoEm: new Date().toISOString(),
  };
  fs.writeFileSync(arquivo(tel), JSON.stringify(registro, null, 2));
  return registro;
}

/** true quando há dados suficientes para pular as perguntas. */
function completo(c) {
  return !!(c && c.nome && c.cidade && c.endereco);
}

module.exports = { carregar, salvar, completo };
