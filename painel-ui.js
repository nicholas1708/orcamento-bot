/* ═══════════════════════════════════════════════════════════════════
   PAINEL 4A — peças compartilhadas pelas três páginas.
   Menu, atalhos de DOM, formatação e a gaveta de detalhe.
   Sem framework e sem build: é só incluir o arquivo.
   ═══════════════════════════════════════════════════════════════════ */
const LOGO = 'https://d4polyhz8pjtz.cloudfront.net/5223/logo-3768-20221005184441-06-15-2023-15-51-14-000000.png';

const PAGINAS = [
  { id: 'orcamentos', href: '/painel',           ic: '📄', nome: 'Orçamentos' },
  { id: 'clientes',   href: '/painel/clientes',  ic: '👤', nome: 'Clientes' },
  { id: 'produtos',   href: '/painel/produtos',  ic: '🧱', nome: 'Produtos' },
];

/* ── atalhos ──────────────────────────────────────────────────────── */
const g = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRL = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM = (v, d = 2) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const nada = '<span style="color:#B9C4C6">—</span>';

const data = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};
const dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const telFmt = (t) => {
  const d = String(t || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || '—';
};
const zapLink = (t) => {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return 'https://wa.me/' + (d.startsWith('55') ? d : '55' + d);
};
/** Vírgula ou ponto, tanto faz — o usuário digita como quiser. */
const dec = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/* ── rede ─────────────────────────────────────────────────────────── */
async function pegar(url) {
  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || 'Falha ao carregar.');
  return d;
}
async function enviar(url, corpo, metodo = 'POST') {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || 'Não consegui salvar.');
  return d;
}

/* ── mensagens ────────────────────────────────────────────────────── */
function aviso(idOuEl, tipo, texto) {
  const el = typeof idOuEl === 'string' ? g(idOuEl) : idOuEl;
  if (!el) return;
  if (!texto) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.className = 'msg ' + tipo;
  el.innerHTML = texto;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── estrutura da página ──────────────────────────────────────────── */
/**
 * Desenha menu + cabeçalho e devolve o elemento onde a página escreve.
 * @param {string} atual  id da página (ver PAGINAS)
 * @param {string} titulo
 * @param {string} sub
 * @param {string} acoes  HTML dos botões do canto direito
 */
function montarShell(atual, titulo, sub, acoes = '') {
  // Escreve num container próprio: mexer no body inteiro apagaria as tags
  // <script> desta própria página.
  let app = g('app');
  if (!app) {
    app = document.createElement('div');
    app.id = 'app';
    document.body.insertBefore(app, document.body.firstChild);
  }
  app.innerHTML = `
    <div class="shell">
      <nav class="nav">
        <div class="marca"><img src="${LOGO}" alt="4A">
          <span>Painel<i>4A Telhas</i></span></div>
        <menu>
          <div class="sec">Operação</div>
          ${PAGINAS.map((p) => `<a class="item ${p.id === atual ? 'on' : ''}" href="${p.href}">
            <span class="ic">${p.ic}</span>${p.nome}
            <span class="tag" id="cnt-${p.id}" hidden></span></a>`).join('')}
          <div class="sec">Ferramentas</div>
          <a class="item" href="/painel/dados"><span class="ic">📥</span>Importar planilha</a>
          <a class="item" href="/orcamento" target="_blank"><span class="ic">↗</span>Abrir orçamento</a>
        </menu>
        <div class="pe">4A Comércio e Representação<br>de Materiais de Construção</div>
      </nav>
      <div class="main">
        <div class="topo">
          <div><h1>${titulo}</h1><div class="sub">${sub}</div></div>
          <span class="sp"></span>${acoes}
        </div>
        <div class="corpo" id="corpo"></div>
      </div>
    </div>
    <div class="gaveta" id="gaveta" onclick="if(event.target===this)fecharGaveta()">
      <div><header><div id="gv-tit"></div>
        <button class="x" onclick="fecharGaveta()">✕</button></header>
        <div class="conteudo" id="gv-corpo"></div></div>
    </div>`;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharGaveta(); });
  return g('corpo');
}

/** Marca no menu quantos registros cada área tem. */
function contador(id, n) {
  const el = g('cnt-' + id);
  if (!el) return;
  el.hidden = !n;
  el.textContent = n;
}

