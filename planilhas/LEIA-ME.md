# 📋 Como preencher as planilhas — Sistema de Orçamento Automático

Olá! Estas 3 planilhas alimentam o sistema que vai gerar os orçamentos
automaticamente pelo WhatsApp e pelo site. **Tudo que o sistema calcula sai
daqui** — por isso, quanto mais exatos os dados, mais confiável o orçamento.

Leia com calma, é rápido. Qualquer dúvida, é só chamar.

---

## ⚠️ Antes de começar — abrindo os arquivos

Os arquivos são `.csv`. Para abrir **do jeito certo** no Excel:

1. Abra o **Excel primeiro** (vazio).
2. Vá em **Dados → Obter Dados → De Arquivo → De Texto/CSV**.
3. Escolha o arquivo. Na janela que abrir, confira:
   - **Origem do arquivo:** `65001: Unicode (UTF-8)`
   - **Delimitador:** `Ponto e vírgula`
4. Clique em **Carregar**.

> Se abrir com duplo clique e tudo aparecer amontoado numa coluna só, feche sem
> salvar e siga os passos acima.

**Ao salvar:** use **Arquivo → Salvar como → CSV UTF-8 (delimitado por vírgulas)**.
O Excel vai avisar que "algumas funcionalidades serão perdidas" — pode confirmar,
é normal.

> 💡 **Prefere não mexer com CSV?** Pode preencher no Google Planilhas (importe o
> arquivo, preencha e baixe como CSV) ou até mandar em Excel comum — a gente converte.

### Regras de preenchimento

| Regra | Certo ✅ | Errado ❌ |
|---|---|---|
| Números com **vírgula** decimal | `33,50` | `33.50` |
| Medidas em **metros** | `0,98` | `980` ou `98cm` |
| Não use `R$`, `m`, `%` nas células | `135,00` | `R$ 135,00` |
| Sim/Não escrito assim | `SIM` / `NAO` | `x` / `verdadeiro` |
| Não apague nem renomeie colunas | — | — |
| Não deixe linha em branco no meio | — | — |

---

# 1️⃣ Planilha de PRODUTOS (`1-produtos.csv`)

**Uma linha para cada produto que vocês vendem.** Cada cor é uma linha própria —
igual ao cadastro do GestãoClick, onde cada variação tem seu código.

Deixei **19 produtos já preenchidos como exemplo**. Confira, corrija os valores e
acrescente o que faltar. Pode apagar os exemplos que não vendem.

### Campo a campo

| Coluna | O que é | Exemplo | Quem preenche |
|---|---|---|---|
| **codigo** | Código do produto no GestãoClick. Deixe vazio se ainda não tiver. | `5942` | Comercial |
| **nome** | Nome do produto como vocês chamam | `Telha Comum Galvalume Trapézio 40/980 0,43mm` | Comercial |
| **familia** | O grupo em que ele aparece pro cliente | `Telha Galvalume (simples)` | Comercial |
| **cor** | A cor/acabamento desta linha | `Terracota c/ Forro Preto` | Comercial |
| **preco_por_metro** | Preço por **metro linear** | `33,50` | Comercial |
| **largura_util_m** | ⚠️ **Largura ÚTIL**, em metros | `0,98` | Técnico |
| **comprimento_maximo_m** | Maior peça que a fábrica corta | `12` | Técnico |
| **comprimento_minimo_m** | Menor peça que a fábrica corta | `0,50` | Técnico |
| **transpasse_m** | Sobreposição ao emendar duas peças | `0,20` | Técnico |
| **vao_maximo_m** | Distância máxima entre as terças | `1,80` | Técnico |
| **inclinacao_minima_pct** | Caimento mínimo do telhado, em % | `10` | Técnico |
| **forro_integrado** | `SIM` se já vem com forro/isolamento | `SIM` | Comercial |
| **ativo** | `SIM` ou `NAO` (desativa sem apagar) | `SIM` | Comercial |
| **imagem_url** | Link da foto (opcional) | | — |
| **observacao** | Anotações internas — o cliente não vê | | — |

### 🔴 O campo mais importante: `largura_util_m`

**Largura útil ≠ largura total.**

A largura total é a chapa inteira. A largura útil é o que **efetivamente cobre**
depois que uma telha sobrepõe a outra na lateral.

- Na `40/980`, os **980 mm = 0,98 m** são a largura **útil**. ✅
- A onda que sobrepõe a telha vizinha **não conta**.

**Por que isso importa:** o sistema calcula quantas telhas o telhado precisa
dividindo o comprimento do galpão pela largura útil. Se você colocar a largura
total, **vai faltar telha na obra**.

> Em caso de dúvida, use o valor que aparece no nome do perfil (o "980" do
> 40/980) ou confirme com a fábrica.

### 💰 Sobre o preço

