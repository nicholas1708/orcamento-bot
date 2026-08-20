# Subir atualização sem perder dados

O container é **descartável**: no `docker service update` ele é destruído e
recriado a partir da imagem. Tudo que foi escrito dentro dele desde o último
deploy some — a menos que esteja num volume.

## O que precisa sobreviver

| Caminho | O que é | Se perder |
|---|---|---|
| `dados/` | catálogo em uso (produtos, preços, fotos vinculadas) | a empresa refaz o cadastro inteiro |
| `img/` | fotos enviadas pelo painel | produtos voltam a mostrar o desenho |
| `clientes/` | cadastro dos clientes | perde CPF, endereço, histórico |
| `orcamentos/` | histórico do painel | perde os orçamentos gerados |
| `sessions/` | conversas do WhatsApp em andamento | quem estava no meio do orçamento recomeça |
| `out/` | PDFs gerados | link que já foi enviado ao cliente quebra |
| `cache-geo.json` | cache de CEP | só refaz as consultas, sem prejuízo |

## Stack

```yaml
services:
  bot:
    image: ghcr.io/nicholas1708/orcamento-bot:latest
    environment:
      - PAINEL_SENHA=troque_isto
      - WAHA_URL=http://waha:3000
      - WAHA_API_KEY=a_mesma_chave_do_waha
      - WAHA_SESSION=default
      - PRICING_SOURCE=local
    volumes:
      - orc_dados:/app/dados
      - orc_img:/app/img
      - orc_clientes:/app/clientes
      - orc_orcamentos:/app/orcamentos
      - orc_sessions:/app/sessions
      - orc_out:/app/out

volumes:
  orc_dados:
  orc_img:
  orc_clientes:
  orc_orcamentos:
  orc_sessions:
  orc_out:
```

Volume nomeado é **semeado com o conteúdo da imagem na primeira criação**:
as fotos que estão no repositório entram sozinhas, e as enviadas depois ficam.

## Como o catálogo funciona

```
catalogo.json          semente, versionada no git
dados/catalogo.json    o que o sistema lê e o painel grava
```

Na primeira subida a semente é copiada para `dados/`. **Depois disso o
repositório nunca sobrescreve o que está em uso** — atualizar código não mexe
em dado cadastrado.

O efeito colateral: mudança feita no `catalogo.json` do repositório (preço
novo, produto novo) **não chega sozinha** ao que já está rodando. Para levar,
use a importação de planilha em `/painel/dados`, ou edite pelo painel, ou
apague `dados/catalogo.json` para semear de novo — isso descarta o que a
empresa cadastrou.

Para mudar o lugar da pasta, use a variável `DADOS_DIR`.

## Rotina de atualização

```bash
git push origin main
# espere o build ficar verde na aba Actions do GitHub
docker service update --image ghcr.io/nicholas1708/orcamento-bot:latest --force orcamento_bot
docker service logs -f orcamento_bot --tail 50
```

O push **não** atualiza o que está no ar sozinho: ele só constrói a imagem.
Se o build falhar, o `:latest` continua sendo o código antigo.

## Backup

Volume protege de deploy, não de disco queimado nem de exclusão errada:

```bash
docker run --rm -v orc_dados:/d -v /root/backup:/b alpine \
  tar czf /b/dados-$(date +%F).tar.gz -C /d .
```

Vale repetir para `orc_clientes` e `orc_orcamentos`.
