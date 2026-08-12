# Ligar o WhatsApp no servidor (WAHA)

Instância já existente: **`wh.atendenexo.com.br`** (Kairos VPS — Swarm + Traefik + Portainer).

> ⚠️ **Antes de tudo:** o número tem que ser um **chip dedicado**, nunca o
> principal da empresa. WAHA é API não oficial — se o número for banido, você
> perde o WhatsApp daquele número.

---

## 1. Ver se a sessão está livre

Se a instância do WAHA já é usada por outro projeto, a sessão `default`
provavelmente está ocupada com outro número.

```bash
curl -s -H "X-Api-Key: SUA_CHAVE" https://wh.atendenexo.com.br/api/sessions
```

- **Sessão `default` livre** → siga usando `default`.
- **Já ocupada** → você precisa de uma segunda sessão (`telhas`). Sessão extra
  exige **WAHA Plus**; no WAHA Core só existe a `default`. Sem Plus, a saída é
  subir uma segunda instância do WAHA com outro subdomínio e outro volume.

Decida isso antes de continuar — o resto depende do nome da sessão.

---

## 2. Variáveis de ambiente do bot

No Portainer → Stacks → `orcamento` → Editor, na seção `environment` do serviço:

```yaml
environment:
  - WAHA_URL=http://waha:3000            # nome do serviço na rede interna
  - WAHA_API_KEY=a_mesma_chave_do_waha
  - WAHA_SESSION=default                 # ou 'telhas', conforme o passo 1
  - PAINEL_SENHA=uma_senha_forte         # sem ela o painel não abre
  - PRICING_SOURCE=local
  # - OPENAI_API_KEY=sk-...              # opcional: conversa natural em vez de menus
```

Notas:

- `WAHA_URL` usa o **nome interno do serviço**, não o domínio público — o
  tráfego não precisa sair para a internet e voltar pelo Traefik.
- Os dois serviços têm que estar na **mesma rede overlay**. Se não estiverem,
  use `https://wh.atendenexo.com.br` como `WAHA_URL`.
- `WAHA_SESSION` precisa ser **idêntico** ao nome da sessão criada no passo 3.

Depois: **Update the stack**.

---

## 3. Criar a sessão com o webhook

O webhook é o que faz o WAHA avisar o bot quando chega mensagem. Sem ele o QR
pareia mas o bot fica mudo.

### Pelo dashboard (mais simples)

1. Abra `https://wh.atendenexo.com.br/dashboard` e entre com a API key.
2. **Sessions → Start new session** (ou edite a `default`).
3. Nome: o mesmo do `WAHA_SESSION`.
4. Em **Webhooks**, adicione:
   - URL: `https://SEU-DOMINIO-DO-BOT/webhook`
   - Events: **`message`** (só esse)
5. Salve e inicie a sessão.

### Ou por API

```bash
curl -X POST https://wh.atendenexo.com.br/api/sessions \
  -H "X-Api-Key: SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "default",
    "start": true,
    "config": {
      "webhooks": [{
        "url": "https://SEU-DOMINIO-DO-BOT/webhook",
        "events": ["message"]
      }]
    }
  }'
```

---

## 4. Parear o número

```bash
curl -s -H "X-Api-Key: SUA_CHAVE" \
  "https://wh.atendenexo.com.br/api/default/auth/qr?format=image" \
  --output qr.png
```

Ou pelo dashboard, que mostra o QR na tela.

No celular do **chip dedicado**: WhatsApp → Configurações → Dispositivos
conectados → Conectar dispositivo → aponte para o QR.

Conferir se subiu:

```bash
curl -s -H "X-Api-Key: SUA_CHAVE" \
  https://wh.atendenexo.com.br/api/sessions/default
```

Precisa aparecer `"status": "WORKING"`.

---

## 5. Testar

1. **Sem gastar número:** abra `https://SEU-DOMINIO-DO-BOT/simulador` (pede a
   senha do painel) — é o mesmo fluxo do WhatsApp, sem WAHA no meio.
2. **No WhatsApp:** mande `oi` de outro celular para o número dedicado. Deve vir
   a saudação e o menu de linhas de telha.
3. Faça um orçamento até o fim e confira se o PDF chega.
4. Abra `/painel` — o orçamento tem que estar lá com canal **WhatsApp**.

Se nada responder, o suspeito número um é o webhook:

```bash
docker service logs -f orcamento_bot --tail 100
```

Chegando mensagem, aparece log. Silêncio total = webhook errado ou o WAHA não
alcança o bot.

---

## 6. Cuidados para não perder o número

O bot já ajuda: só responde quem escreve primeiro (nunca dispara mensagem),
e simula "digitando..." com pausa aleatória entre mensagens.

Do lado de fora, o que mais queima número:

- disparo em massa ou lista de transmissão pelo mesmo chip;
- número novo respondendo dezenas de conversas no primeiro dia — deixe o volume
  subir aos poucos;
- muita gente marcando como spam. Quem inicia a conversa raramente denuncia,
  por isso o bot é reativo.

Mantenha o celular do chip com bateria e internet: WAHA depende da sessão viva.

---

## Checklist

- [ ] Chip dedicado, separado do número principal
- [ ] Sessão livre confirmada (ou segunda instância decidida)
- [ ] `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION` e `PAINEL_SENHA` no stack
- [ ] Sessão criada com webhook em `/webhook`, evento `message`
- [ ] QR pareado, status `WORKING`
- [ ] Teste ponta a ponta com PDF chegando
- [ ] Orçamento aparecendo em `/painel`
