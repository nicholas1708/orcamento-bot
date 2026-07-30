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
const { calcularRomaneio, parseCortes } = require('./romaneio');
const { gerarPDF } = require('./pdf');
const ai = require('./ai');
const conversa = require('./conversa');
const path = require('path');

const MAX_ERROS = 3;

const num = (t) => {
  const n = parseFloat(String(t).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const menu = (titulo, opcoes) =>
  titulo + '\n\n' + opcoes.map((o, i) => `*${i + 1}* — ${o}`).join('\n') +
  '\n\n_Responda com o número da opção._';
const escolha = (txt, lista) => {
  const i = parseInt(String(txt).trim(), 10);
  return i >= 1 && i <= lista.length ? lista[i - 1] : null;
};
async function escolhaInteligente(txt, lista, nomes, contexto) {
  return escolha(txt, lista) || (async () => {
    const n = await ai.escolherOpcao(txt, nomes, contexto);
    return n ? lista[n - 1] : null;
  })();
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
    say('Sem problemas! Um dos nossos vendedores vai te atender por aqui em instantes. 👍');
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
      say('Vou te passar pra um dos nossos vendedores pra te ajudar melhor. Já já alguém te chama por aqui 😉');
      ficha.etapa = 'HUMANO';
    } else say(msg);
  };

  const perguntarFamilia = () => {
    const familias = [...new Set(catalogo.telhas.map((t) => t.familia))];
    say(menu(
      P.grupos.length ? '🏠 Qual a *linha* da próxima telha?' : '🏠 Qual *linha de telha* você procura?',
      familias
    ));
    ficha.etapa = 'FAMILIA';
  };

  /** Fecha o produto atual e pergunta se quer adicionar outro. */
  const fecharProduto = (cortes, ambiente) => {
    const t = catalogo.telhas.find((x) => x.id === P.atual.telhaId);
    P.grupos.push({ telhaId: t.id, nome: t.nome, cortes, ambiente: ambiente || null });
    P.atual = { familia: null, telhaId: null, cortes: null, comprimentoGalpaoM: null, larguraGalpaoM: null, quedas: null };
    const met = P.grupos.reduce((s, g) => s + metrosDe(g.cortes), 0);
    say(
      `✅ *${t.nome}* adicionado!\n\n` +
      `📦 Orçamento até agora: *${P.grupos.length} produto(s)* · *${met.toFixed(3)} mts*\n\n` +
      `Quer adicionar *outro tipo de telha*?\n\n*1* — Sim, adicionar outra\n*2* — Não, seguir para o orçamento`
    );
    ficha.etapa = 'MAIS_TELHAS';
  };

  switch (ficha.etapa) {
    case 'INICIO': {
      say(
        `Olá! 👋 Bem-vindo(a) à *${catalogo.empresa.razao_social}*!\n` +
        `Sou o assistente de orçamentos — nossas telhas são cortadas *sob medida*.\n\n` +
        `_Digite *menu* pra recomeçar ou *atendente* pra falar com uma pessoa._`
      );
      perguntarFamilia();
      break;
    }

    case 'FAMILIA': {
      const familias = [...new Set(catalogo.telhas.map((t) => t.familia))];
      const i = parseInt(texto, 10);
      const fam = i >= 1 && i <= familias.length ? familias[i - 1] : null;
      if (!fam) { erro('Responda com o *número* da linha desejada.'); break; }
      P.atual.familia = fam;
      ficha.tentativasErro = 0;
      const grupo = catalogo.telhas.filter((t) => t.familia === fam);
      say(menu(`📋 Modelos da linha *${fam}*:`, grupo.map((t) => `${t.nome} — R$ ${BRL(t.preco)}/m`)));
      ficha.etapa = 'TELHA';
      break;
    }

    case 'TELHA': {
      const lista = P.atual.familia
        ? catalogo.telhas.filter((t) => t.familia === P.atual.familia)
        : catalogo.telhas;
      const t = await escolhaInteligente(texto, lista, lista.map((x) => x.nome), 'modelo de telha');
      if (!t) { erro('Responda com o *número* do modelo.'); break; }
      P.atual.telhaId = t.id;
      ficha.tentativasErro = 0;
      say(
        `✅ *${t.nome}* — R$ ${BRL(t.preco)}/metro (largura útil ${t.largura_util_m}m)\n\n` +
        `Como quer informar as medidas *desta telha*?\n\n` +
        `*1* — Já sei os tamanhos e quantidades\n` +
        `*2* — Não sei; informo as medidas do local e vocês calculam`
      );
      ficha.etapa = 'MODO';
      break;
    }

    case 'MODO': {
      if (texto === '1') {
        say(
          '📏 Me passe a *lista de cortes* — quantas peças de cada comprimento.\n\n' +
          '_Exemplo:_ `3 de 4m, 9 de 4,75 e 5 de 6,20`\n\n' +
          '_Pode mandar todos os comprimentos desta telha de uma vez._'
        );
        ficha.etapa = 'CORTES';
      } else if (texto === '2') {
        say(
          '📐 Quais as *medidas do local*, em metros?\n\n' +
          'Formato `comprimento x largura` — ex: `20x10`\n\n' +
          '_Comprimento = lado da cumeeira · largura = lado onde a água escorre._'
        );
        ficha.etapa = 'AMBIENTE';
      } else erro('Responda *1* (já sei os tamanhos) ou *2* (informar o local).');
      break;
    }

    // ── CAMINHO A: lista de cortes ────────────────────────────────────
    case 'CORTES': {
      const cortes = parseCortes(texto);
      if (!cortes.length) {
        erro('Não consegui entender 🤔 Use `quantidade de comprimento`, ex: `3 de 4m, 9 de 4,75`.');
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
      const dims = String(texto).match(/(\d+[.,]?\d*)\s*(?:x|×|por)\s*(\d+[.,]?\d*)/i);
      if (!dims) { erro('Me diga no formato `comprimento x largura`, ex: `20x10`.'); break; }
      P.atual.comprimentoGalpaoM = parseFloat(dims[1].replace(',', '.'));
      P.atual.larguraGalpaoM = parseFloat(dims[2].replace(',', '.'));
      ficha.tentativasErro = 0;
      say(
        `Anotei: *${P.atual.comprimentoGalpaoM} x ${P.atual.larguraGalpaoM}m* ✅\n\n` +
        '🏠 Esta área terá *1 queda* ou *2 quedas*?\n\n' +
        '_1 queda = caída única · 2 quedas = duas caídas com cumeeira._\n\n' +
        '*1* — Uma queda\n*2* — Duas quedas'
      );
      ficha.etapa = 'QUEDAS';
      break;
    }

    case 'QUEDAS': {
      const q = texto === '1' ? 1 : texto === '2' ? 2 : null;
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

    // ── Vários produtos no mesmo orçamento ────────────────────────────
    case 'MAIS_TELHAS': {
      if (texto === '1') { ficha.tentativasErro = 0; perguntarFamilia(); break; }
      if (texto === '2') {
        ficha.tentativasErro = 0;
        say('🔧 Quer *estrutura* (vigas/terças galvanizadas) junto?\n\n*1* — Só as telhas\n*2* — Telhas + estrutura');
        ficha.etapa = 'ESTRUTURA';
        break;
      }
      erro('Responda *1* pra adicionar outra telha ou *2* pra seguir.');
      break;
    }

    case 'ESTRUTURA': {
      const e = texto === '1' ? false : texto === '2' ? true : null;
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
      say('🙂 Quase lá! Qual o seu *nome* (ou da empresa)?');
      ficha.etapa = 'NOME';
      break;
    }

    case 'ESTRUTURA_MEDIDA': {
      const L = num(texto);
      if (!L || L <= 0) { erro('Informe o comprimento em metros, ex: *20*.'); break; }
      ficha.tentativasErro = 0;
      calcularEstrutura(P, catalogo, L, say);
      say('🙂 Quase lá! Qual o seu *nome* (ou da empresa)?');
      ficha.etapa = 'NOME';
      break;
    }

    // ── Dados do cliente ──────────────────────────────────────────────
    case 'NOME': {
      if (texto.length < 2) { erro('Pode me dizer seu nome?'); break; }
      ficha.cliente.nome = texto;
      ficha.tentativasErro = 0;
      say('🏙️ Qual a *cidade* de entrega? (ex: São José do Rio Preto - SP)');
      ficha.etapa = 'CIDADE';
      break;
    }

    case 'CIDADE': {
      if (texto.length < 2) { erro('Qual a cidade de entrega?'); break; }
      ficha.cliente.cidade = texto;
      ficha.tentativasErro = 0;
      say('📍 E o *endereço da obra* (rua, número e bairro)?\n\n_Necessário para a entrega._');
      ficha.etapa = 'ENDERECO';
      break;
    }

    case 'ENDERECO': {
      if (texto.length < 8 || !/\d/.test(texto)) {
        erro('Preciso do endereço completo com *rua, número e bairro*.');
        break;
      }
      ficha.cliente.endereco = texto;
      ficha.tentativasErro = 0;
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
      break;
    }

    case 'CONFIRMA': {
      let opc = texto === '1' ? 1 : texto === '2' ? 2 : null;
      if (!opc && /^(sim|pode|ok|isso|confirmo|gerar?|s)$/i.test(texto)) opc = 1;
      if (!opc && /^(n[aã]o|errado|mudar|n)$/i.test(texto)) opc = 2;
      if (!opc) opc = await ai.escolherOpcao(texto, ['Sim, gerar o orçamento', 'Não, recomeçar'], 'confirmação');
      if (opc === 2) { ficha = state.resetar(chatId); say('Sem problemas! Digite qualquer coisa pra recomeçar 🙂'); break; }
      if (opc !== 1) { erro('Responda *1* pra gerar ou *2* pra recomeçar.'); break; }

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

      acoes.push({
        type: 'pdf', filePath: pdfPath,
        caption: `📄 Orçamento ${numero} — ${orcamento.totalPecas} peças · ${orcamento.metragemTotal} mts · *R$ ${BRL(orcamento.totalAvista)}* à vista`,
      });
      say(
        `Prontinho! 🎉 O PDF traz também as opções parceladas.\n` +
        `Validade: *${catalogo.validade_orcamento_dias} dia*.\n\n` +
        `Quer fechar? Digite *atendente*. Novo orçamento: *menu*.`
      );
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
