/**
 * MÁQUINA DE ESTADOS DA CONVERSA — determinística, sem IA.
 *
 * Um orçamento pode ter VÁRIOS PRODUTOS. O cliente monta um produto por vez
 * (escolhe a telha → informa cortes OU o ambiente) e, ao terminar, decide se
 * adiciona outro. Só depois vêm estrutura, dados e confirmação.
 *
 * Dois caminhos por produto:
 *   A) CORTES   — cliente técnico informa a lista ("3 de 4m, 9 de 4,75")
 *   B) AMBIENTE — cliente informa as dimensões e o sistema calcula o romaneio
 *
 * Cálculo e PDF ficam sempre no código — a IA (quando ativa) só conversa.
 */
const state = require('./state');
const { getCatalogo } = require('./pricing');
const { calcularOrcamento } = require('./engine');
const { montarLista, aplicarLista, complementosSugeridos } = require('./lista');
const { calcularRomaneio, corteComTamanho } = require('./romaneio');
const { calcularFrete } = require('./frete');
const { gerarPDF } = require('./pdf');
const ai = require('./ai');
const conversa = require('./conversa');
const clientes = require('./clientes');
const R = require('./roteiro');
const path = require('path');

const MAX_ERROS = 3;

const num = (t) => {
  const n = parseFloat(String(t).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const menu = (titulo, opcoes) =>
  titulo + '\n\n' + opcoes.map((o, i) => `*${i + 1}* — ${o}`).join('\n') +
  '\n\n_Responda com o número ou escreva o nome._';

/** Escolha tolerante: número, nome escrito ou (se houver chave) interpretação por IA. */
async function escolhaInteligente(txt, lista, nomes, contexto) {
  const i = R.interpretarEscolha(txt, nomes);
  if (i >= 0) return lista[i];
  const n = await ai.escolherOpcao(txt, nomes, contexto);
  return n ? lista[n - 1] : null;
}
const BRL = (v) => Number(v).toFixed(2).replace('.', ',');
const metrosDe = (cortes) => cortes.reduce((s, c) => s + c.quantidade * c.comprimentoM, 0);

/**
 * LIMITE DE CORTE de uma telha. A largura é fixa de fábrica; o comprimento é
 * o cliente quem escolhe, e a única fronteira é o que a máquina corta.
 */
function limitesDeCorte(telha, catalogo) {
  const eng = catalogo.engenharia || {};
  return {
    min: Number(telha?.comprimento_minimo_m) || Number(eng.comprimento_minimo_fabricacao_m) || 0.5,
    max: Number(telha?.comprimento_maximo_m) || Number(eng.comprimento_maximo_fabricacao_m) || 12,
  };
}

async function processar(chatId, textoRaw) {
  const texto = String(textoRaw || '').trim();
  const catalogo = await getCatalogo();
  let ficha = state.carregar(chatId);
  const acoes = [];
  const say = (t) => acoes.push({ type: 'text', text: t });

  if (/^(menu|recome[cç]ar|cancelar)$/i.test(texto)) ficha = state.resetar(chatId);
  if (/^(atendente|vendedor|humano)$/i.test(texto)) {
    acoes.push({ type: 'handoff', motivo: 'Cliente pediu atendente' });
    say(R.T.handoffPedido);
    ficha.etapa = 'HUMANO';
    state.salvar(ficha);
    return acoes;
  }
  if (ficha.etapa === 'HUMANO') return acoes;

  // Modo conversacional (IA ativa) conduz até a ficha fechar.
  // Da CONFERÊNCIA em diante quem manda é o código: ali o cliente ajusta a
  // lista e autoriza a geração, e isso não pode depender de interpretação.
  const SEM_IA = ['CONFERE', 'CONFERE_QTD', 'CONFERE_TIRAR', 'CONFIRMA', 'FIM'];
  if (ai.ativa() && !SEM_IA.includes(ficha.etapa)) {
    const r = await conversa.coletar(ficha, texto, catalogo);
    if (r.humano) ficha.etapa = 'HUMANO';
    else if (r.confirmar) ficha.etapa = 'CONFERE';
    else ficha.etapa = 'COLETA_IA';
    state.salvar(ficha);
    return acoes.concat(r.acoes);
  }

  const P = ficha.pedido;
  const erro = (msg) => {
    ficha.tentativasErro++;
    if (ficha.tentativasErro >= MAX_ERROS) {
      acoes.push({ type: 'handoff', motivo: 'Cliente não conseguiu avançar no fluxo' });
      say(R.T.handoffErro);
      ficha.etapa = 'HUMANO';
    } else say(msg);
  };

  /** Acabamentos, parafusos e perfis que podem ser vendidos avulsos. */
  const itensAvulsos = () => [
    ...(catalogo.complementos || []).filter((c) => c.ativo !== false)
      .map((c) => ({ ...c, _avulso: 'complemento' })),
    ...(catalogo.perfis || []).filter((p) => p.ativo !== false)
      .map((p) => ({ ...p, _avulso: 'perfil' })),
  ];

  const perguntarItemAvulso = () => {
    const lista = itensAvulsos();
    if (!lista.length) {
      say('Não tenho acabamento nem estrutura cadastrados no momento 😕');
      perguntarFamilia();
      return;
    }
    say(menu('🔩 Qual item você precisa?', lista.map((x) =>
      `${x.nome} — R$ ${BRL(x.preco)} ${x.venda_por === 'metro' || x.unidade === 'M' ? 'por metro' : 'a peça'}`)));
    ficha.etapa = 'AVULSO_ITEM';
  };

  const perguntarFamilia = () => {
    const familias = [...new Set(catalogo.telhas.map((t) => t.familia))];
    // Telha é o carro-chefe, mas não é obrigatória: dá pra levar só
    // acabamento, parafuso ou estrutura.
    say(menu(R.T.perguntaFamilia(P.grupos.length > 0),
      familias.concat('Só acabamento, parafuso ou estrutura')));
    ficha.etapa = 'FAMILIA';
  };

  /** Reprocessa a MESMA mensagem já na etapa seguinte (atalhos do usuário). */
  const processarDireto = async () => {
    state.salvar(ficha);
    return processar(chatId, texto);
  };

  /**
   * CONFERÊNCIA — a lista completa (telhas, acabamentos, parafusos e
   * estrutura), sem preço, que o cliente pode ajustar antes de fechar.
   * Mesma lista e mesmas quantidades da tela do site.
   */
  const mostrarConferencia = () => {
    const r = montarLista(
      { grupos: P.grupos, complementos: P.complementos || [], perfis: P.perfis || [] },
      catalogo
    );
    P.linhas = r.linhas;
    say(R.T.conferencia(ficha.cliente.nome, r.linhas, r.metragemTotal.toFixed(3)));
    say(`📍 *Entrega:* ${ficha.cliente.endereco} — ${ficha.cliente.cidade}`);
    ficha.etapa = 'CONFERE';
  };

  /** Reexibe a lista depois de um ajuste, já com a metragem recalculada. */
  const mostrarListaConferida = () => {
    const met = (P.linhas || [])
      .filter((l) => l.tipo === 'telha')
      .reduce((s, l) => s + (Number(l.qtd) || 0) * (Number(l.comp) || 0), 0);
    say(R.T.conferencia(ficha.cliente.nome, P.linhas || [], met.toFixed(3)));
    ficha.etapa = 'CONFERE';
  };

  /**
   * Perfil já escolhido: calcula a estrutura. Se não sabemos o comprimento do
   * galpão (cliente veio pela lista de cortes), pergunta antes.
   */
  const seguirEstrutura = () => {
    const amb = P.grupos.find((g) => g.ambiente)?.ambiente;
    const L = Number(amb?.comprimentoGalpaoM) || Number(P.acabComprimentoM) || 0;
    if (L > 0) {
      calcularEstrutura(P, catalogo, L, say);
      pedirDados();
    } else {
      say('🔧 Pra calcular a estrutura, qual o *comprimento do galpão* em metros (o lado da cumeeira)?');
      ficha.etapa = 'ESTRUTURA_MEDIDA';
    }
    state.salvar(ficha);
    return acoes;
  };

  /** Cliente já cadastrado? Confirma os dados em vez de perguntar tudo de novo. */
  const pedirDados = () => {
    if (clientes.completo(ficha.cliente)) {
      say(R.T.confirmaDados(ficha.cliente));
      ficha.etapa = 'CONFIRMA_DADOS';
    } else {
      say(R.T.pedeNome);
      ficha.etapa = 'NOME';
    }
  };

  /** Fecha o produto atual e pergunta se quer adicionar outro. */
  const fecharProduto = (cortes, ambiente) => {
    const t = catalogo.telhas.find((x) => x.id === P.atual.telhaId);
    P.grupos.push({ telhaId: t.id, nome: t.nome, cortes, ambiente: ambiente || null });
    P.atual = { familia: null, telhaId: null, cortes: null, comprimentoGalpaoM: null, larguraGalpaoM: null, quedas: null };
    const met = P.grupos.reduce((s, g) => s + metrosDe(g.cortes), 0);
    say(`✅ *${t.nome}* adicionado!`);
    say(R.T.pedeMaisTelhas(P.grupos.length, met.toFixed(3)));
    ficha.etapa = 'MAIS_TELHAS';
  };

  switch (ficha.etapa) {
    case 'INICIO': {
      say(ficha.clienteConhecido
        ? R.T.saudacaoRecorrente(ficha.cliente.nome)
        : R.T.saudacao(catalogo.empresa.razao_social));
      perguntarFamilia();
      break;
    }

    case 'FAMILIA': {
      const familias = [...new Set(catalogo.telhas.map((t) => t.familia))];
      const opcoes = familias.concat('Só acabamento, parafuso ou estrutura');
      const idx = R.interpretarEscolha(texto, opcoes);
      if (idx < 0) { erro(R.T.erroOpcao); break; }

      // última opção: pedido sem telha
      if (idx === familias.length) {
        ficha.tentativasErro = 0;
        perguntarItemAvulso();
        break;
      }
      const fam = familias[idx];
      P.atual.familia = fam;
      ficha.tentativasErro = 0;
      const grupo = catalogo.telhas.filter((t) => t.familia === fam);
      // linha com um modelo só: já avança, sem pergunta desnecessária
      if (grupo.length === 1) {
        P.atual.telhaId = grupo[0].id;
        say(R.T.perguntaModo(grupo[0].nome, BRL(grupo[0].preco), grupo[0].largura_util_m));
        ficha.etapa = 'MODO';
        break;
      }
      say(menu(R.T.perguntaModelo(fam), grupo.map((t) => `${t.nome} — R$ ${BRL(t.preco)}/m`)));
      ficha.etapa = 'TELHA';
      break;
    }

    case 'TELHA': {
      const lista = P.atual.familia
        ? catalogo.telhas.filter((t) => t.familia === P.atual.familia)
        : catalogo.telhas;
      const t = await escolhaInteligente(texto, lista, lista.map((x) => x.nome), 'modelo de telha');
      if (!t) { erro(R.T.erroOpcao); break; }
      P.atual.telhaId = t.id;
      ficha.tentativasErro = 0;
      say(R.T.perguntaModo(t.nome, BRL(t.preco), t.largura_util_m));
      ficha.etapa = 'MODO';
      break;
    }

    case 'MODO': {
      // atalho: se a pessoa já mandou as medidas ou a lista, pula a pergunta
      const dimJa = R.interpretarDimensoes(texto);
      const cortesJa = R.interpretarCortes(texto);
      const sabe = R.interpretarSimNao(texto);

      const telhaAtual = catalogo.telhas.find((t) => t.id === P.atual.telhaId);

      if (dimJa) { ficha.etapa = 'AMBIENTE'; return processarDireto(); }
      if (sabe === true || texto === '1') {
        say(R.T.pedeCortes(limitesDeCorte(telhaAtual, catalogo)));
        ficha.etapa = 'CORTES';
        break;
      }
      if (sabe === false || texto === '2') { say(R.T.pedeAmbiente); ficha.etapa = 'AMBIENTE'; break; }
      if (cortesJa.length) { ficha.etapa = 'CORTES'; return processarDireto(); }
      erro('Responda *1* (já sei os tamanhos) ou *2* (informo o local).');
      break;
    }

    // ── CAMINHO A: lista de cortes ────────────────────────────────────
    case 'CORTES': {
      const telha = catalogo.telhas.find((t) => t.id === P.atual.telhaId);

      // atalho: desistiu da lista e prefere que o sistema calcule
      if (/^(calcular|calcula|medidas?|n[ãa]o sei)$/i.test(texto)) {
        ficha.tentativasErro = 0;
        say(R.T.pedeAmbiente);
        ficha.etapa = 'AMBIENTE';
        break;
      }

      const cortes = R.interpretarCortes(texto);
      if (!cortes.length) { erro(R.T.erroCortes); break; }

      // A LARGURA é fixa de fábrica; o COMPRIMENTO é livre. O único limite é
      // o que a máquina corta — acima do máximo a peça precisa de emenda, e
      // isso é conta do romaneio, não do cliente.
      const lim = limitesDeCorte(telha, catalogo);
      const curtos = cortes.filter((c) => c.comprimentoM < lim.min);
      const longos = cortes.filter((c) => c.comprimentoM > lim.max);
      if (curtos.length || longos.length) {
        erro(R.T.erroForaDoLimite(telha.nome, lim, curtos, longos));
        break;
      }

      ficha.tentativasErro = 0;
      const resumo = cortes.map((c) => `• ${c.quantidade} peças de ${c.comprimentoM}m`).join('\n');
      say(`Anotei ✅\n\n${resumo}\n\n*${metrosDe(cortes).toFixed(3)} mts*`);
      fecharProduto(cortes);
      break;
    }

    // ── CAMINHO B: ambiente → romaneio calculado ──────────────────────
    case 'AMBIENTE': {
      const dims = R.interpretarDimensoes(texto);
      if (!dims) { erro(R.T.erroDimensoes); break; }
      P.atual.comprimentoGalpaoM = dims.comprimentoM;
      P.atual.larguraGalpaoM = dims.larguraM;
      ficha.tentativasErro = 0;
      say(`Anotei: *${dims.comprimentoM} x ${dims.larguraM}m* ✅`);

      // se já disse as águas na mesma mensagem ("20x10 duas águas"), não repergunta
      const qJunto = R.interpretarQuedas(texto.replace(/\d+(?:[.,]\d+)?\s*(?:x|×|por)\s*\d+(?:[.,]\d+)?/i, ''));
      if (qJunto) { ficha.etapa = 'QUEDAS'; state.salvar(ficha); return acoes.concat(await processar(chatId, String(qJunto))); }

      say(R.T.pedeQuedas);
      ficha.etapa = 'QUEDAS';
      break;
    }

    case 'QUEDAS': {
      const q = R.interpretarQuedas(texto);
      if (!q) { erro('Responda *1* (uma queda) ou *2* (duas quedas).'); break; }
      P.atual.quedas = q;
      ficha.tentativasErro = 0;

      const telha = catalogo.telhas.find((t) => t.id === P.atual.telhaId);
      try {
        const rom = calcularRomaneio({
          comprimentoGalpaoM: P.atual.comprimentoGalpaoM,
          larguraGalpaoM: P.atual.larguraGalpaoM,
          quedas: q, comEstrutura: false,
        }, telha, catalogo);

        // água maior que o comprimento de fábrica → cliente escolhe a emenda
        if (rom.precisaEscolher) {
          P.opcoesCorte = rom.opcoes;
          P.atual.compTelha = rom.compTelha; // guarda pro cálculo personalizado
          say(
            `📐 Sua água ficou com *${rom.compTelha}m*, e esta telha vai até *${telha.comprimento_maximo_m}m* de fábrica.\n` +
            `Sem problema — dá pra emendar com transpasse. Como você prefere?\n\n` +
            rom.opcoes.map((o, i) =>
              `*${i + 1}* — ${o.titulo}\n     _${o.detalhe}_`).join('\n') +
            `\n\n💡 _Ou me diga o tamanho que você quer nas peças — ex: *10m* — que eu completo o restante._`
          );
          ficha.etapa = 'OPCAO_CORTE';
          break;
        }

        const resumo = rom.cortes.map((c) => `• ${c.quantidade} peças de ${c.comprimentoM}m`).join('\n');
        say(`📐 *Calculei:*\n\n${resumo}`);
        if (rom.avisos.length) say('⚠️ ' + rom.avisos.join('\n⚠️ '));
        if (rom.escalarParaVendedor) acoes.push({ type: 'handoff', motivo: 'Caso fora do padrão no cálculo' });
        P.memoriaCalculo = (P.memoriaCalculo || []).concat(rom.memoria);
        fecharProduto(rom.cortes, {
          comprimentoGalpaoM: P.atual.comprimentoGalpaoM,
          larguraGalpaoM: P.atual.larguraGalpaoM, quedas: q,
        });
      } catch (err) {
        say('Não consegui calcular com essas medidas 😕 Vou te passar pra um vendedor.');
        acoes.push({ type: 'handoff', motivo: 'Erro no cálculo: ' + err.message });
        ficha.etapa = 'HUMANO';
      }
      break;
    }

    case 'OPCAO_CORTE': {
      const opcoes = P.opcoesCorte || [];
      const telha = catalogo.telhas.find((t) => t.id === P.atual.telhaId);
      const i = parseInt(texto, 10);
      // "10m" ou número maior que a quantidade de opções = tamanho preferido
      const pareceTamanho = /\d\s*(m|mts|metros)\b/i.test(texto) || (Number.isFinite(i) && i > opcoes.length);
      let op = null, tamanhoPreferidoM;

      if (pareceTamanho) {
        const v = num(texto);
        const custom = corteComTamanho(P.atual.compTelha, v, telha, catalogo);
        if (!custom || custom.erro) { erro(custom?.erro || 'Não consegui usar esse tamanho. Tente outro.'); break; }
        op = custom;
        tamanhoPreferidoM = v;
      } else {
        op = i >= 1 && i <= opcoes.length ? opcoes[i - 1] : null;
        if (!op) { erro('Responda com o *número* da opção — ou diga o tamanho que quer, ex: *10m*.'); break; }
      }

      ficha.tentativasErro = 0;
      const rom = calcularRomaneio({
        comprimentoGalpaoM: P.atual.comprimentoGalpaoM,
        larguraGalpaoM: P.atual.larguraGalpaoM,
        quedas: P.atual.quedas, comEstrutura: false,
        opcaoCorte: op.id, tamanhoPreferidoM,
      }, telha, catalogo);
      const resumo = rom.cortes.map((c) => `• ${c.quantidade} peças de ${c.comprimentoM}m`).join('\n');
      say(`✅ *${op.titulo}*\n\n${resumo}`);
      P.memoriaCalculo = (P.memoriaCalculo || []).concat(rom.memoria);
      P.opcoesCorte = null;
      fecharProduto(rom.cortes, {
        comprimentoGalpaoM: P.atual.comprimentoGalpaoM,
        larguraGalpaoM: P.atual.larguraGalpaoM,
        quedas: P.atual.quedas, opcaoCorte: op.id, tamanhoPreferidoM,
      });
      break;
    }

    // ── Pedido sem telha: item avulso com quantidade ──────────────────
    case 'AVULSO_ITEM': {
      const lista = itensAvulsos();
      const item = await escolhaInteligente(texto, lista, lista.map((x) => x.nome), 'acabamento ou perfil');
      if (!item) { erro(R.T.erroOpcao); break; }
      ficha.tentativasErro = 0;
      P.avulsoId = item.id;
      const porMetro = item.venda_por === 'metro' || item.unidade === 'M';
      say(`✅ *${item.nome}*\n\nQuantos ${porMetro ? '*metros*' : item.venda_por === 'barra' ? '*barras*' : '*peças*'} você precisa?`);
      ficha.etapa = 'AVULSO_QTD';
      break;
    }

    case 'AVULSO_QTD': {
      const q = num(texto);
      if (!q || q <= 0) { erro('Me diga só o número, ex: *12*.'); break; }
      ficha.tentativasErro = 0;

      const item = itensAvulsos().find((x) => x.id === P.avulsoId);
      if (!item) { erro(R.T.erroOpcao); break; }

      if (item._avulso === 'perfil') {
        P.perfis = (P.perfis || []).filter((p) => p.perfilId !== item.id);
        P.perfis.push(item.unidade === 'UN'
          ? { perfilId: item.id, quantidade: Math.ceil(q) }
          : { perfilId: item.id, metros: q });
      } else {
        P.complementos = (P.complementos || []).filter((c) => c.produtoId !== item.id);
        P.complementos.push({ produtoId: item.id,
          quantidade: item.venda_por === 'metro' ? q : Math.ceil(q) });
      }
      // já escolheu item a item: não perguntamos acabamento/estrutura depois
      P.comAcabamento = false;
      P.comEstrutura = (P.perfis || []).length > 0;
      P.avulsoId = null;

      say(`Anotei ✅ *${item.nome}* — ${String(q).replace('.', ',')}`);
      say('Falta mais alguma coisa?\n\n*1* — Sim, adicionar outro item\n*2* — Não, seguir');
      ficha.etapa = 'AVULSO_MAIS';
      break;
    }

    case 'AVULSO_MAIS': {
      const mais = R.interpretarSimNao(texto);
      if (mais === null) { erro('Responda *1* pra adicionar outro item ou *2* pra seguir.'); break; }
      ficha.tentativasErro = 0;
      if (mais) { perguntarItemAvulso(); break; }
      pedirDados();
      break;
    }

    // ── Vários produtos no mesmo orçamento ────────────────────────────
    case 'MAIS_TELHAS': {
      const mais = R.interpretarSimNao(texto);
      if (mais === true) { ficha.tentativasErro = 0; perguntarFamilia(); break; }
      if (mais === false) {
        ficha.tentativasErro = 0;
        say(R.T.pedeAcabamento);
        ficha.etapa = 'ACABAMENTO';
        break;
      }
      erro('Responda *1* pra adicionar outra telha ou *2* pra seguir.');
      break;
    }

    // ── Acabamentos e parafusos ───────────────────────────────────────
    // Cumeeira, frontal e lateral saem do PERÍMETRO do telhado; a
    // parafusagem sai do consumo por m². Quando o cliente veio pela lista
    // de cortes, não sabemos as medidas do telhado — aí perguntamos.
    case 'ACABAMENTO': {
      const quer = R.interpretarSimNao(texto);
      if (quer === null) { erro('Responda *1* (com acabamentos) ou *2* (só as telhas).'); break; }
      ficha.tentativasErro = 0;
      P.comAcabamento = quer;

      if (!quer) { P.complementos = []; say(R.T.pedeEstrutura); ficha.etapa = 'ESTRUTURA'; break; }

      const amb = P.grupos.find((g) => g.ambiente)?.ambiente;
      if (amb) {
        aplicarComplementos(P, catalogo, amb.comprimentoGalpaoM, amb.quedas, say);
        say(R.T.pedeEstrutura);
        ficha.etapa = 'ESTRUTURA';
        break;
      }
      say(R.T.pedeComprimentoAcabamento);
      ficha.etapa = 'ACABAMENTO_MEDIDA';
      break;
    }

    case 'ACABAMENTO_MEDIDA': {
      const L = num(texto);
      if (!L || L <= 0) { erro('Informe o comprimento em metros, ex: *20*.'); break; }
      ficha.tentativasErro = 0;
      P.acabComprimentoM = L;
      say(R.T.pedeQuedasAcabamento);
      ficha.etapa = 'ACABAMENTO_QUEDAS';
      break;
    }

    case 'ACABAMENTO_QUEDAS': {
      const q = R.interpretarQuedas(texto);
      if (!q) { erro('Responda *1* (uma queda) ou *2* (duas quedas).'); break; }
      ficha.tentativasErro = 0;
      aplicarComplementos(P, catalogo, P.acabComprimentoM, q, say);
      say(R.T.pedeEstrutura);
      ficha.etapa = 'ESTRUTURA';
      break;
    }

    case 'ESTRUTURA': {
      // aqui "1" = só telhas (não) e "2" = com estrutura (sim)
      const e = R.interpretarSimNao(texto, { umEhSim: false });
      if (e === null) { erro('Responda *1* (só telhas) ou *2* (telhas + estrutura).'); break; }
      P.comEstrutura = e;
      ficha.tentativasErro = 0;

      if (!e) { pedirDados(); break; }

      // mais de uma terça cadastrada? quem escolhe é o cliente
      const tercas = (catalogo.perfis || []).filter((p) => p.ativo !== false && p.tipo === 'terca');
      if (tercas.length > 1) {
        say(menu('🔧 Qual perfil de estrutura?', tercas.map((p) =>
          `${p.nome} — R$ ${BRL(p.preco)}/m (vence até ${String(p.vao_maximo_m).replace('.', ',')}m)`)));
        ficha.etapa = 'ESTRUTURA_PERFIL';
        break;
      }
      P.perfilEscolhido = tercas[0]?.id || null;
      return seguirEstrutura();
    }

    case 'ESTRUTURA_PERFIL': {
      const tercas = (catalogo.perfis || []).filter((p) => p.ativo !== false && p.tipo === 'terca');
      const p = await escolhaInteligente(texto, tercas, tercas.map((x) => x.nome), 'perfil de estrutura');
      if (!p) { erro(R.T.erroOpcao); break; }
      ficha.tentativasErro = 0;
      P.perfilEscolhido = p.id;
      return seguirEstrutura();
    }

    case 'ESTRUTURA_MEDIDA': {
      const L = num(texto);
      if (!L || L <= 0) { erro('Informe o comprimento em metros, ex: *20*.'); break; }
      ficha.tentativasErro = 0;
      calcularEstrutura(P, catalogo, L, say);
      pedirDados();
      break;
    }

    // ── Dados do cliente ──────────────────────────────────────────────
    case 'CONFIRMA_DADOS': {
      const ok = R.interpretarSimNao(texto);
      if (ok === false) {
        ficha.tentativasErro = 0;
        say('Sem problema! Qual o *nome* para este orçamento?');
        ficha.etapa = 'NOME';
        break;
      }
      if (ok !== true) { erro('Responda *1* pra confirmar ou *2* pra usar outro endereço.'); break; }
      ficha.tentativasErro = 0;
      mostrarConferencia();
      break;
    }

    case 'NOME': {
      if (texto.length < 2) { erro('Pode me dizer seu nome?'); break; }
      ficha.cliente.nome = texto;
      ficha.tentativasErro = 0;
      say(R.T.pedeDocumento);
      ficha.etapa = 'DOCUMENTO';
      break;
    }

    // CPF/CNPJ vai no orçamento e na nota — conferido pelo dígito
    case 'DOCUMENTO': {
      if (!R.documentoValido(texto)) { erro(R.T.erroDocumento); break; }
      ficha.cliente.documento = texto.replace(/\D/g, '');
      ficha.tentativasErro = 0;
      say(R.T.pedeCep);
      ficha.etapa = 'CEP';
      break;
    }

    // CEP → cidade. É o CEP que mede a distância até a unidade mais próxima
    // (e a regra dos 600 km da fábrica depende disso).
    case 'CEP': {
      const digitos = texto.replace(/\D/g, '');
      if (digitos.length !== 8) {
        erro('O CEP tem 8 números, ex: *15130-000*. É por ele que eu sei de qual unidade sai o material.');
        break;
      }
      ficha.tentativasErro = 0;
      ficha.cliente.cep = digitos;

      const { cidadeDoCep } = require('./distancia');
      const info = await cidadeDoCep(digitos).catch(() => null);
      if (info) {
        ficha.cliente.cidade = info.cidade;
        ficha.cliente.estado = info.uf;
        say(`📍 *${info.cidade} - ${info.uf}* ✅`);
        say(R.T.pedeEndereco);
        ficha.etapa = 'ENDERECO';
      } else {
        say('Não achei esse CEP na base 🤔');
        say(R.T.pedeCidade);
        ficha.etapa = 'CIDADE';
      }
      break;
    }

    case 'CIDADE': {
      if (texto.length < 2) { erro('Qual a cidade de entrega?'); break; }
      const { cidade, uf } = R.interpretarCidade(texto);
      ficha.cliente.cidade = cidade;
      if (uf) ficha.cliente.estado = uf;
      ficha.tentativasErro = 0;
      say(R.T.pedeEndereco);
      ficha.etapa = 'ENDERECO';
      break;
    }

    case 'ENDERECO': {
      if (!R.enderecoValido(texto)) { erro(R.T.erroEndereco); break; }
      ficha.cliente.endereco = texto;
      ficha.tentativasErro = 0;
      mostrarConferencia();
      break;
    }

    // ── Conferência da lista, antes de gerar ──────────────────────────
    case 'CONFERE': {
      if (/^1$/.test(texto) || R.interpretarSimNao(texto) === true) {
        ficha.tentativasErro = 0;
        ficha.etapa = 'CONFIRMA';
        return processarDireto();
      }
      if (/^2$/.test(texto)) {
        ficha.tentativasErro = 0;
        say(R.T.pedeItemQuantidade);
        ficha.etapa = 'CONFERE_QTD';
        break;
      }
      if (/^3$/.test(texto)) {
        ficha.tentativasErro = 0;
        say(R.T.pedeItemTirar);
        ficha.etapa = 'CONFERE_TIRAR';
        break;
      }
      if (/^4$/.test(texto) || R.interpretarSimNao(texto) === false) {
        ficha = state.resetar(chatId);
        say('Sem problemas! Digite qualquer coisa pra recomeçar 🙂');
        break;
      }
      erro('Responda *1* pra gerar, *2* pra mudar quantidade, *3* pra tirar item ou *4* pra recomeçar.');
      break;
    }

    case 'CONFERE_QTD': {
      const aj = R.interpretarAjuste(texto);
      const linhas = P.linhas || [];
      if (!aj || aj.item < 1 || aj.item > linhas.length) { erro(R.T.erroItem); break; }
      ficha.tentativasErro = 0;
      const l = linhas[aj.item - 1];

      if (aj.valor <= 0) {           // "3 = 0" é a mesma coisa que tirar
        if (linhas.length === 1) { erro(R.T.erroListaVazia); break; }
        linhas.splice(aj.item - 1, 1);
        say(`🗑️ *${l.nome}* fora da lista.`);
      } else {
        l.qtd = l.tipo === 'telha' ? Math.floor(aj.valor) : aj.valor;
        say(`✅ *${l.nome}*: ${String(l.qtd).replace('.', ',')} ${l.rotulo}.`);
      }
      P.linhas = linhas;
      mostrarListaConferida();
      break;
    }

    case 'CONFERE_TIRAR': {
      const i = parseInt(texto, 10);
      const linhas = P.linhas || [];
      if (!(i >= 1 && i <= linhas.length)) { erro(R.T.erroItem); break; }
      const l = linhas[i - 1];
      if (linhas.length === 1) { erro(R.T.erroListaVazia); break; }
      ficha.tentativasErro = 0;
      linhas.splice(i - 1, 1);
      P.linhas = linhas;
      say(`🗑️ *${l.nome}* fora da lista.`);
      mostrarListaConferida();
      break;
    }

    case 'CONFIRMA': {
      const ok = R.interpretarSimNao(texto);
      if (ok === false) { ficha = state.resetar(chatId); say('Sem problemas! Digite qualquer coisa pra recomeçar 🙂'); break; }
      if (ok !== true) { erro('Responda *1* pra gerar ou *2* pra recomeçar.'); break; }

      if (!ficha.cliente.endereco || !ficha.cliente.cidade) {
        say('📍 Antes de gerar, preciso do *endereço da obra*. Pode me passar?');
        ficha.etapa = 'ENDERECO';
        break;
      }

      // ==== MATEMÁTICA PURA — nada de IA ====
      // Vale a LISTA CONFERIDA pelo cliente, não a composição original.
      // Se ele não mexeu em nada, o resultado é idêntico.
      const conferido = P.linhas
        ? aplicarLista(P.linhas, catalogo, P.grupos.find((g) => g.ambiente)?.ambiente || null)
        : { grupos: P.grupos, complementos: P.complementos || [], perfis: P.perfis || [] };
      P.grupos = conferido.grupos;
      P.complementos = conferido.complementos;
      P.perfis = conferido.perfis;

      if (!P.grupos.length && !P.complementos.length && !P.perfis.length) {
        say('Sua lista ficou vazia 😕 Digite *menu* pra recomeçar.');
        ficha.etapa = 'FIM';
        break;
      }

      // frete cobrado À PARTE: calculado sobre a prévia e somado em linha própria
      const previa = calcularOrcamento(
        { grupos: P.grupos, perfis: P.perfis || [], complementos: P.complementos || [] }, catalogo);
      const frete = await calcularFrete(
        { cep: ficha.cliente.cep, cidade: ficha.cliente.cidade, uf: ficha.cliente.estado },
        {
          metragemTotal: previa.metragemTotal,
          totalProdutos: previa.totalProdutos,
          codigos: P.grupos.map((g) => catalogo.telhas.find((t) => t.id === g.telhaId)?.codigo).filter(Boolean),
        },
        catalogo
      );
      const orcamento = calcularOrcamento(
        { grupos: P.grupos, perfis: P.perfis || [], complementos: P.complementos || [], frete },
        catalogo
      );
      // Obra distante ou pedido grande: gera e guarda, mas NÃO mostra o valor
      const limiteM2 = catalogo.regras?.metragem_maxima_autoatendimento_m || Infinity;
      const encaminhar = frete.foraDoRaio || orcamento.metragemTotal > limiteM2;

      const numero = (encaminhar ? 'PROP-' : 'WA-') + Date.now().toString(36).toUpperCase();
      // token aleatório no nome: o link do PDF não pode ser adivinhado
      const token = require('crypto').randomBytes(8).toString('hex');
      const pdfPath = path.join(__dirname, 'out', `orcamento-${numero}-${token}.pdf`);
      await gerarPDF({
        cliente: ficha.cliente,
        pedido: { numero, vendedor: catalogo.empresa.vendedor_padrao },
        orcamento, catalogo,
      }, pdfPath);

      // grava o cadastro — no próximo orçamento não perguntamos de novo
      clientes.salvar(ficha.cliente);

      // registra no histórico para o painel da empresa (com o motivo, se encaminhado)
      require('./orcamentos').salvar({
        numero, canal: 'whatsapp', origem: 'cliente',
        cliente: ficha.cliente,
        orcamento: {
          ...orcamento,
          escalarParaVendedor: orcamento.escalarParaVendedor || encaminhar,
          avisos: encaminhar
            ? [...orcamento.avisos, frete.foraDoRaio
                ? `ENCAMINHADO AO COMERCIAL: obra a ${frete.km} km da fábrica. Valor não exibido ao cliente.`
                : `ENCAMINHADO AO COMERCIAL: ${orcamento.metragemTotal} m² acima do limite de ${limiteM2} m². Valor não exibido ao cliente.`]
            : orcamento.avisos,
        },
        grupos: P.grupos, pdfPath,
      });

      if (encaminhar) {
        // valor NÃO vai para o cliente — só o protocolo e o convite ao comercial
        const motivo = frete.foraDoRaio
          ? `obra a ${frete.km} km da fábrica`
          : `${orcamento.metragemTotal} m² acima do limite de ${limiteM2}`;
        say(
          (frete.foraDoRaio
            ? `📬 *Pedido registrado!*\n\n${frete.mensagemCliente || 'Sua obra está fora da nossa área de entrega automática.'}`
            : `🎯 *Seu pedido rende condição especial!*\n\nComo o volume é grande, nosso comercial monta a melhor proposta pra você.`) +
          `\n\n*Protocolo:* ${numero}\n*Seu pedido:* ${orcamento.totalPecas} peças · ${orcamento.metragemTotal} mts\n\n` +
          `Já guardamos tudo — um vendedor vai te chamar por aqui em instantes 👍`
        );
        acoes.push({ type: 'handoff', motivo: `Encaminhado ao comercial: ${motivo}` });
        ficha.etapa = 'HUMANO';
        break;
      }

      const linhaFrete = !Number.isFinite(orcamento.totalFrete) || orcamento.frete?.valor === null
        ? ' (frete a confirmar)'
        : orcamento.totalFrete > 0 ? ` + frete R$ ${BRL(orcamento.totalFrete)}` : ' · *frete grátis*';
      acoes.push({
        type: 'pdf', filePath: pdfPath,
        caption: `📄 Orçamento ${numero} — ${orcamento.totalPecas} peças · ${orcamento.metragemTotal} mts\n` +
          `Produtos R$ ${BRL(orcamento.totalProdutos)}${linhaFrete}\n*Total: R$ ${BRL(orcamento.totalAvista)}* à vista`,
      });
      say(R.T.fechamento(catalogo.validade_orcamento_dias));
      if (orcamento.escalarParaVendedor) {
        acoes.push({ type: 'handoff', motivo: 'Orçamento fora dos limites de autoatendimento' });
      }
      ficha.etapa = 'FIM';
      break;
    }

    case 'FIM':
    default:
      say('Digite *menu* pra um novo orçamento ou *atendente* pra falar com uma pessoa 🙂');
      break;
  }

  state.salvar(ficha);
  return acoes;
}

/**
 * ACABAMENTOS E PARAFUSOS pelo perímetro do telhado e pelo consumo por m².
 * Mesma regra do site (lista.js) — aqui só narra o que entrou.
 */
function aplicarComplementos(P, catalogo, comprimentoGalpaoM, quedas, say) {
  const maiorCorte = P.grupos.reduce(
    (m, g) => Math.max(m, ...g.cortes.map((c) => Number(c.comprimentoM) || 0)), 0);

  P.complementos = complementosSugeridos(comprimentoGalpaoM, maiorCorte, quedas, catalogo);

  if (!P.complementos.length) {
    say('⚠️ Nenhum acabamento cadastrado no catálogo — seguindo só com as telhas.');
    return;
  }
  const nomes = P.complementos
    .map((c) => (catalogo.complementos || []).find((x) => x.id === c.produtoId)?.nome)
    .filter(Boolean);
  say(`✅ Acabamentos incluídos: ${nomes.join(', ')}.\n\n_As quantidades aparecem na conferência, antes de gerar._`);
  P.memoriaCalculo = (P.memoriaCalculo || []).concat(
    `Acabamentos: perímetro de ${comprimentoGalpaoM}m, maior corte ${maiorCorte}m, ${quedas} água(s)`
  );
}

/** Terças pelo maior corte do orçamento e pelo vão máximo da telha mais restritiva. */
function calcularEstrutura(P, catalogo, comprimentoGalpaoM, say) {
  const ativos = (catalogo.perfis || []).filter((p) => p.ativo !== false);
  const perfil = (P.perfilEscolhido && ativos.find((p) => p.id === P.perfilEscolhido))
    || ativos.find((p) => p.tipo === 'terca');
  if (!perfil) { say('⚠️ Perfil de terça não cadastrado — estrutura não incluída.'); return; }

  let maiorCorte = 0, vaoMax = Infinity;
  for (const g of P.grupos) {
    const t = catalogo.telhas.find((x) => x.id === g.telhaId);
    maiorCorte = Math.max(maiorCorte, ...g.cortes.map((c) => c.comprimentoM));
    vaoMax = Math.min(vaoMax, t.vao_maximo_m || catalogo.engenharia.vao_maximo_terca_padrao_m);
  }
  const tercas = Math.ceil(maiorCorte / vaoMax) + 1;
  const metros = Math.round(tercas * comprimentoGalpaoM * 100) / 100;
  P.perfis = [{ perfilId: perfil.id, metros }];
  P.memoriaCalculo = (P.memoriaCalculo || []).concat(
    `Estrutura: maior corte ${maiorCorte}m ÷ vão máx ${vaoMax}m + 1 = ${tercas} terças x ${comprimentoGalpaoM}m = ${metros}m`
  );
  say(`✅ Estrutura: ${tercas} terças de ${comprimentoGalpaoM}m → *${metros}m* de ${perfil.nome}.`);
}

module.exports = { processar };