O preço é **por metro linear**, exatamente como vocês já cobram hoje.
Conferindo com o orçamento nº 11247 de vocês:

> 3 peças × 4,000 m × R$ 33,50 = **R$ 402,00** ✅

Ou seja: preencha o mesmo valor que aparece na coluna "VR. UNIT." dos orçamentos.

### 📐 Sobre os campos técnicos

Se vocês não tiverem esses números na ponta da língua, peça pra fábrica ou use os
que já deixei preenchidos como referência — eles seguem o padrão do mercado. Só
não deixe em branco: **sem eles o sistema não calcula.**

- **comprimento_maximo_m** — quando a obra precisa de uma telha maior que isso, o
  sistema divide automaticamente em peças emendadas e mostra as opções ao cliente.
- **transpasse_m** — quanto uma peça cobre a outra na emenda. Entra no cálculo do
  material.
- **vao_maximo_m** — usado só quando o cliente pede estrutura junto.
- **inclinacao_minima_pct** — se o telhado for mais "deitado" que isso, o sistema
  avisa e manda pro vendedor.

---

# 2️⃣ Planilha de FRETE (`2-fretes.csv`)

Uma linha para cada **faixa de distância**. O sistema mede quantos km separam a
unidade mais próxima do endereço da obra e aplica a faixa correspondente.

| Coluna | O que é | Exemplo |
|---|---|---|
| **km_de** | Onde a faixa começa | `0` |
| **km_ate** | Onde a faixa termina | `50` |
| **valor_fixo** | Valor do frete nessa faixa | `150,00` |
| **valor_por_metro** | Adicional por metro linear (use `0` se não cobrar) | `1,20` |
| **frete_gratis_acima_de** | Valor de pedido que zera o frete (vazio = nunca) | `3000,00` |
| **observacao** | Nota livre | |

**Como a conta é feita:**

```
frete = valor_fixo + (metros de telha × valor_por_metro)
```

E fica **grátis** se o pedido passar do valor em `frete_gratis_acima_de`.

### Pontos de atenção

- **Não deixe buracos entre as faixas.** Se uma termina em `50`, a próxima começa
  em `51`. Um buraco faz o orçamento sair como "frete a confirmar".
- **Faixa muito distante:** deixe `valor_fixo` **em branco**. Assim o sistema não
  inventa valor — o orçamento sai com *"frete a confirmar pelo vendedor"*, e a
  cotação é feita manualmente.
- O frete aparece em **linha separada** no orçamento e soma no total. Nunca é
  embutido no preço do produto.

---

# 3️⃣ Planilha de UNIDADES (`3-unidades.csv`)

As fábricas/centros de distribuição. O sistema escolhe **a mais próxima da obra**
para calcular o frete.

| Coluna | O que é |
|---|---|
| **unidade** | Nome da unidade |
| **cep** | ⚠️ CEP da unidade — é daqui que sai o cálculo de distância |
| **cidade** / **uf** | Cidade e estado |
| **endereco** | Endereço completo (aparece no rodapé do orçamento) |
| **ativa** | `SIM` ou `NAO` |
| **produtos_disponiveis** | `TODOS`, ou os códigos separados por vírgula se a unidade só tem parte do catálogo |

> **Sem telefone aqui, de propósito.** O contato é do representante, não das
> fábricas — então ele fica só no cabeçalho do orçamento, junto com os dados da
> empresa. Assim o cliente sempre liga pra vocês, não pra unidade.

Já preenchi com as **9 unidades** que aparecem no rodapé dos orçamentos de vocês.

**Confiram principalmente os CEPs** — é o dado que define de qual unidade o
material sai e, consequentemente, o valor do frete.

**`produtos_disponiveis`** é útil quando um produto só existe em algumas unidades:
o sistema então ignora as que não têm e calcula o frete a partir da unidade mais
próxima **que consegue atender**.

---

## ✅ Checklist antes de devolver

- [ ] Todos os produtos que vocês vendem estão listados
- [ ] Cada cor é uma linha separada
- [ ] `largura_util_m` preenchida em **todas** as linhas (e é a útil, não a total)
- [ ] Preços conferidos com um orçamento recente
- [ ] Nenhum `R$`, `m` ou `%` dentro das células
- [ ] Números com vírgula decimal (`33,50`)
- [ ] Faixas de frete sem buracos
- [ ] CEPs das unidades conferidos
- [ ] Arquivos salvos como **CSV UTF-8**

---

## 📤 Como devolver

Mandem os 3 arquivos preenchidos. Ao carregar, o sistema **valida tudo antes de
aceitar** e aponta exatamente qual linha tem problema — então não tem risco de
entrar dado incompleto sem ninguém perceber.

Depois de carregar, o passo seguinte é uma **conferência final**: pegamos 2 ou 3
orçamentos que o vendedor fez à mão e comparamos com o que o sistema gera. Se os
valores baterem, está pronto pra rodar com clientes.
