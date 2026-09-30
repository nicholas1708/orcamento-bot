/**
 * DISTÂNCIA ENTRE CEPs — para escolher a unidade mais próxima da obra.
 *
 * Por que assim: a API de CEP nem sempre devolve coordenadas (testado: o CEP da
 * matriz volta sem lat/lon). Então resolvemos em dois passos:
 *   1) CEP  → cidade/UF   (BrasilAPI, com ViaCEP de reserva)
 *   2) cidade/UF → lat/lon (Nominatim/OpenStreetMap)
 * Tudo com cache em disco — cidade se repete muito, então na prática são
 * pouquíssimas consultas externas.
 *
 * A distância é geodésica (Haversine) multiplicada por um FATOR RODOVIÁRIO,
 * porque estrada não é linha reta. Para km rodado exato, dá para plugar uma
 * API de rotas depois — a interface deste módulo não muda.
 *
 * ⚠️ Se qualquer etapa falhar, devolvemos null. Quem chama trata como
 * "frete a confirmar" — nunca inventamos distância.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CACHE = path.join(__dirname, 'cache-geo.json');
const FATOR_RODOVIARIO = Number(process.env.FATOR_RODOVIARIO || 1.3);
const UA = 'orcamento-bot-4a/1.0 (contato@4arepresentacao.com.br)';

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { cache = {}; }
const gravarCache = () => {
  try { fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2)); } catch { /* ignora */ }
};

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * CEP → { cidade, uf, rua, bairro }. Usa BrasilAPI e cai no ViaCEP se precisar.
 *
 * A distância só precisa de cidade/UF, mas as duas APIs já devolvem rua e
 * bairro de graça — e é isso que deixa o cliente digitar só o número.
 * O `v` marca a versão do registro: cache antigo (só cidade/uf) é refeito.
 */
const CACHE_CEP_V = 2;
async function cidadeDoCep(cep) {
  const c = soDigitos(cep);
  if (c.length !== 8) return null;
  const guardado = cache['cep:' + c];
  if (guardado && guardado.v === CACHE_CEP_V) return guardado;

  const tentativas = [
    async () => {
      const { data } = await axios.get(`https://brasilapi.com.br/api/cep/v2/${c}`, { timeout: 8000 });
      return data?.city
        ? { cidade: data.city, uf: data.state, rua: data.street || null, bairro: data.neighborhood || null }
        : null;
    },
    async () => {
      const { data } = await axios.get(`https://viacep.com.br/ws/${c}/json/`, { timeout: 8000 });
      return data?.localidade
        ? { cidade: data.localidade, uf: data.uf, rua: data.logradouro || null, bairro: data.bairro || null }
        : null;
    },
  ];
  for (const tentar of tentativas) {
    try {
      const r = await tentar();
      if (r) { r.v = CACHE_CEP_V; cache['cep:' + c] = r; gravarCache(); return r; }
    } catch { /* tenta o próximo */ }
  }
  console.warn(`[distancia] CEP não encontrado: ${cep}`);
  return null;
}

/** "Cedral","SP" → { lat, lon }. Nominatim exige User-Agent e 1 req/s. */
async function coordsDaCidade(cidade, uf) {
  if (!cidade) return null;
  const chave = `geo:${String(cidade).toLowerCase()}-${String(uf || '').toLowerCase()}`;
  if (cache[chave]) return cache[chave];
  try {
    await espera(1100); // respeita o limite de uso da API pública
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: `${cidade}, ${uf}, Brasil`, format: 'json', limit: 1 },
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });
    const p = Array.isArray(data) && data[0];
    if (!p) return null;
    const r = { lat: parseFloat(p.lat), lon: parseFloat(p.lon) };
    cache[chave] = r; gravarCache();
    return r;
  } catch (e) {
    console.warn(`[distancia] geocodificação falhou para ${cidade}/${uf}: ${e.message}`);
    return null;
  }
}

/** Distância em linha reta, em km. */
function haversine(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Coordenadas de um local informado por CEP e/ou cidade. */
async function localizar({ cep, cidade, uf, lat, lon }) {
  // já cadastradas (caso das unidades): nada de consulta externa
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, cidade, uf };
  if (cep) {
    const info = await cidadeDoCep(cep);
    if (info) {
      const co = await coordsDaCidade(info.cidade, info.uf);
      if (co) return { ...co, cidade: info.cidade, uf: info.uf };
    }
  }
  if (cidade) {
    const co = await coordsDaCidade(cidade, uf);
    if (co) return { ...co, cidade, uf };
  }
  return null;
}

