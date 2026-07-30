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
  const problemas = [];
  for (const t of catalogo.telhas || []) {
    if (!(Number(t.largura_util_m) > 0)) problemas.push(`${t.id}: largura_util_m ausente`);
    if (!(Number(t.comprimento_maximo_m) > 0)) problemas.push(`${t.id}: comprimento_maximo_m ausente`);
    if (!(Number(t.vao_maximo_m) > 0)) problemas.push(`${t.id}: vao_maximo_m ausente`);
    if (!(Number(t.preco) > 0)) problemas.push(`${t.id}: preco ausente`);
    if (t.largura_total_m && Number(t.largura_util_m) >= Number(t.largura_total_m)) {
      problemas.push(`${t.id}: largura_util_m >= largura_total_m (útil deve ser menor)`);
    }
  }
  if (problemas.length) {
    console.warn('\n⚠️  CATÁLOGO INCOMPLETO — o cálculo por ambiente pode falhar:\n   - ' +
      problemas.join('\n   - ') + '\n');
  }
  return problemas;
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

module.exports = { getCatalogo };
