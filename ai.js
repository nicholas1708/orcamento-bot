/**
 * CAMADA DE IA (OpenAI) — OPCIONAL e com papel restrito de propósito:
 * só INTERPRETA texto livre do cliente → opção do menu ou número.
 * NUNCA calcula, NUNCA inventa preço, NUNCA escreve o orçamento.
 * Se a IA falhar/estiver desligada, o bot volta ao comportamento de menu puro.
 *
 * Config no .env / stack:
 *   OPENAI_API_KEY=sk-...
 *   OPENAI_MODEL=gpt-4o-mini   (barato e suficiente pra classificação)
 */
const axios = require('axios');

const ativa = () => !!process.env.OPENAI_API_KEY;

async function chamar(systemPrompt, userText) {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 30,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(userText).slice(0, 500) },
      ],
    },
    {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeout: 10000,
    }
  );
  return JSON.parse(data.choices[0].message.content);
}

/**
 * Mapeia texto livre para UMA das opções numeradas. Retorna 1..N ou null.
 * Ex: "quero a de 40mm" + ["Termo 30mm","Termo 40mm","Galvanizada"] → 2
 */
async function escolherOpcao(texto, opcoes, contexto) {
  if (!ativa()) return null;
  try {
    const lista = opcoes.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const sys =
      `Você classifica a mensagem de um cliente de loja de telhas para UMA opção do menu sobre "${contexto}".\n` +
      `Opções:\n${lista}\n` +
      `Responda APENAS JSON: {"opcao": N} onde N é o número da opção, ` +
      `ou {"opcao": null} se a mensagem for ambígua ou não corresponder a nenhuma. ` +
      `NÃO chute: na dúvida, use null.`;
    const r = await chamar(sys, texto);
    const n = parseInt(r.opcao, 10);
    return n >= 1 && n <= opcoes.length ? n : null;
  } catch (e) {
    console.error('[AI] escolherOpcao falhou:', e.message);
    return null; // IA fora do ar → cai no fluxo de menu normal
  }
}

/**
 * Extrai UM número do texto livre. Retorna número ou null.
 * Ex: "são uns cem metros quadrados" → 100 · "10x10" → 100 · "não sei" → null
 */
async function extrairNumero(texto, contexto) {
  if (!ativa()) return null;
  try {
    const sys =
      `Extraia o valor numérico que o cliente informou sobre "${contexto}".\n` +
      `Se ele der dimensões (ex: "10 por 8"), multiplique e retorne a área.\n` +
      `Responda APENAS JSON: {"valor": N} (número, use ponto decimal) ` +
      `ou {"valor": null} se não houver número claro. NÃO chute.`;
    const r = await chamar(sys, texto);
    const n = parseFloat(r.valor);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch (e) {
    console.error('[AI] extrairNumero falhou:', e.message);
    return null;
  }
}

/**
 * Chat genérico com resposta JSON — usado pelo modo conversacional (conversa.js).
 * messages = [{role, content}, ...]
 */
async function chat(messages, maxTokens = 400) {
  const { data } = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages,
    },
    {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeout: 15000,
    }
  );
  return JSON.parse(data.choices[0].message.content);
}

module.exports = { escolherOpcao, extrairNumero, ativa, chat };
