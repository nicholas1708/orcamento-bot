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
const { calcularRomaneio, corteComTamanho } = require('./romaneio');
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

/** Resumo de todos os produtos já adicionados ao orçamento. */
function resumoGrupos(grupos) {
  return grupos.map((g, i) =>
    `*${i + 1}. ${g.nome}*\n` +
    g.cortes.map((c) => `   • ${c.quantidade} x ${c.comprimentoM}m`).join('\n') +
    `\n   _${metrosDe(g.cortes).toFixed(3)} mts_`
  ).join('\n\n');
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

  // Modo conversacional (IA ativa) conduz até a ficha fechar
  if (ai.ativa() && !['CONFIRMA', 'FIM'].includes(ficha.etapa)) {
    const r = await conversa.coletar(ficha, texto, catalogo);
    if (r.humano) ficha.etapa = 'HUMANO';
    else if (r.confirmar) ficha.etapa = 'CONFIRMA';
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

  const perguntarFamilia = () => {
    const familias = [...new Set(catalogo.telhas.map((t) => t.familia))];
    say(menu(R.T.perguntaFamilia(P.grupos.length > 0), familias));
    ficha.etapa = 'FAMILIA';
  };

  /** Reprocessa a MESMA mensagem já na etapa seguinte (atalhos do usuário). */
  const processarDireto = async () => {
    state.salvar(ficha);
    return processar(chatId, texto);
  };

  /** Resumo final antes de gerar o PDF. */
  const mostrarResumoFinal = () => {
    const met = P.grupos.reduce((s, g) => s + metrosDe(g.cortes), 0);
    say(
      `✅ *Confere pra mim, ${ficha.cliente.nome}?*\n\n` +
      resumoGrupos(P.grupos) +
      `\n\n*Metragem total:* ${met.toFixed(3)} mts` +
      `\n*Estrutura:* ${P.comEstrutura ? 'sim' : 'não'}` +
      `\n*Entrega:* ${ficha.cliente.endereco} — ${ficha.cliente.cidade}\n\n` +
      `*1* — Sim, gerar orçamento 📄\n*2* — Não, recomeçar`
    );
    ficha.etapa = 'CONFIRMA';
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
      const idx = R.interpretarEscolha(texto, familias);
      if (idx < 0) { erro(R.T.erroOpcao); break; }
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

      if (dimJa) { ficha.etapa = 'AMBIENTE'; return processarDireto(); }
      if (sabe === true || texto === '1') { say(R.T.pedeCortes); ficha.etapa = 'CORTES'; break; }
      if (sabe === false || texto === '2') { say(R.T.pedeAmbiente); ficha.etapa = 'AMBIENTE'; break; }
      if (cortesJa.length) { ficha.etapa = 'CORTES'; return processarDireto(); }
      erro('Responda *1* (já sei os tamanhos) ou *2* (informo o local).');
      break;
    }

    // ── CAMINHO A: lista de cortes ────────────────────────────────────
    case 'CORTES': {
      const cortes = R.interpretarCortes(texto);
      if (!cortes.length) { erro(R.T.erroCortes); break; }
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

    // ── Vários produtos no mesmo orçamento ────────────────────────────
    case 'MAIS_TELHAS': {
      const mais = R.interpretarSimNao(texto);
      if (mais === true) { ficha.tentativasErro = 0; perguntarFamilia(); break; }
      if (mais === false) {
        ficha.tentativasErro = 0;
        say(R.T.pedeEstrutura);
        ficha.etapa = 'ESTRUTURA';
        break;
      }
      erro('Responda *1* pra adicionar outra telha ou *2* pra seguir.');
      break;
    }

    case 'ESTRUTURA': {
      // aqui "1" = só telhas (não) e "2" = com estrutura (sim)
      const e = R.interpretarSimNao(texto, { umEhSim: false });
      if (e === null) { erro('Responda *1* (só telhas) ou *2* (telhas + estrutura).'); break; }
      P.comEstrutura = e;
      ficha.tentativasErro = 0;

      if (e) {
        // usa o ambiente já informado, se houver; senão pergunta o comprimento
        const comAmbiente = P.grupos.find((g) => g.ambiente);
        if (comAmbiente) {
          calcularEstrutura(P, catalogo, comAmbiente.ambiente.comprimentoGalpaoM, say);
        } else {
          say('🔧 Pra calcular a estrutura, qual o *comprimento do galpão* em metros (o lado da cumeeira)?');
          ficha.etapa = 'ESTRUTURA_MEDIDA';
          break;
        }
      }
      pedirDados();
      break;
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
      mostrarResumoFinal();
      break;
    }

    case 'NOME': {
      if (texto.length < 2) { erro('Pode me dizer seu nome?'); break; }
      ficha.cliente.nome = texto;
      ficha.tentativasErro = 0;
      say(R.T.pedeCidade);
      ficha.etapa = 'CIDADE';
      break;
    }

    case 'CIDADE': {
      if (texto.length < 2) { erro('Qual a cidade de entrega?'); break; }
      ficha.cliente.cidade = texto;
      ficha.tentativasErro = 0;
      say(R.T.pedeEndereco);
      ficha.etapa = 'ENDERECO';
      break;
    }

    case 'ENDERECO': {
      if (texto.length < 8 || !/\d/.test(texto)) { erro(R.T.erroEndereco); break; }
      ficha.cliente.endereco = texto;
      ficha.tentativasErro = 0;
      mostrarResumoFinal();
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
      const orcamento = calcularOrcamento(
        { grupos: P.grupos, perfis: P.perfis || [] },
        catalogo
      );
      const numero = 'WA-' + Date.now().toString(36).toUpperCase();
      const pdfPath = path.join(__dirname, 'out', `orcamento-${numero}.pdf`);
      await gerarPDF({
        cliente: ficha.cliente,
        pedido: { numero, vendedor: catalogo.empresa.vendedor_padrao },
        orcamento, catalogo,
      }, pdfPath);

      // grava o cadastro — no próximo orçamento não perguntamos de novo
      clientes.salvar(ficha.cliente);

      acoes.push({
        type: 'pdf', filePath: pdfPath,
        caption: `📄 Orçamento ${numero} — ${orcamento.totalPecas} peças · ${orcamento.metragemTotal} mts · *R$ ${BRL(orcamento.totalAvista)}* à vista`,
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

/** Terças pelo maior corte do orçamento e pelo vão máximo da telha mais restritiva. */
function calcularEstrutura(P, catalogo, comprimentoGalpaoM, say) {
  const perfil = (catalogo.perfis || []).find((p) => p.tipo === 'terca');
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