/* ── gaveta de detalhe ────────────────────────────────────────────── */
function abrirGaveta(titulo, html) {
  g('gv-tit').innerHTML = titulo;
  g('gv-corpo').innerHTML = html;
  g('gaveta').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function fecharGaveta() {
  g('gaveta').classList.remove('on');
  document.body.style.overflow = '';
}

/* ── campo de foto ────────────────────────────────────────────────
   Enviar o arquivo direto, arrastar para a área, ou colar um link.

   O arquivo é reduzido e convertido para JPEG AQUI no navegador, antes
   de subir. Isso resolve três coisas de uma vez: chega leve no servidor,
   sai sempre num formato que o PDF aceita (pdfkit só lê JPEG e PNG), e
   uma foto de celular de 8 MB não trava o envio.                       */
const FOTO_LADO_MAX = 1400;
const FOTO_QUALIDADE = 0.82;

/**
 * @param {string} id     id do input que guarda o endereço da foto
 * @param {string} valor  endereço atual (ou vazio)
 * @param {string} ajuda  texto pequeno embaixo do campo
 */
function campoFoto(id, valor, ajuda) {
  setTimeout(() => pintarFoto(id), 0);   // roda depois que este HTML entra na tela
  return `
    <div class="campo foto">
      <label>Foto do produto</label>
      <div class="foto-drop" id="${id}-drop" onclick="g('${id}-arq').click()"
        ondragover="event.preventDefault();this.classList.add('over')"
        ondragleave="this.classList.remove('over')"
        ondrop="soltarFoto(event,'${id}')">
        <span class="previa" id="${id}-previa"></span>
        <span class="dizeres" id="${id}-dizeres"></span>
      </div>
      <input type="file" id="${id}-arq" accept="image/*" hidden
        onchange="escolherFoto(this,'${id}')">
      <div class="foto-acoes">
        <button type="button" class="btn g sm" onclick="g('${id}-arq').click()">Enviar arquivo</button>
        <button type="button" class="btn r sm" onclick="tirarFoto('${id}')">Remover</button>
      </div>
      <label style="margin-top:8px">ou cole um link</label>
      <input id="${id}" value="${esc(valor || '')}" placeholder="https://..."
        oninput="pintarFoto('${id}')">
      ${ajuda ? `<small>${ajuda}</small>` : ''}
    </div>`;
}

/** Redesenha prévia e legenda a partir do valor atual do campo. */
function pintarFoto(id, recado) {
  const campo = g(id), previa = g(id + '-previa'), diz = g(id + '-dizeres');
  if (!campo || !previa || !diz) return;
  const url = campo.value.trim();

  // o ▤ fica atrás; a foto entra por cima e se remove se não carregar
  previa.innerHTML = '<span class="vazia">▤</span>' +
    (url ? `<img src="${esc(url)}" alt="" onerror="this.remove()">` : '');

  diz.className = 'dizeres' + (recado && recado.erro ? ' erro' : '');
  if (recado) {
    diz.innerHTML = `<b>${esc(recado.titulo)}</b><small>${esc(recado.detalhe || '')}</small>`;
  } else if (url) {
    diz.innerHTML = `<b>Trocar imagem</b><small>${esc(url.replace(/^.*\//, ''))}</small>`;
  } else {
    diz.innerHTML = '<b>Escolher imagem</b><small>arraste o arquivo aqui ou clique</small>';
  }
}

function escolherFoto(input, id) {
  const arq = input.files && input.files[0];
  input.value = '';                      // permite reenviar o mesmo arquivo
  if (arq) mandarFoto(arq, id);
}
function soltarFoto(ev, id) {
  ev.preventDefault();
  g(id + '-drop').classList.remove('over');
  const arq = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (arq) mandarFoto(arq, id);
}
function tirarFoto(id) { g(id).value = ''; pintarFoto(id); }

async function mandarFoto(arq, id) {
  if (!/^image\//.test(arq.type || '')) {
    return pintarFoto(id, { erro: true, titulo: 'Isso não é uma imagem', detalhe: arq.name });
  }
  pintarFoto(id, { titulo: 'Enviando…', detalhe: arq.name });
  try {
    const dados = await reduzirImagem(arq);
    const r = await enviar('/api/painel/imagem', { nome: arq.name, dados });
    g(id).value = r.url;
    pintarFoto(id);
  } catch (e) {
    pintarFoto(id, { erro: true, titulo: 'Não consegui enviar', detalhe: e.message });
  }
}

/** Reduz para no máximo FOTO_LADO_MAX e devolve um data URL JPEG. */
async function reduzirImagem(arq) {
  let bmp;
  try { bmp = await createImageBitmap(arq); }
  catch { throw new Error('Não consegui abrir essa imagem. Salve como JPG ou PNG e tente de novo.'); }

  const escala = Math.min(1, FOTO_LADO_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * escala));
  const h = Math.max(1, Math.round(bmp.height * escala));

  const tela = document.createElement('canvas');
  tela.width = w; tela.height = h;
  const ctx = tela.getContext('2d');
  ctx.fillStyle = '#fff';        // PNG transparente virando JPEG: fundo branco, não preto
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return tela.toDataURL('image/jpeg', FOTO_QUALIDADE);
}

/** Lista de rótulo + valor, usada nas fichas de detalhe. */
const ficha = (pares) => `<dl class="ficha">${pares
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
