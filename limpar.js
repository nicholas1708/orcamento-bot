/**
 * ZERAR O HISTÓRICO — tira os orçamentos de teste antes de entrar em produção.
 *
 * Usado em dois lugares, com o MESMO código: o botão "Limpar testes" do painel
 * e a linha de comando. Lógica de apagar duplicada em dois lugares é pedido de
 * desastre.
 *
 *   node limpar.js                         mostra o que sairia, sem tocar em nada
 *   node limpar.js --confirmar             zera os orçamentos e os PDFs
 *   node limpar.js --confirmar --clientes  zera também o cadastro de clientes
 *   node limpar.js --confirmar --tudo      + conversas do WhatsApp em andamento
 *
 * ⚠️ NÃO APAGA DE VERDADE: move para lixeira/<data-hora>/. Se zerar o que não
 * devia, é só arrastar de volta. Quando tiver certeza, apague a pasta lixeira/
 * na mão — isso é decisão sua, não do script.
 *
 * NUNCA mexe no catálogo (produtos, preços, fotos) nem nos vendedores.
 */
const fs = require('fs');
const path = require('path');

const raiz = __dirname;

/**
 * O que pode ser zerado. `sempre: true` entra em qualquer limpeza — orçamento
 * sem o PDF dele (e vice-versa) deixaria link quebrado no painel.
 */
const ALVOS = [
  { id: 'orcamentos', pasta: 'orcamentos', rotulo: 'Orçamentos do painel', ext: '.json', sempre: true },
  { id: 'pdfs', pasta: 'out', rotulo: 'PDFs gerados', ext: '.pdf', sempre: true },
  { id: 'clientes', pasta: 'clientes', rotulo: 'Cadastro de clientes', ext: '.json', sempre: false },
  { id: 'conversas', pasta: 'sessions', rotulo: 'Conversas do WhatsApp em andamento', ext: '.json', sempre: false },
];

const listar = (pasta, ext) => {
  const dir = path.join(raiz, pasta);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(ext));
};

const bytes = (pasta, arquivos) => arquivos.reduce((s, f) => {
  try { return s + fs.statSync(path.join(raiz, pasta, f)).size; } catch { return s; }
}, 0);

/** Quanto existe hoje em cada pasta. Só lê, não mexe em nada. */
function inventario() {
  return ALVOS.map((a) => {
    const arquivos = listar(a.pasta, a.ext);
    return { id: a.id, rotulo: a.rotulo, sempre: a.sempre,
      quantidade: arquivos.length, bytes: bytes(a.pasta, arquivos) };
  });
}

/**
 * Move para a lixeira o que foi pedido.
 * @param {object} opcoes  { clientes?: boolean, conversas?: boolean }
 * @returns {{movidos, erros, pasta, porAlvo}}
 */
function limpar(opcoes = {}) {
  const escolhidos = ALVOS.filter((a) => a.sempre || opcoes[a.id] === true);

  const carimbo = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', 'h');
  const lixeira = path.join(raiz, 'lixeira', carimbo);

  let movidos = 0;
  const erros = [];
  const porAlvo = {};

  for (const a of escolhidos) {
    const arquivos = listar(a.pasta, a.ext);
    if (!arquivos.length) { porAlvo[a.id] = 0; continue; }

    const destino = path.join(lixeira, a.pasta);
    fs.mkdirSync(destino, { recursive: true });

    let n = 0;
    for (const f of arquivos) {
      const de = path.join(raiz, a.pasta, f);
      const para = path.join(destino, f);
      try {
        fs.renameSync(de, para);
        n++;
      } catch {
        // pastas em volumes diferentes não aceitam rename: copia e apaga
        try {
          fs.copyFileSync(de, para);
          fs.unlinkSync(de);
          n++;
        } catch (e2) {
          erros.push(`${a.pasta}/${f}: ${e2.message}`);
        }
      }
    }
    porAlvo[a.id] = n;
    movidos += n;
  }

  return { movidos, erros, pasta: `lixeira/${carimbo}`, porAlvo };
}

module.exports = { inventario, limpar, ALVOS };

/* ── linha de comando ─────────────────────────────────────────────── */
if (require.main === module) {
  const args = process.argv.slice(2);
  const tem = (f) => args.includes(f);
  const tudo = tem('--tudo');
  const opcoes = { clientes: tudo || tem('--clientes'), conversas: tudo };

  const mb = (b) => (b / 1024 / 1024).toFixed(1).replace('.', ',');
  console.log('\n═══ ZERAR HISTÓRICO ═══\n');

  let total = 0;
  for (const i of inventario()) {
    const vai = i.sempre || opcoes[i.id];
    if (vai) total += i.quantidade;
    const obs = vai ? '' : (i.id === 'clientes' ? '   (use --clientes)' : '   (use --tudo)');
    console.log(`  ${vai ? '→' : ' '} ${i.rotulo.padEnd(38)} ${String(i.quantidade).padStart(5)} arquivo(s)`
      + ` · ${mb(i.bytes).padStart(6)} MB${obs}`);
  }
  console.log('\n  Não sai daqui: catálogo, produtos, fotos, vendedores.\n');

  if (!total) { console.log('Nada para zerar.\n'); process.exit(0); }

  if (!tem('--confirmar')) {
    console.log(`${total} arquivo(s) seriam movidos para a lixeira. Nada foi alterado.`);
    console.log('Para valer:\n\n  node limpar.js --confirmar\n');
    process.exit(0);
  }

  const r = limpar(opcoes);
  console.log(`✅ ${r.movidos} arquivo(s) movidos para ${r.pasta}/\n`);
  for (const e of r.erros) console.warn(`  ! ${e}`);
  console.log('O painel já abre zerado. Quando conferir, apague a pasta lixeira/ na mão.\n');
}
