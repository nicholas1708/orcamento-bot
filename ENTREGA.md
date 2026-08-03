# 🚀 Guia de Entrega — Sistema de Orçamento Automático 4A

Este documento tem duas partes:
**A)** o que enviar/apresentar ao cliente · **B)** o checklist para finalizar o projeto.

---

# PARTE A — O que o cliente recebe

## Os 3 endereços do sistema

| Endereço | Para quem | Senha? |
|---|---|---|
| `https://orcamento.atendenexo.com.br/orcamento` | **Clientes finais** — monta o orçamento sozinho | ❌ Não |
| WhatsApp da empresa | **Clientes finais** — mesma coisa, pelo chat | ❌ Não |
| `https://orcamento.atendenexo.com.br/painel` | **Equipe da 4A** — vê tudo e cadastra dados | ✅ Sim |

> Quem faz orçamento **nunca** vê senha. A senha existe só para a empresa
> acompanhar os orçamentos e mexer no catálogo.

---

## 1. Link público do orçamento

É o link que vai no Instagram, no site, no Google Meu Negócio e na assinatura
de e-mail. O cliente entra, escolhe a telha, informa as medidas e recebe o PDF
na hora — sem cadastro, sem senha, sem instalar nada.

**Sugestão de chamada:** *"Faça seu orçamento de telhas em 2 minutos"*

## 2. WhatsApp

O mesmo processo, pelo chat. O cliente manda mensagem, o assistente conduz e
envia o PDF. Funciona 24h — inclusive fora do horário comercial, que é quando
a maioria dos orçamentos se perde hoje.

Se o cliente digitar **"atendente"**, ou se o pedido fugir do padrão, a conversa
é encaminhada para um vendedor humano.

## 3. Painel da empresa (`/painel`)

Onde a equipe acompanha tudo:

- **Todos os orçamentos**, com filtro por período, cliente, canal e situação
- **Separação de origem:** quais o cliente fez sozinho e quais o vendedor gerou
- **Indicadores:** quantidade, valor total, ticket médio, taxa de fechamento
- **Situação de cada um:** Novo → Em negociação → Fechado / Perdido
- **PDF de cada orçamento** e exportação para Excel
- **Botão "+ Novo orçamento"** para o vendedor montar um internamente

## 4. Cadastro de dados (`/painel/dados`)

É aqui que a empresa mantém o sistema atualizado, **sem depender de programador**:

1. Baixa o modelo da planilha (já vem com o que está cadastrado)
2. Preenche/corrige no Excel
3. Envia de volta
4. O sistema confere e mostra os problemas **antes** de aplicar
5. Confirma → o catálogo é atualizado na hora

Envie junto o arquivo **`planilhas/LEIA-ME.md`**, que explica campo a campo
como preencher (vale imprimir como PDF).

---

## O que apresentar na reunião — roteiro de 10 minutos

1. **Abra o link do orçamento** e monte um pedido real na frente deles
   (ex: galpão 20×10, duas águas) — mostre o PDF saindo no final.
2. **Mostre o mesmo pelo WhatsApp**, com o celular na mão.
3. **Abra o painel** e mostre o orçamento que acabou de aparecer lá.
4. **Mostre a tela de cadastro** e explique que eles mesmos atualizam preços.
5. **Entregue as planilhas** e combine o prazo de devolução.

---

# PARTE B — Checklist para finalizar

## 🔴 Bloqueadores (sem isto não vai pro ar)

- [ ] **Rodar `npm test`** — valida o motor contra o orçamento real nº 11247.
      *Nunca foi executado. É o primeiro passo.*
- [ ] **Definir `PAINEL_SENHA`** no Portainer — sem ela o painel não abre.
- [ ] **Receber as 3 planilhas preenchidas** e importar por `/painel/dados`.
- [ ] **Conferir o cálculo:** pegar 2–3 orçamentos que o vendedor fez à mão e
      comparar com o que o sistema gera. Se os valores baterem, está calibrado.

## 🟡 Necessários para o WhatsApp funcionar

- [ ] **Número dedicado** (chip novo — nunca o principal da empresa)
- [ ] **Criar a sessão `telhas`** no WAHA e parear o QR code
- [ ] **Configurar o webhook** apontando para `/webhook`
- [ ] *(opcional)* **Chave da OpenAI** — sem ela o bot funciona por menus
      numerados; com ela a conversa fica natural

## 🟡 Definições que dependem da 4A

- [ ] **Valores reais** de preço por metro e das faixas de frete
- [ ] **Dados técnicos:** largura útil, comprimento máximo, transpasse, vão máximo
- [ ] **Frete entra no parcelamento?** Hoje está somando junto ao cartão.
      Se for pago à parte na entrega, mudar `pagamento.aplicar_sobre` para `"produtos"`
- [ ] **Conferir os CEPs das unidades** — é deles que sai o cálculo de distância

## 🟢 Melhorias que ficaram mapeadas (não bloqueiam)

- [ ] **Avisar o vendedor no handoff** — hoje o encaminhamento só aparece no log
      do servidor; o ideal é mandar mensagem para o WhatsApp da equipe
- [ ] **Integração com o GestãoClick** — já está codificada; falta contratar a
      API, gerar os tokens e mapear os códigos dos produtos
- [ ] **Gravar o orçamento dentro do GestãoClick** (fase 2), marcado como
      "origem: automação"
- [ ] **Limpeza dos PDFs antigos** em `out/` (hoje acumulam sem prazo)

---

## Sobre os dados e a LGPD

O sistema guarda nome, telefone, cidade e endereço dos clientes — necessários
para a entrega. Cuidados já tomados:

- Painel e cadastro **protegidos por senha**
- PDFs com **link não-adivinhável** (token aleatório no nome do arquivo), então
  o cliente baixa o dele sem senha, mas ninguém descobre o dos outros
- Sem listagem de diretório e **sem consulta pública por telefone** — no site,
  os dados do cliente ficam no navegador dele, não numa API aberta

Vale a empresa definir por quanto tempo guardar orçamentos antigos.

---

## Como o cliente atualiza preços daqui pra frente

```
/painel/dados → baixa a planilha → corrige no Excel → envia → confere → aplica
```

Leva uns 3 minutos e não precisa de ninguém técnico. Se algo estiver errado,
o sistema aponta a linha exata e recusa aplicar — não tem como quebrar.
