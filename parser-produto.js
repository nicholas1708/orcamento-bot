/**
 * DESMEMBRADOR DE DESCRIÇÃO DE PRODUTO.
 *
 * O ERP da fábrica entrega tudo num nome só, por exemplo:
 *   "358769 - CONFORT PIR 30mm TRAPÉZIO 40/1000 ZCL 0,43mm GALVALUME Superior
 *    - FORRO RAL 9003 BRANCO SLIM Inferior - NCM: 73089090"
 *
 * Aqui a gente separa isso em campos, para o cadastro ficar organizado e para
 * extrair o dado mais crítico: a LARGURA ÚTIL, que está escondida no perfil
 * ("40/1000" = onda de 40mm / largura útil de 1000mm).
 *
 * ⚠️ Isto é uma SUGESTÃO para preencher o formulário — quem confirma é a pessoa.
 * Nada entra no catálogo sem passar pela conferência no painel.
 */

const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const paraNumero = (s) => {
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function desmembrar(descricao) {
  const txt = limpar(descricao);
  const r = {
    codigo: null, nome_curto: null, linha: null, nucleo: null,
    espessura_isolamento_mm: null, perfil: null, onda_mm: null,
    largura_util_m: null, espessura_chapa_mm: null, material: null,
    face_superior: null, face_inferior: null, ncm: null,
    tipo: 'telha', confianca: [],
  };
  if (!txt) return r;

  // código no início: "358769 - ..." ou "6391P4 - ..."
  const mCod = txt.match(/^\s*([A-Z0-9-]{3,12})\s*[-–]\s*/i);
  if (mCod) { r.codigo = mCod[1]; r.confianca.push('código'); }
  const corpo = mCod ? txt.slice(mCod[0].length) : txt;

  // NCM
  const mNcm = corpo.match(/NCM[:\s]*([\d.]{6,12})/i);
  if (mNcm) { r.ncm = mNcm[1].replace(/\./g, ''); r.confianca.push('NCM'); }

  // tipo do item pelo texto
  if (/parafuso/i.test(corpo)) r.tipo = 'fixacao';
  else if (/cumeeira|acabamento|rufo|calha|pingadeira|arremate/i.test(corpo)) r.tipo = 'acabamento';

  // perfil "TRAPÉZIO 40/1000" ou "TP 40/1000" → onda 40mm, largura útil 1000mm
  const mPerf = corpo.match(/(trap[ée]zio|tp|ondulad[ao])\s*([\d]{2,3})\s*\/\s*([\d]{3,4})/i);
  if (mPerf) {
    r.perfil = `${/ondulad/i.test(mPerf[1]) ? 'Ondulada' : 'Trapézio'} ${mPerf[2]}/${mPerf[3]}`;
    r.onda_mm = paraNumero(mPerf[2]);
    r.largura_util_m = paraNumero(mPerf[3]) / 1000;   // 1000mm → 1,00m
    r.confianca.push('perfil e largura útil');
  } else {
    // às vezes vem só "40/1000"
    const m2 = corpo.match(/\b([\d]{2,3})\s*\/\s*([\d]{3,4})\b/);
    if (m2) {
      r.perfil = `${m2[1]}/${m2[2]}`;
      r.onda_mm = paraNumero(m2[1]);
      r.largura_util_m = paraNumero(m2[2]) / 1000;
      r.confianca.push('largura útil (do perfil)');
    }
  }

  // núcleo isolante e espessura: "PIR 30mm", "EPS 50mm"
  const mNuc = corpo.match(/\b(PIR|EPS|PUR|POLIURETANO|ISOPOR|LÃ DE ROCHA)\b\s*([\d]{1,3})\s*mm/i);
  if (mNuc) {
    r.nucleo = mNuc[1].toUpperCase();
    r.espessura_isolamento_mm = paraNumero(mNuc[2]);
    r.confianca.push('núcleo e espessura do isolamento');
  } else {
    const soNuc = corpo.match(/\b(PIR|EPS|PUR|ISOPOR)\b/i);
    if (soNuc) r.nucleo = soNuc[1].toUpperCase();
  }

  // espessura da chapa: "0,43mm" / "0,50 mm"
  const mChapa = corpo.match(/\b(0[,.]\d{2})\s*mm/i);
  if (mChapa) { r.espessura_chapa_mm = paraNumero(mChapa[1]); r.confianca.push('espessura da chapa'); }

  // material da chapa
  const mMat = corpo.match(/\b(GALVALUME|GALVANIZAD[AO]|ZCL|ALUZINC|A[ÇC]O)\b/i);
  if (mMat) r.material = mMat[1].toUpperCase();

  // faces: "... GALVALUME Superior - FORRO RAL 9003 BRANCO SLIM Inferior"
  const mSup = corpo.match(/([A-Z0-9ÁÉÍÓÚÂÊÔÃÕÇ /,.-]{3,45}?)\s*Superior/i);
  if (mSup) { r.face_superior = limpar(mSup[1]).replace(/^[-–]\s*/, ''); r.confianca.push('face superior'); }
  const mInf = corpo.match(/([A-Z0-9ÁÉÍÓÚÂÊÔÃÕÇ /,.-]{3,45}?)\s*Inferior/i);
  if (mInf) { r.face_inferior = limpar(mInf[1]).replace(/^[-–]\s*/, ''); r.confianca.push('face inferior'); }

  // linha comercial: primeira palavra "de marca" antes do núcleo
  const mLinha = corpo.match(/^\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,15})\b/);
  if (mLinha && !/^(TELHA|CUMEEIRA|PARAFUSO|ACABAMENTO|CHAPA|PERFIL|RUFO)$/i.test(mLinha[1])) {
    r.linha = mLinha[1];
  }

  // barras com comprimento fixo: "Barras C/ 3mts"
  const mBarra = corpo.match(/barras?\s*c?\/?\s*([\d,.]+)\s*mts?/i);
  if (mBarra) { r.comprimento_barra_m = paraNumero(mBarra[1]); r.confianca.push('comprimento da barra'); }

  // nome curto, para exibir ao cliente final
  r.nome_curto = montarNomeCurto(r) || limpar(corpo.split(/-\s*NCM/i)[0]).slice(0, 70);

  return r;
}

function montarNomeCurto(r) {
  if (r.tipo !== 'telha') return null;
  const p = [];
  if (r.linha) p.push(r.linha);
  if (r.nucleo) p.push(r.nucleo);
  if (r.espessura_isolamento_mm) p.push(`${r.espessura_isolamento_mm}mm`);
  if (r.perfil) p.push(r.perfil);
  return p.length >= 2 ? p.join(' ') : null;
}

module.exports = { desmembrar };
