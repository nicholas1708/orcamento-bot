# Subir esta versão — leia antes

Duas coisas mudam no servidor, e a ordem importa.

## ⚠️ 1. Hoje o deploy APAGA o cadastro

O stack que está no ar não tem volume para `/app/dados` nem para `/app/img`.
O container é destruído e recriado a cada atualização, então **tudo que foi
cadastrado pelo painel volta ao que está no repositório**:

| O que | Onde mora | No stack antigo |
|---|---|---|
| Catálogo em uso (produtos, preços, vínculos) | `/app/dados/catalogo.json` | ❌ perdido |
| Fotos enviadas pelo painel | `/app/img` | ❌ perdido |
| Vendedores | `/app/dados/vendedores.json` | ❌ perdido |
| Clientes, orçamentos, PDFs, conversas | volumes próprios | ✅ mantidos |

O `docker-stack.yml` deste commit corrige isso: adiciona `orcamento-dados` e
`orcamento-fotos`. **Atualize o stack no Portainer junto com a imagem** — não
adianta subir a imagem nova e deixar o stack velho.

### Antes de atualizar, salve o que está no ar

Se você cadastrou produto, preço ou foto direto no painel de produção depois
do último deploy, isso ainda não está em lugar nenhum. Salve agora:

1. Entre no painel como admin
2. Abra `https://orcamento.atendenexo.com.br/api/painel/produtos`
3. Salve a página (Ctrl+S) — é o catálogo inteiro em JSON

Se nunca cadastrou nada em produção, pode pular: o catálogo do repositório já
é o certo.

## 2. O vínculo dos acabamentos entra sozinho

Sim — mas não pelo caminho óbvio, e vale entender por quê.

A semente do repositório (`catalogo.json`) já traz `compativeis` nas duas
telhas. Só que a semente é copiada **uma vez**, na primeira execução; depois
disso o repositório nunca sobrescreve o catálogo em uso. Num servidor que já
roda, o vínculo novo nunca chegaria.

Por isso o servidor roda `migrarVinculos()` na subida. Ela:

- preenche o vínculo **só nas telhas que não têm nenhum**
- nunca sobrescreve o que você escolheu no painel
- só vincula id de acabamento que existe de verdade no catálogo em uso
- grava `dados/catalogo.antes-do-vinculo.json` antes de mexer
- é idempotente: da segunda subida em diante não faz nada

No log do container você vê:

```
[vínculos] acabamentos vinculados em 2 telha(s): Confort PIR 30mm ... Galvalume / Branco · Confort PIR 30mm ... Branco / Branco
```

**Telha que só existe no servidor** (cadastrada direto no painel, que a
semente não conhece) fica **sem vínculo** de propósito — a migração não tem
como adivinhar. O painel avisa: aparece na aba Acabamentos como órfão e no
diagnóstico como problema. Abra a telha, use "Copiar de outra telha" e ajuste
a cumeeira.

## 3. Depois de subir, confira

- [ ] Log do container tem a linha `[vínculos]` (ou nada, se já estava certo)
- [ ] `/painel/produtos` → aba Acabamentos: nenhum aviso de órfão
- [ ] Abrir a telha **Branco / Branco** e ver a cumeeira **branca** marcada,
      e a galvalume desmarcada
- [ ] Fazer um orçamento de teste em `/orcamento` e conferir a cumeeira do PDF
- [ ] `PAINEL_SENHA` trocado — o painel mostra CPF, telefone e endereço de
      todos os clientes
- [ ] Se for usar a rede de vendedores: cadastrar em `/painel/vendedores` e
      mandar o link de cada um por canal privado

## 4. Rodar os testes antes

```
cd C:\xampp\htdocs\orcamento-bot
npm test
```

São seis: motor, vínculo, migração, vendedores, regressão de 2 águas e fluxo
completo. O de migração e o de vendedores usam pasta temporária — não encostam
em cadastro real.
