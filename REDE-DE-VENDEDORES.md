# Rede de vendedores

Como funciona, o que mudou e o que **não** mudou.

## O que não mudou

O motor. `engine.js`, `romaneio.js` e `pricing.js` não sabem que vendedor
existe — não recebem, não guardam, não consultam. Dois clientes pedindo a
mesma telha na mesma metragem pagam o mesmo, tenham vindo de qual link for.

O vendedor é um **filtro** de duas coisas:

- o que aparece na vitrine dele
- o que ele enxerga no painel

Nada além disso.

## Sem nenhum vendedor cadastrado

O sistema se comporta exatamente como antes:

- `/orcamento` mostra todas as telhas ativas
- o `PAINEL_SENHA` abre o painel como administrador
- os orçamentos saem sem dono e só o admin os vê

Ou seja: subir esta versão não muda nada até você cadastrar o primeiro
vendedor.

## Login

Continua Basic auth — o mesmo popup do navegador, agora com usuário:

| Usuário | Senha | Vê |
|---|---|---|
| `admin` (ou em branco) | o `PAINEL_SENHA` | tudo |
| o usuário do vendedor | a senha dele | só o que é dele |

O `admin` + `PAINEL_SENHA` **sempre** funciona. É a saída de emergência: se o
`dados/vendedores.json` se perder ou alguém errar o próprio cadastro, você
ainda entra e arruma.

As senhas ficam com hash scrypt e sal por usuário. Não dá para ler a senha de
ninguém abrindo o arquivo — nem você.

## Só o admin faz

- cadastrar, editar e desativar produto (telha, acabamento, perfil)
- cadastrar vendedor
- importar planilha
- ver o diagnóstico

Está protegido no servidor (`exigirAdmin`), não só escondido no menu.

## O link de venda

Cada vendedor recebe `https://SEU-SITE/orcamento?v=slug`. Também vale para a
LP: `https://SEU-SITE/lp?v=slug` — todos os botões dela levam o slug adiante.

O que acontece com esse link:

1. a vitrine chega reduzida à linha dele
2. o cliente vê "Atendimento: Fulano" no topo e no rodapé do PDF
3. o orçamento nasce com `vendedorId` — é por aí que o painel filtra

**O slug vem da tela, mas quem decide é o cadastro.** Slug inventado, apagado
ou de vendedor desativado não vira dono: o orçamento sai como link público.

## A trava

A tela mostra só a linha do vendedor. Se alguém trocar o `telhaId` no POST, o
servidor recusa em `montarPedido` — a conferência é feita contra o cadastro,
dos três modos de orçamento (automático, itens e formato antigo).

O mesmo vale para o painel: o vendedor não lista, não abre e não muda status
de orçamento que não é dele. Cliente que nunca passou pelo link dele responde
404, não 403 — ele nem fica sabendo que existe.

## Acabamento por telha

Antes deste ajuste, a telha **branca** recebia cumeeira **galvalume**: o
código pegava qualquer complemento ativo com o `aplica_em` certo.

Agora cada telha tem, no cadastro, quais acabamentos e perfis a acompanham
(`compativeis`). Isso vale nos quatro lugares: cálculo automático, wizard do
site, WhatsApp e sugestão de acabamentos.

Telha **sem** vínculo cadastrado continua aceitando tudo que está ativo — de
propósito, para catálogo antigo não quebrar ao subir a versão nova.

### Cadastrando a segunda telha em diante

O vínculo é escolhido dentro do cadastro da telha, que é onde você sabe o que
vai junto. Para isso não virar trabalho braçal:

- **Telha nova nasce com nada marcado.** Antes nascia com tudo, o que virava
  "aceita tudo" e trazia o defeito de volta calado. Agora ela avisa que falta
  escolher.
- **Busca dentro da lista.** Digite "cumeeira" e só as cumeeiras ficam na
  tela. A busca **esconde, não desmarca** — o que estava marcado fora do
  filtro continua marcado, e é isso que vai para o cadastro.
- **Marcar / Desmarcar agem só no que está visível.** Procuro "parafuso",
  clico Marcar, marco os parafusos — sem varrer o resto junto.
- **Contador "3 de 20 marcados"** para você saber onde está mesmo filtrando.
- **"Copiar de outra telha"** puxa as marcações de uma já cadastrada. Telha
  nova quase sempre repete tudo da irmã e muda só a cumeeira.
- **Salvar sem nenhum acabamento pede confirmação** — dá pra fazer, mas não
  sem querer.

A mesma busca está no cadastro de vendedor, na lista de telhas que ele vende.

### Acabamento novo

Ele **não** entra sozinho nas telhas já cadastradas — se entrasse, a cumeeira
errada voltaria a aparecer. Então o painel cobra:

- aviso no topo da aba Acabamentos listando quem está fora de toda telha
- coluna **"Vai em"** mostrando em quantas telhas cada peça está marcada
- o diagnóstico do cadastro trata isso como **problema**, não como alerta

## Onde ficam os dados

`dados/vendedores.json`, ao lado do `dados/catalogo.json`. É volume no Docker:
não some no deploy. Nunca é sobrescrito pelo repositório.

## Testar

```
npm test
```

Roda os cinco: motor, vínculo de acabamento, rede de vendedores, regressão de
2 águas e o fluxo completo. O `teste-vendedores.js` usa uma pasta temporária —
não encosta no cadastro de verdade.

## Antes de colocar no ar

- [ ] Trocar o `PAINEL_SENHA` — o painel mostra CPF, telefone e endereço de
      todos os clientes, e `123456789` não segura isso.
- [ ] Cadastrar os vendedores e mandar o link de cada um por canal privado.
- [ ] Conferir o vínculo de acabamento das duas telhas na tela de Produtos.
