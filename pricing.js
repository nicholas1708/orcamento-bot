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
 * FUTURO — GestãoClick. Quando a API for contratada:
 * 1. Gere Access Token + Secret Token no ERP (Configurações > Aplicativos > API).
 * 2. Preencha GC_ACCESS_TOKEN e GC_SECRET_TOKEN no .env.
 * 3. Preencha o gc_id de cada item do catalogo.json com o ID do produto no ERP.
 * 4. Implemente o fetch abaixo (endpoint de produtos da doc oficial) e
 *    troque PRICING_SOURCE=gestaoclick.
 * Estratégia: mantém o catalogo.json como ESTRUTURA (coeficientes/regras) e
 * só atualiza os PREÇOS a partir do ERP — coeficiente é know-how, preço é dado.
 */
async function getCatalogoGestaoClick() {
  const axios = require('axios');
  const catalogo = await getCatalogoLocal();

  const api = axios.create({
    baseURL: 'https://api.beteltecnologia.com', // confirmar na doc dentro do ERP
    headers: {
      'access-token': process.env.GC_ACCESS_TOKEN,
      'secret-access-token': process.env.GC_SECRET_TOKEN,
    },
    timeout: 15000,
  });

  const atualizarPreco = async (item) => {
    if (!item.gc_id) return; // sem vínculo com o ERP → mantém preço local
    const { data } = await api.get(`/produtos/${item.gc_id}`);
    const preco = parseFloat(data?.data?.valor_venda);
    if (Number.isFinite(preco) && preco > 0) {
      if ('preco' in item) item.preco = preco;
      if ('preco_por_m2' in item) item.preco_por_m2 = preco;
    }
  };

  const todos = [
    ...catalogo.telhas, ...catalogo.forros, ...catalogo.estruturas,
    ...Object.values(catalogo.acessorios),
  ];
  await Promise.all(todos.map(atualizarPreco));
  return catalogo;
}

// Cache simples (5 min) pra não bater na API/disco a cada mensagem
let cache = null, cacheAt = 0;
async function getCatalogo() {
  if (cache && Date.now() - cacheAt < 5 * 60 * 1000) return cache;
  const fonte = process.env.PRICING_SOURCE || 'local';
  cache = fonte === 'gestaoclick' ? await getCatalogoGestaoClick() : await getCatalogoLocal();
  cacheAt = Date.now();
  return cache;
}

module.exports = { getCatalogo };
