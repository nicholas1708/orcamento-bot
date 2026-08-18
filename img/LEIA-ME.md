# Fotos dos produtos

Coloque aqui as fotos que aparecem no site (`/orcamento`) e no PDF do orçamento.

O sistema aceita **JPG ou PNG**. Depois de colocar o arquivo nesta pasta, aponte
para ele no cadastro do produto, no campo **imagem**:

```json
"imagem": "/img/cumeeira-trapezoidal.jpg"
```

Isso vale para os dois lugares de uma vez — a tela do cliente e o PDF.
Produto sem foto cadastrada continua funcionando: o sistema desenha o perfil
da peça no lugar.

## Como as fotos aparecem

Na tela de escolha a foto ocupa a **largura toda do cartão** (uma coluna no
celular, duas no computador), com o nome curto embaixo. Por isso:

- **Proporção 16:10 deitada** é o que melhor preenche o cartão
- **1000 px de largura** já é suficiente — acima disso só pesa o carregamento
- **Fundo claro ou branco** combina com o resto da tela
- A foto é exibida inteira (`object-fit: contain`), então nada é cortado

## Arquivos usados hoje

| Arquivo | Produto | Código |
|---|---|---|
| `telha-confort-pir-galvalume-branco.jpg` | Confort PIR 30mm — Galvalume / Branco | 358769 |
| `telha-confort-pir-branco-branco.jpg` | Confort PIR 30mm — Branco / Branco | 358768 |
| `cumeeira-trapezoidal.jpg` | Cumeeira Galvalume Trapézio 40/1000 | 148384 e 148474 |
| `acabamento-frontal.jpg` | Acabamento Frontal TP 40/1000 | 143019 |
| `acabamento-lateral.jpg` | Acabamento Lateral Trapézio 40/1000 | 152327 |
| `acabamento-interno.jpg` | Acabamento Interno Branco | 142962 |

> As fotos antigas vinham do CDN do site da 4A. Elas continuam funcionando —
> as duas formas convivem, é só uma questão de qual URL está no cadastro.

## Nome curto na tela

A tela encurta sozinha o nome técnico do ERP
("Confort PIR 30mm Trapézio 40/1000 — Galvalume / Branco" vira
**Confort PIR 30mm** com "Galvalume / Branco" embaixo).

Se algum produto ficar com o nome ruim, dá para mandar no cadastro:
acrescente `"nome_curto": "O nome que você quer"` ao produto no
`catalogo.json` e a tela passa a usar exatamente esse texto.
O nome completo continua indo para o PDF e para a nota.