/** Km aproximados de estrada entre dois locais. null se não der pra saber. */
async function distanciaKm(origem, destino) {
  const a = await localizar(origem);
  const b = await localizar(destino);
  if (!a || !b) return null;
  return Math.round(haversine(a, b) * FATOR_RODOVIARIO);
}

/**
 * DE ONDE O MATERIAL SAI — a unidade ativa mais próxima da obra que atenda o
 * pedido.
 *
 * Duas formas de vincular produto e unidade, nesta ordem:
 *
 *   1. `unidadesPermitidas` — os ids marcados no CADASTRO DA TELHA
 *      ("esta telha sai de Cedral"). É o caminho novo e o que manda.
 *   2. `unidade.produtos` — lista de códigos dentro da unidade. Caminho
 *      antigo, mantido para catálogo que já usava. Lista vazia não filtra
 *      nada — e era por isso que toda telha saía da Kingspan mais próxima.
 *
 * Nenhum dos dois preenchido = qualquer unidade serve, vence a mais perto.
 *
 * @param {string[]|null} unidadesPermitidas  ids vindos do cadastro da telha.
 *   ⚠️ `[]` (vazio) é diferente de `null`: vazio quer dizer que houve marcador
 *   e NENHUMA unidade atende — devolve null em vez de escolher a mais perto.
 *   Já errei isso uma vez: tratar vazio como "sem restrição" faria o pedido
 *   sair da unidade errada em silêncio.
 * @returns {{unidade, km}|null}
 */
async function unidadeMaisProxima(destino, unidades, codigosNecessarios = [], unidadesPermitidas = null) {
  // UMA consulta externa só: a do endereço do cliente.
  // As unidades têm lat/lon no catálogo — se faltar em alguma, ela é ignorada
  // com aviso, em vez de disparar dezenas de chamadas e travar a geração.
  const b = await localizar(destino);
  if (!b) return null;

  // array (mesmo vazio) = houve marcador e ele manda. null = sem marcador.
  const restringe = Array.isArray(unidadesPermitidas);
  if (restringe && !unidadesPermitidas.length) {
    console.warn('[distancia] as telhas deste pedido saem de lugares diferentes — nenhuma unidade atende o pedido inteiro.');
    return null;
  }

  let melhor = null;
  const semCoordenada = [];
  for (const u of unidades) {
    if (u.ativa === false) continue;
    // marcador do produto tem prioridade sobre a lista de códigos da unidade
    if (restringe) {
      if (!unidadesPermitidas.includes(u.id)) continue;
    } else if (Array.isArray(u.produtos) && u.produtos.length && codigosNecessarios.length) {
      const temTudo = codigosNecessarios.every((c) => u.produtos.includes(String(c)));
      if (!temTudo) continue;
    }
    if (!Number.isFinite(u.lat) || !Number.isFinite(u.lon)) { semCoordenada.push(u.nome); continue; }
    const km = Math.round(haversine({ lat: u.lat, lon: u.lon }, b) * FATOR_RODOVIARIO);
    if (!melhor || km < melhor.km) melhor = { unidade: u, km };
  }
  if (semCoordenada.length) {
    console.warn(`[distancia] unidades sem lat/lon no catálogo (ignoradas): ${semCoordenada.join(', ')}`);
  }
  // Marcador apontando para unidade sem coordenada é pior que não ter marcador:
  // o orçamento sai dizendo "não identifiquei a origem" sem explicar por quê.
  if (!melhor && restringe && semCoordenada.length) {
    console.warn(`[distancia] o produto aponta para ${unidadesPermitidas.join(', ')}, `
      + `mas nenhuma dessas tem lat/lon cadastrada.`);
  }
  return melhor;
}

