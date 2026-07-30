# 📋 Projeto — Orçamento Automático de Telhas (4A Representação)

> Documento de consolidação da conversa de desenvolvimento. Serve como contexto para retomar o projeto em outra sessão.
> Última atualização: 27/07/2026

---

## 1. Objetivo

Automatizar o orçamento de coberturas: o cliente chama no WhatsApp (ou acessa um link), escolhe telha/acabamento/estrutura, informa medidas e dados, e recebe um **orçamento em PDF na hora** — sem intervenção do vendedor nos casos padrão.

**Empresa modelo:** 4A Representação (www.4arepresentacao.com.br) — telhas termoisolantes, coloniais, galvalume, painéis.
**ERP da empresa:** GestãoClick (API ainda não contratada).

---

## 2. Decisões tomadas (e o porquê)

| Decisão | Escolha | Motivo |
|---|---|---|
| Stack | **Node.js** | Combina com WAHA (webhooks), ecossistema forte pra PDF/WhatsApp |
| WhatsApp | **WAHA** (já rodando em `wh.atendenexo.com.br`) | Servidor da Kairos já tem, multi-sessão. Migração futura pra Cloud API oficial troca só `waha.js` |
| Preços | **Catálogo local agora → GestãoClick depois** | API não contratada. `pricing.js` é adapter plugável: troca 1 variável no `.env` |
| Papel da IA | **Só conversa** | Ver seção 3 |
| Deploy | Swarm + Traefik + Portainer (padrão Kairos) | Reaproveita infra e fluxo já conhecido (GitHub Action → GHCR → stack) |
| Hospedagem compartilhada | Só funciona **se tiver Node.js** | PHP-only exigiria porte completo |

---

## 3. ⚠️ REGRA INVIOLÁVEL — o papel da IA

**A IA conversa. O código calcula.**

A IA **pode**: entender linguagem natural, responder dúvidas sobre produtos (usando só o catálogo injetado no prompt), pedir dados que faltam, explicar o que é cumeeira/rufo/calha, enviar fotos de acabamentos cadastrados.

A IA **nunca**: calcula total, inventa preço, escolhe produto fora do catálogo, promete prazo/desconto/frete, tira medidas de fotos, define dado técnico.

**Garantias implementadas:**
- Todo campo extraído pela IA é **validado pelo código** contra o catálogo antes de entrar na ficha.
- O resumo de confirmação e o cálculo são montados pelo **código**, não pela IA.
- Sem chave de IA, o bot degrada para **menu numerado** e continua 100% funcional.
- Foto recebida do cliente é **anexada para o vendedor**, nunca interpretada como dado técnico.

---

## 4. Arquitetura

```
┌─ WhatsApp (WAHA) ─┐        ┌─ Navegador ─┐
│  server.js        │        │ /orcamento  │  ← wizard passo a passo
│  /webhook         │        │ (wizard)    │
└─────────┬─────────┘        └──────┬──────┘
          │                         │
     flow.js (menu)            /api/orcamento
     conversa.js (IA)               │
     state.js (ficha em disco)      │
          └───────────┬─────────────┘
                      ▼
         engine.js  ← MOTOR DETERMINÍSTICO (coeficientes → lista de materiais)
                      │
         pricing.js ← preços (catalogo.json | GestãoClick)
                      │
         pdf.js     → PDF do orçamento
```

### Arquivos

| Arquivo | Papel |
|---|---|
| `catalogo.json` | **Coração do sistema.** 40 produtos reais da 4A com famílias, atributos, fotos, coeficientes, tabela de frete |
| `catalogo_editavel.csv` | Mesma base em planilha, pra equipe revisar no Excel |
| `engine.js` | Motor de cálculo determinístico (m² → materiais → total) |
| `pricing.js` | Adapter de preços (local ↔ GestãoClick) com cache de 5 min |
| `flow.js` | Máquina de estados (modo menu) + roteamento pro modo IA |
| `conversa.js` | Modo conversacional com IA + funil de famílias |
| `ai.js` | Cliente OpenAI (classificação e chat, `temperature: 0`) |
| `state.js` | Ficha do cliente persistida em `sessions/` |
| `waha.js` | Camada de envio WhatsApp (texto, PDF, imagem) |
| `pdf.js` | Geração do PDF (pdfkit) |
| `server.js` | Webhook WAHA + APIs do wizard + simulador |
| `orcamento.html` | **Wizard web** passo a passo com fotos |
| `simulador.html` | Chat de teste no navegador |
| `test.js` | Teste do motor sem WhatsApp (`npm test`) |

---

## 5. Regras de negócio implementadas

