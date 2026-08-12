/**
 * ADAPTER DE PREÇOS — plugável.
 * Hoje: "local" (catalogo.json). Futuro: "gestaoclick" (API do ERP).
 * O resto do sistema só chama getCatalogo() e não sabe de onde vêm os preços —
 * trocar a fonte é mudar 1 variável no .env, sem tocar em bot/engine/pdf.
 */
const fs = require('fs');
const path = require('path');

async function getCatalogoLocal() {
  const raw = fs.readFileSync(path.join(__dirname, 'catalogo.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * GESTÃOCLICK — baseado na documentação oficial (gestaoclick.docs.apiary.io):
 *   - Auth: headers "access-token" + "secret-access-token" (gerados no ERP em
 *     Configurações > Aplicativos > API).
 *   - GET /api/produtos → paginado (100/página, máx 3 req/s), campos: id, nome,
 *     codigo_interno, grupo_id, valores[] (tipo_id + valor_venda), variações.
 *   - Grupos de produtos (/api/grupos_produtos) ≈ nossas "famílias".
 *   - Fase 2: POST /api/orcamentos (cliente_id, situacao_id, produtos...) com
 *     campo extra "Origem = Automação WhatsApp".
 *
 * Estratégia: o catalogo.json continua sendo a ESTRUTURA (famílias, atributos,
 * compatibilidades, coeficientes — o know-how); o ERP fornece os PREÇOS.
 * Vínculo: item.gc_id = id do produto no GestãoClick.
 * Para ativar: preencher GC_ACCESS_TOKEN/GC_SECRET_TOKEN e PRICING_SOURCE=gestaoclick.
 */
async function getCatalogoGestaoClick() {
  const axios = require('axios');
  const catalogo = await getCatalogoLocal();

  const api = axios.create({
    baseURL: 'https://api.beteltecnologia.com',
    headers: {
      'access-token': process.env.GC_ACCESS_TOKEN,
      'secret-access-token': process.env.GC_SECRET_TOKEN,
    },
    timeout: 15000,
  });

  // Busca TODOS os produtos de uma vez (paginado) — respeita o limite de 3 req/s
  const produtos = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const { data } = await api.get('/api/produtos', { params: { pagina, ativo: 1 } });
    const lote = data?.data || [];
    produtos.push(...lote);
    if (lote.length < 100) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  const porId = new Map(produtos.map((p) => [String(p.id), p]));

  // valor de venda: array "valores" (tipo_id + valor_venda) ou campo direto
  const valorVenda = (p) => {
    if (Array.isArray(p?.valores) && p.valores.length) return parseFloat(p.valores[0].valor_venda);
    return parseFloat(p?.valor_venda);
  };

  // ⚠️ O ERP atualiza SOMENTE O PREÇO. Largura útil, vão máximo, comprimento
  // máximo e demais dados de engenharia continuam vindo do nosso catálogo —
  // no GestãoClick eles não existem como campo (só dentro do nome do produto).
  const todos = [...catalogo.telhas, ...(catalogo.perfis || [])];
  for (const item of todos) {
    const chave = item.gc_id || item.codigo; // vínculo por id ou código do ERP
    if (!chave) continue;                    // sem vínculo → mantém preço local
    const p = porId.get(String(chave)) ||
      produtos.find((x) => String(x.codigo_interno) === String(chave));
    if (!p) continue;
    const preco = valorVenda(p);
    if (Number.isFinite(preco) && preco > 0) item.preco = preco;
  }
  return catalogo;
}

/**
 * VALIDAÇÃO DE INTEGRIDADE TÉCNICA.
 * Dados de engenharia (largura útil, vão máximo, comprimento máximo) NÃO existem
 * de forma estruturada no ERP — lá a largura aparece só dentro do nome do produto
 * ("40/980"), como texto. Portanto eles vivem AQUI e precisam estar completos:
 * sem largura útil não há como calcular quantidade de peças.
 */
function validarCatalogo(catalogo) {
  const problemas = [];   // impedem ou distorcem o orçamento
  const alertas = [];     // funcionam, mas alguém precisa olhar

  const preco = (x) => Number(x.preco) > 0 ||
    (Array.isArray(x.faixas_preco) && x.faixas_preco.some((f) => Number(f.preco) > 0));

  // ── TELHAS ────────────────────────────────────────────────────────
  for (const t of catalogo.telhas || []) {
    const eu = `Telha ${t.nome || t.id}`;
    if (!(Number(t.largura_util_m) > 0)) problemas.push(`${eu}: falta a largura útil — sem ela não dá para calcular quantas peças.`);
    if (!(Number(t.comprimento_maximo_m) > 0)) problemas.push(`${eu}: falta o comprimento máximo de fábrica.`);
    if (!(Number(t.vao_maximo_m) > 0)) problemas.push(`${eu}: falta o vão máximo.`);
    if (!preco(t)) problemas.push(`${eu}: sem preço cadastrado.`);
    if (!t.codigo) alertas.push(`${eu}: sem código — não dá para vincular ao ERP nem às unidades.`);
    if (!t.imagem) alertas.push(`${eu}: sem foto.`);
    if (t.largura_total_m && Number(t.largura_util_m) >= Number(t.largura_total_m)) {
      problemas.push(`${eu}: largura útil maior ou igual à largura total.`);
    }
    if (Array.isArray(t.faixas_preco)) {
      const abertas = t.faixas_preco.filter((f) => f.ate_m2 == null);
      if (t.faixas_preco.length && abertas.length !== 1) {
        problemas.push(`${eu}: as faixas de preço precisam de exatamente uma faixa final (sem limite). Hoje são ${abertas.length}.`);
      }
    }
  }

  // ── COMPLEMENTOS (acabamento e fixação) ───────────────────────────
  for (const c of (catalogo.complementos || []).filter((x) => x.ativo !== false)) {
    const eu = `Complemento ${c.nome || c.id}`;
    if (!preco(c)) problemas.push(`${eu}: sem preço cadastrado.`);
    if (!c.codigo) alertas.push(`${eu}: sem código do ERP.`);
    if (c.venda_por === 'barra' && !(Number(c.comprimento_barra_m) > 0)) {
      problemas.push(`${eu}: vendido por barra mas sem o tamanho da barra.`);
    }
    if (c.tipo === 'acabamento' && !c.aplica_em) {
      problemas.push(`${eu}: não está vinculado a onde se aplica (cumeeira, frontal, lateral ou interno) — não entra no cálculo automático.`);
    }
    if (c.tipo === 'fixacao' && !(Number(c.consumo_por_m2) > 0)) {
      problemas.push(`${eu}: sem consumo por m² — a quantidade não é calculada sozinha.`);
    }
    if (c.aplica_em && c.venda_por !== 'metro' && c.venda_por !== 'barra'
        && !(Number(c.rendimento_m) > 0)) {
      alertas.push(`${eu}: sem rendimento por metro — o sistema assume 1 peça por metro.`);
    }
  }

  // ── PERFIS (estrutura) ────────────────────────────────────────────
  for (const p of (catalogo.perfis || []).filter((x) => x.ativo !== false)) {
    const eu = `Perfil ${p.nome || p.id}`;
    if (!preco(p)) problemas.push(`${eu}: sem preço cadastrado.`);
    if (!p.tipo) problemas.push(`${eu}: sem tipo (terça ou viga) — não entra no cálculo da estrutura.`);
    if (!(Number(p.vao_maximo_m) > 0)) problemas.push(`${eu}: sem vão máximo.`);
    if (p._confirmar) alertas.push(`${eu}: marcado como PROVISÓRIO — confirmar preço e medidas com a fábrica.`);
    if (!p.codigo) alertas.push(`${eu}: sem código do ERP.`);
  }

  // ── UNIDADES (origem do material → distância e frete) ─────────────
  const ativas = (catalogo.unidades || []).filter((u) => u.ativa !== false);
  if (!ativas.length) problemas.push('Nenhuma unidade ativa cadastrada — não dá para medir a distância da obra.');
  for (const u of ativas) {
    if (!(Number.isFinite(u.lat) && Number.isFinite(u.lon))) {
      problemas.push(`Unidade ${u.nome || u.cidade}: sem coordenadas — fica de fora do cálculo de distância.`);
    }
    const codigos = (catalogo.telhas || []).map((t) => t.codigo).filter(Boolean);
    if (Array.isArray(u.produtos) && u.produtos.length) {
      const orfaos = u.produtos.filter((c) => !codigos.includes(String(c)));
      if (orfaos.length) alertas.push(`Unidade ${u.nome || u.cidade}: códigos sem produto correspondente (${orfaos.join(', ')}).`);
    }
  }

  if (problemas.length) {
    console.warn('\n⚠️  CADASTRO INCOMPLETO — pode travar ou distorcer orçamentos:\n   - ' +
      problemas.join('\n   - ') + '\n');
  }
  const r = problemas.slice();
  r.problemas = problemas;
  r.alertas = alertas;
  return r;
}

// Cache simples (5 min) pra não bater na API/disco a cada mensagem
let cache = null, cacheAt = 0;
async function getCatalogo() {
  if (cache && Date.now() - cacheAt < 5 * 60 * 1000) return cache;
  const fonte = process.env.PRICING_SOURCE || 'local';
  cache = fonte === 'gestaoclick' ? await getCatalogoGestaoClick() : await getCatalogoLocal();
  validarCatalogo(cache);
  cacheAt = Date.now();
  return cache;
}

/** Zera o cache — usado após importar planilhas pelo painel. */
function limparCache() { cache = null; cacheAt = 0; }

module.exports = { getCatalogo, limparCache, validarCatalogo };
