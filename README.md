# 🤖 Bot de Orçamento Automático — Telhas & Forro via WhatsApp

Cliente chama no WhatsApp → bot conduz por menus → motor calcula a lista de materiais → gera PDF → envia na hora.

**Arquitetura em camadas (cada uma trocável sem mexer nas outras):**

```
WhatsApp (cliente)
   │
   ▼
WAHA (wh.atendenexo.com.br) ──webhook──► server.js ──► flow.js (máquina de estados + ficha em disco)
                                            │
                                            ▼
                              engine.js (coeficientes → lista de materiais)
                                            │
                              pricing.js (preços: catalogo.json AGORA,
                                          API GestãoClick DEPOIS)
                                            │
                                            ▼
                              pdf.js (PDF do orçamento) ──► WAHA ──► cliente
```

**Princípios de segurança do projeto:**
- **Zero IA no caminho crítico**: menus numerados + matemática determinística. Nada de alucinação em preço.
- **Contexto nunca se perde**: a "ficha" de cada cliente fica em `sessions/` no disco (volume em produção).
- **GestãoClick plugável**: hoje os preços vêm do `catalogo.json`; quando contratar a API, é trocar `PRICING_SOURCE=gestaoclick` (ver `pricing.js`).
- **Fallback humano**: 3 erros seguidos, área acima do limite ou comando `atendente` → encaminha pro vendedor.

## Arquivos

| Arquivo | Papel |
|---|---|
| `catalogo.json` | Produtos, preços e **coeficientes de consumo** (o know-how da empresa) |
| `catalogo_editavel.csv` | Mesma base em planilha, pra equipe revisar no Excel |
| `engine.js` | Motor de cálculo (m² → lista de materiais) |
| `pricing.js` | Adapter de preços (local ↔ GestãoClick) |
| `flow.js` | Conversa: máquina de estados com menus |
| `state.js` | Ficha do cliente persistida em disco |
| `waha.js` | Envio via WAHA (trocável por Cloud API oficial) |
| `pdf.js` | Geração do PDF do orçamento |
| `server.js` | Webhook + simulador |
| `test.js` | Teste local sem WhatsApp (`npm test`) |
| `simulador.html` | Chat de teste no navegador (`/simulador`) |

## Rodar local (testes)

```bash
npm install
copy env.example .env       # Windows (Linux/Mac: cp env.example .env)
npm test                    # lista de materiais + out/orcamento-exemplo.pdf
npm start                   # sobe o servidor
```

Abra **http://localhost:3000/simulador** — chat estilo WhatsApp usando o mesmo fluxo de produção, com PDF no final.

**Antes do piloto: revise o `catalogo_editavel.csv` com a equipe (preços e coeficientes reais), replique no `catalogo.json` e compare o `npm test` com um orçamento feito à mão pelo vendedor.**

## Deploy — servidor Kairos/AtendeNexo (Swarm + Traefik + Portainer)

O servidor **já tem WAHA** em `https://wh.atendenexo.com.br` (multi-sessão). Deploy igual ao Kairos:

1. **GitHub:** push deste repo na `main` → Action builda `ghcr.io/nicholas1708/orcamento-bot:latest`. (Se a imagem nascer privada no GHCR, torne pública ou use a credencial que o Portainer já tem pro `agenda-kairos`.)
2. **DNS:** `orcamento.atendenexo.com.br` → IP do servidor.
3. **Portainer:** stack nova com `docker-stack.yml`; preencher `WAHA_API_KEY` e dados da empresa.
4. **Sessão dedicada no WAHA** (não usar a do Kairos):

```bash
curl -X POST https://wh.atendenexo.com.br/api/sessions \
  -H "X-Api-Key: SUA_CHAVE" -H "Content-Type: application/json" \
  -d '{"name":"telhas","config":{"webhooks":[{"url":"https://orcamento.atendenexo.com.br/webhook","events":["message"]}]}}'

curl -X POST https://wh.atendenexo.com.br/api/sessions/telhas/start -H "X-Api-Key: SUA_CHAVE"
```

5. **Parear:** dashboard do WAHA → sessão `telhas` → QR → escanear com **número dedicado** (⚠️ nunca o principal — risco de ban da Meta).
6. **Validar:** `/health` → `{ok:true}`, depois `/simulador`, depois "oi" no WhatsApp real.

> ⚠️ Em produção o `/simulador` e o `/out` ficam públicos — proteger com senha ou remover após os testes.

## Roadmap

1. Validar catálogo real → piloto no WhatsApp com número dedicado.
2. **GestãoClick**: tokens no ERP (Configurações → Aplicativos → API) → preencher env → mapear `gc_id` → `PRICING_SOURCE=gestaoclick`. Fase 2: criar o orçamento dentro do ERP marcado "origem: automação WhatsApp".
3. **IA opcional** (NLU): interpretar texto livre → opção de menu. A IA nunca calcula nem inventa preço.
4. Migração pra WhatsApp Cloud API oficial se escalar: trocar só `waha.js`.