1. **Sem endereço não há orçamento.** O frete depende da localidade — endereço com rua, número e bairro é obrigatório (validado nos 3 caminhos: menu, IA e wizard).
2. **Frete por tabela cadastrável.** Cidade encontrada → frete entra como item. Não encontrada → PDF sai com aviso "frete a confirmar", nunca inventa valor.
3. **Funil de famílias.** Com +12 telhas, pergunta a linha primeiro, depois as variações — mantém o prompt pequeno e a escolha simples.
4. **Compatibilidade no dado.** `forros_compativeis` por telha; telha sanduíche define forro integrado automaticamente.
5. **Cumeeira deduzida.** Não pergunta metros — pergunta "1 ou 2 quedas"; se 2, usa o comprimento do telhado.
6. **Handoff pro vendedor:** 3 erros seguidos, área > 300m², ou cliente digita "atendente".

---

## 6. Estado atual

**Pronto:** catálogo completo da 4A (40 produtos + 40 fotos reais), motor de cálculo, PDF, bot WhatsApp (menu + IA), wizard web, simulador, Dockerfile, docker-stack.yml, GitHub Action, integração GestãoClick codificada conforme documentação oficial.

**⚠️ Nunca executado.** O código não foi rodado nenhuma vez (ambiente de execução indisponível durante o desenvolvimento). O `npm test` é o primeiro passo obrigatório.

---

## 7. Pendências antes do piloto

### Técnicas (rápidas)
- [ ] `npm install` + `npm test` — valida JSON do catálogo e geração do PDF
- [ ] Testar `/simulador` e `/orcamento` localmente
- [ ] Preencher `.env` com dados reais da empresa (aparecem no PDF)

### De negócio (críticas)
- [ ] **Validar preços e coeficientes com a 4A.** Todos os valores atuais são estimativa. Comparar 2-3 orçamentos feitos à mão pelo vendedor com a saída do sistema. *Este é o teste que decide se o projeto serve.*
- [ ] **Cadastrar as cidades reais na tabela de frete** (hoje só 5 exemplos de BH e região)

### Antes de ir ao ar
- [ ] **Notificar o vendedor no handoff** — hoje só escreve no log do servidor; leads se perdem
- [ ] **Proteger `/out` e `/simulador`** — PDFs com nome, telefone e endereço de clientes ficam públicos por URL (risco LGPD)
- [ ] Número de WhatsApp **dedicado** (nunca o principal — risco de ban da Meta com WAHA)

---

## 8. Comandos

```bash
# Local
npm install
copy env.example .env        # Windows
npm test                     # motor + PDF de exemplo
npm start                    # http://localhost:3000

# Deploy
git add . && git commit -m "..." && git push origin main
# → GitHub Actions builda → Portainer: Update stack + "Re-pull image"

# Criar sessão dedicada no WAHA
curl -X POST https://wh.atendenexo.com.br/api/sessions \
  -H "X-Api-Key: CHAVE" -H "Content-Type: application/json" \
  -d '{"name":"telhas","config":{"webhooks":[{"url":"https://orcamento.atendenexo.com.br/webhook","events":["message"]}]}}'
```

**URLs:** `/orcamento` (wizard), `/simulador` (chat de teste), `/health`, `/webhook` (WAHA)

---

## 9. Roadmap

1. **Agora:** validar catálogo real → piloto com número dedicado
2. **GestãoClick:** gerar tokens no ERP (Configurações → Aplicativos → API) → preencher `.env` → mapear `gc_id` de cada produto → `PRICING_SOURCE=gestaoclick`
3. **Fase 2 GestãoClick:** gravar o orçamento no ERP via `POST /api/orcamentos` com campo extra "Origem: Automação WhatsApp"
4. **Auditoria** (do conceito RoofEngine): salvar JSON de cada orçamento com data, versão do catálogo e itens consultados — permite reconstruir orçamentos antigos
5. **Escala:** migrar `sessions/` de arquivo para SQLite/Postgres; migrar WAHA → WhatsApp Cloud API oficial

---

## 10. Referências

- [Documentação API GestãoClick (Apiary)](https://gestaoclick.docs.apiary.io/) — auth por `access-token` + `secret-access-token`, 3 req/s, 100 registros/página
- [Gerar token da API no ERP](https://ajuda.gestaoclick.com.br/hc/pt-br/articles/360059920934-Como-gerar-token-da-API-para-usar-externamente)
- [WAHA](https://waha.devlike.pro/docs) — desde 2026.6.1 o envio de mídia é gratuito no Core
- Catálogo e fotos: [4A Representação](https://www.4arepresentacao.com.br/produtos)

### Nota sobre risco do WAHA
O WAHA não é oficial (usa protocolo do WhatsApp Web) — há risco de banimento do número. O uso aqui é **reativo** (cliente inicia a conversa), que é o padrão de menor risco. Mitigações aplicadas: número dedicado, delays humanos e "digitando...". Migração para a Cloud API oficial elimina o risco e exige trocar apenas `waha.js`.