/**
 * COMPLETA AS UNIDADES A PARTIR DO CEP.
 *
 * Cadastrar unidade exigia lat/lon na mão, o que é pedir para dar errado.
 * Agora basta o CEP: o sistema resolve cidade, UF e coordenadas uma vez e
 * guarda no catálogo. Roda na subida, não a cada orçamento.
 *
 * ⚠️ CONFERE A CIDADE. Um CEP digitado errado colocaria a fábrica em outro
 * município e estragaria TODA distância e a regra dos 600 km, em silêncio.
 * Se o que o CEP devolve não bate com a cidade cadastrada, a unidade não é
 * ativada e o problema aparece no diagnóstico.
 *
 * @returns {{mudou:boolean, resolvidas:string[], avisos:string[]}}
 */
async function resolverUnidades(unidades = []) {
  const semAcento = (s) => String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

  let mudou = false;
  const resolvidas = [];
  const avisos = [];

  for (const u of unidades) {
    if (Number.isFinite(u.lat) && Number.isFinite(u.lon)) continue;   // já tem
    if (!soDigitos(u.cep) || soDigitos(u.cep).length !== 8) {
      if (u.ativa !== false) avisos.push(`Unidade ${u.nome || u.id}: sem CEP e sem coordenadas — fica de fora do cálculo.`);
      continue;
    }

    const end = await cidadeDoCep(u.cep);
    if (!end) { avisos.push(`Unidade ${u.nome || u.id}: não consegui resolver o CEP ${u.cep}.`); continue; }

    // o CEP manda, mas discordar da cidade cadastrada é sinal de digitação errada
    if (u.cidade && semAcento(u.cidade) !== semAcento(end.cidade)) {
      u.ativa = false;
      u._pendente = `⚠️ CEP ${u.cep} é de ${end.cidade}/${end.uf}, não de ${u.cidade}. `
        + 'Unidade desativada para não estragar o cálculo de distância. Confira o CEP.';
      mudou = true;
      avisos.push(`Unidade ${u.nome || u.id}: ${u._pendente}`);
      continue;
    }

    const coord = await coordsDaCidade(end.cidade, end.uf);
    if (!coord) { avisos.push(`Unidade ${u.nome || u.id}: não consegui as coordenadas de ${end.cidade}/${end.uf}.`); continue; }

    u.cidade = u.cidade || end.cidade;
    u.uf = u.uf || end.uf;
    if (!u.endereco && end.rua) u.endereco = [end.rua, end.bairro].filter(Boolean).join(' - ');
    u.lat = coord.lat;
    u.lon = coord.lon;
    delete u._pendente;
    if (u.ativa === false) u.ativa = true;    // faltava só o endereço
    mudou = true;
    resolvidas.push(`${u.nome || u.id} → ${end.cidade}/${end.uf}`);
  }

  return { mudou, resolvidas, avisos };
}

/**
 * DE ONDE SAI O PEDIDO — decidido pela TELHA, e só por ela.
 *
 * ⚠️ REGRA DE OPERAÇÃO DA 4A, confirmada pelo cliente:
 * a carga sai inteira do mesmo lugar. Se a telha sai de X, a cumeeira, o
 * frontal, o parafuso e a estrutura saem de X também. NUNCA existe telha de
 * um lugar e acabamento de outro.
 *
 * Por isso o acabamento NÃO tem marcador de origem — seria um campo a mais
 * para preencher, que só criaria a chance de contradizer a telha. Se alguém
 * pensar em adicionar, a resposta é esta nota.
 *
 * @param {object[]} telhas  SÓ as telhas do pedido
 * @returns {string[]|null}  ids das unidades · null = ninguém marcou, qualquer
 *   uma serve · [] = as telhas do pedido apontam para lugares que não se
 *   cruzam, e aí ninguém serve (ver aviso no frete)
 */
function unidadesDoPedido(telhas = []) {
  const listas = telhas
    .map((t) => (Array.isArray(t?.unidades) && t.unidades.length ? t.unidades : null))
    .filter(Boolean);
  if (!listas.length) return null;                       // ninguém marcou nada
  // Interseção. Duas telhas de origens diferentes no mesmo pedido dão lista
  // vazia — é carga dupla, que a operação não faz. Vira aviso, não chute.
  return listas.reduce((a, b) => a.filter((id) => b.includes(id)));
}

module.exports = { cidadeDoCep, coordsDaCidade, distanciaKm, unidadeMaisProxima,
  unidadesDoPedido, resolverUnidades, localizar, FATOR_RODOVIARIO };
