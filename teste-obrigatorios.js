/**
 * CAMPOS OBRIGATÓRIOS — a tela e o servidor têm que concordar.
 *
 * Divergência aqui é dos defeitos mais chatos de achar: o cliente preenche a
 * ficha inteira, clica em gerar e leva um erro seco que a tela nunca avisou.
 * Ou pior, o inverso — a tela deixa passar e o dado ruim entra no orçamento.
 *
 *   node teste-obrigatorios.js
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
function afirma(nome, ok, detalhe) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  if (!ok) falhas++;
}

const tela = fs.readFileSync(path.join(__dirname, 'orcamento.html'), 'utf8');
const servidor = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

/* ── 1) todo campo obrigatório está marcado na tela ─────────────────── */
console.log('\n1) O asterisco está lá (é o único aviso ANTES do erro)');
const MARCADOS = ['Nome do cliente', 'Seu nome', 'CPF ou CNPJ', 'WhatsApp',
  'CEP da obra', 'Rua', 'Número', 'Bairro', 'Cidade', 'Estado'];
for (const rotulo of MARCADOS) {
  // <label>Rótulo <i>*</i></label>  — aceita quebra de linha no meio
  const re = new RegExp(rotulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*<i>\\*</i>');
  afirma(`"${rotulo}" marcado`, re.test(tela));
}
afirma('e-mail marcado como OPCIONAL', /E-mail\s*<i class="opc">\(opcional\)<\/i>/.test(tela));
afirma('complemento marcado como OPCIONAL', /Complemento\s*<i class="opc">/.test(tela));
afirma('tem legenda explicando o asterisco', /campos obrigat[óo]rios/i.test(tela));

/* ── 2) cada campo tem onde mostrar o erro ──────────────────────────── */
console.log('\n2) Cada campo tem caixa de erro própria');
const IDS = ['dn', 'dd', 'dt', 'dm', 'dp', 'dr', 'dnum', 'db', 'dc', 'du'];
for (const id of IDS) {
  afirma(`#${id} tem #e-${id}`, tela.includes(`id="e-${id}"`));
}
afirma('valida ao sair do campo (blur)', (tela.match(/onblur="conferirCampo\(/g) || []).length >= 9);
afirma('erro some quando começa a corrigir', (tela.match(/oninput="limparErro\(/g) || []).length >= 8);
afirma('aponta TODOS os erros de uma vez, não um por vez',
  /for\(const r of REGRAS\)\{[\s\S]{0,200}pintarErro\(r\.id,msg\)/.test(tela));
afirma('contador do que falta antes de clicar', tela.includes('function contarFaltando'));

/* ── 3) ⚠️ a tela e o servidor exigem a MESMA coisa ─────────────────── */
console.log('\n3) A tela e o servidor concordam');
const naTela = (campo) => new RegExp(`campo:'${campo}',[\\s\\S]{0,80}obrig:true`).test(tela);
const noServidor = {
  nome:      /txt\(cliente\?\.nome\)\.length < 2/,
  documento: /!documentoValido\(cliente\?\.documento\)/,
  telefone:  /num\(cliente\?\.telefone\)\.length < 10/,
  cep:       /num\(cliente\?\.cep\)\.length !== 8/,
  rua:       /txt\(cliente\?\.rua\)\.length < 3/,
  numero:    /!txt\(cliente\?\.numero\)/,
  bairro:    /txt\(cliente\?\.bairro\)\.length < 2/,
  cidade:    /txt\(cliente\?\.cidade\)\.length < 2/,
  estado:    /\[A-Za-z\]\{2\}\$\/\.test\(txt\(cliente\?\.estado\)\)/,
};
for (const [campo, re] of Object.entries(noServidor)) {
  const t = naTela(campo), s = re.test(servidor);
  afirma(`${campo}: tela ${t ? 'exige' : 'NÃO exige'} · servidor ${s ? 'exige' : 'NÃO exige'}`, t && s);
}
afirma('e-mail é opcional nos DOIS lados',
  /campo:'email',[\s\S]{0,80}obrig:false/.test(tela)
  && /txt\(cliente\?\.email\) &&/.test(servidor));

/* ── 4) o estado não pode voltar a ser esquecido ────────────────────── */
console.log('\n4) ⚠️ Estado (UF) — entra no cálculo de frete');
afirma('servidor exige UF', /Informe o estado com 2 letras/.test(servidor));
afirma('a razão está escrita junto da regra',
  /UF entra no frete[\s\S]{0,200}600 km/.test(servidor),
  'sem a nota, alguém "simplifica" e volta o defeito');

/* ── 5) CPF/CNPJ conferido de verdade ───────────────────────────────── */
console.log('\n5) Documento com dígito verificador');
const { validarCatalogo } = require('./pricing');   // só para garantir que carrega
afirma('server.js recusa documento repetido', /\^\(\\d\)\\1\{10\}\$/.test(servidor),
  '111.111.111-11 tem 11 dígitos e é inválido');

console.log(falhas ? `\n${falhas} falha(s)\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
