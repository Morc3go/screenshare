"use strict";
// Cada pessoa da sala mantém uma conexão WebRTC com cada uma das outras (malha).
// Quem compartilha adiciona as faixas da tela em todas as conexões; a renegociação
// segue o padrão "perfect negotiation" do MDN, que resolve ofertas simultâneas sem travar.
//
// Com até 10 pessoas, quem compartilha pode estar enviando para 9 ao mesmo tempo. Para isso
// caber no upload de uma internet doméstica:
//   - o bitrate de cada envio é o orçamento total dividido pelo número de quem está assistindo;
//   - quem assiste pode pausar uma tela, e aí quem compartilha para de enviar para essa pessoa
//     (replaceTrack(null), sem renegociar), liberando banda para os outros.
//
// Plano B — "via servidor": a conexão direta entre dois navegadores falha em várias redes
// (CGNAT de operadora, 4G, firewall). Se ela não fechar em alguns segundos, quem assiste pede a
// tela retransmitida pelo servidor: quem compartilha grava a tela em pedaços WebM
// (MediaRecorder) e manda pelo mesmo WebSocket da sinalização, que já funciona pelo túnel;
// quem assiste toca com MediaSource. Tem uns 1–2 s de atraso, mas sempre funciona.

const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
// ?so_servidor=1 impede a conexão direta, para testar o plano B.
const FORCAR_SERVIDOR = new URLSearchParams(location.search).has("so_servidor");

// altura: limite de resolução (null = resolução nativa do monitor; reduzir borra texto).
// maximo: teto de bitrate por pessoa assistindo. O total é limitado pelo upload informado.
// gravacao: bitrate do plano B (uma cópia só; o servidor é quem replica).
// codecs: ordem de preferência. VP9 tem modo de conteúdo de tela e deixa texto bem mais nítido
//   que VP8 no mesmo bitrate; H.264 costuma ter codificador por hardware, bom para 60 fps.
// degradacao: o que sacrificar quando falta banda/CPU.
// O fps de cada modo é o máximo pedido à captura e ao codificador. H.264 vem primeiro nos modos
// fluidos porque quase toda placa de vídeo o codifica por hardware: com VP9 (só por software) em
// resolução alta, o processador não dá conta e o próprio navegador derruba o fps.
// recomendado: bitrate por pessoa abaixo do qual a resolução escolhida começa a ficar ruim.
// Full HD, 1440p e 4K usam "maintain-resolution": faltando banda ou CPU, cai o fps e a resolução
// fica, que é o que se espera ao escolher uma resolução. "Fluidez máxima" faz o contrário.
// 4K e 1440p só saem se o monitor tiver essa resolução (a captura não aumenta a imagem).
const QUALIDADES = {
  fullhd:      { nome: "Full HD (1080p, 60 fps)",               altura: 1080, fps: 60, dica: "motion", maximo: 12e6, recomendado: 4e6,  gravacao: 8e6,  codecs: ["H264", "VP9", "AV1", "VP8"], degradacao: "maintain-resolution" },
  equilibrado: { nome: "Quad HD (1440p, 60 fps)",               altura: 1440, fps: 60, dica: "motion", maximo: 20e6, recomendado: 7e6,  gravacao: 12e6, codecs: ["H264", "VP9", "AV1", "VP8"], degradacao: "maintain-resolution" },
  uhd:         { nome: "4K (2160p, 60 fps)",                    altura: 2160, fps: 60, dica: "motion", maximo: 40e6, recomendado: 15e6, gravacao: 20e6, codecs: ["H264", "AV1", "VP9", "VP8"], degradacao: "maintain-resolution" },
  movimento:   { nome: "Fluidez máxima (jogos rápidos, 60 fps)", altura: 1080, fps: 60, dica: "motion", maximo: 12e6, recomendado: 3e6,  gravacao: 8e6,  codecs: ["H264", "VP9", "VP8", "AV1"], degradacao: "maintain-framerate" },
  texto:       { nome: "Texto nítido (resolução do monitor, 30 fps)", altura: null, fps: 30, dica: "detail", maximo: 12e6, recomendado: 3e6, gravacao: 6e6, codecs: ["VP9", "AV1", "H264", "VP8"], degradacao: "maintain-resolution" },
  leve:        { nome: "Internet fraca (720p, 30 fps)",         altura: 720,  fps: 30, dica: "motion", maximo: 1.5e6, recomendado: 0,   gravacao: 1e6,  codecs: ["H264", "VP9", "VP8", "AV1"], degradacao: "balanced", orcamentoMax: 4e6 },
};
const QUALIDADE_PADRAO = "fullhd";
// Upload que a pessoa diz ter; 80% dele vai para a tela, o resto fica para o resto da internet.
const UPLOADS_MBPS = [5, 10, 20, 50, 100, 300, 500, 1000];
const UPLOAD_PADRAO_MBPS = 20;
const FRACAO_DO_UPLOAD = 0.8;
// O Chrome começa a transmitir em ~300 kbps e sobe devagar, deixando a tela borrada nos
// primeiros segundos. Esta dica no SDP faz ele começar já num bitrate decente.
const BITRATE_INICIAL_KBPS = 4000;
const PARAMETROS_OPUS = { stereo: 1, "sprop-stereo": 1, maxaveragebitrate: 128000, useinbandfec: 1 };

// Restrições do áudio capturado. Os filtros de chamada de voz (cancelar eco, tirar ruído,
// ajustar volume) cortam música e som de jogo, então vão desligados.
const AUDIO_DA_TELA = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  suppressLocalAudioPlayback: false,
};
// Sem som por este tempo, com a faixa de áudio existindo, vira aviso para quem compartilha.
const SILENCIO_SUSPEITO_MS = 20000;
const NIVEL_MINIMO_SOM = 0.002; // RMS abaixo disso é silêncio
const BITRATE_MINIMO = 250e3;
const ESPERA_CONEXAO_DIRETA_MS = 7000;
const FATIA_GRAVACAO_MS = 250;
// Plano B: toca ~1 s atrás do "ao vivo" para ter folga contra oscilação; se acumular mais que
// ATRASO_MAXIMO_S (aba em segundo plano, rede lenta), pula de volta para perto do ao vivo.
const FOLGA_RELAY_S = 1.0;
const ATRASO_MAXIMO_S = 3.0;

const $ = (id) => document.getElementById(id);
const mostrar = (el, sim) => el.classList.toggle("oculto", !sim);

const estado = {
  meuId: null,
  sala: "",
  senha: "",
  nome: "",
  maxPorSala: 10,
  ws: null,             // WebSocket de sinalização
  saindo: false,        // saída voluntária: não reconecta
  minhaTela: null,      // MediaStream da minha tela
  destaque: null,       // chave do bloco ampliado
  gravacao: null,       // plano B do meu lado: { recorder, mime, assinantes:Set, fila:Promise }
  mudos: new Set(),
  avisoSom: null,       // null | "sem-faixa" | "silencio"
  silencioDesde: 0,     // telas que EU silenciei
  somBloqueado: false,  // o navegador recusou tocar com som antes de um clique
  pares: new Map(),
  // id -> { pc, nome, polido, criandoOferta, ignorarOferta,
  //         fluxo, compartilhando,          (a tela DELE)
  //         euPausei,                       (eu não quero ver a tela dele)
  //         desdeFalha,                     (quando a conexão direta começou a não funcionar)
  //         relay: null | { ms, sb, url, fila, mime },  (tela dele chegando via servidor)
  //         envios: [{sender, track}],      (minha tela indo para ele)
  //         elePausou }                     (ele não quer ver a minha)
};

// ---------- Utilidades ----------
function lerLocal(chave) { try { return localStorage.getItem(chave) || ""; } catch { return ""; } }
function gravarLocal(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* sem storage */ } }
const mbps = (b) => (b / 1e6).toFixed(1).replace(".", ",") + " Mbps";

function sinal(tipo, dados, para) {
  const ws = estado.ws;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ tipo, para, dados }));
}

function qualidadeAtual() {
  return QUALIDADES[$("sel-qualidade").value] || QUALIDADES[QUALIDADE_PADRAO];
}

function orcamentoUpload() {
  const total = (Number($("sel-upload").value) || UPLOAD_PADRAO_MBPS) * 1e6 * FRACAO_DO_UPLOAD;
  return Math.min(total, qualidadeAtual().orcamentoMax ?? Infinity);
}

function restricoesDaTela(q) {
  const video = { frameRate: { ideal: q.fps, max: q.fps } };
  // ideal = pede a resolução cheia (sem isso alguns navegadores entregam menos); max = não passa dela.
  if (q.altura) video.height = { ideal: q.altura, max: q.altura };
  return video;
}

function nomeDaResolucao(altura) {
  if (!altura) return "";
  if (altura >= 2000) return "4K";
  if (altura >= 1400) return "1440p";
  if (altura >= 1000) return "1080p";
  if (altura >= 700) return "720p";
  return `${altura}p`;
}
function textoDeQualidade(altura, fps) {
  const res = nomeDaResolucao(altura);
  return res ? res + (fps ? ` · ${Math.round(fps)} fps` : "") : "";
}

// A cada 2 s, lê a resolução e o fps que realmente estão chegando (ou saindo, na minha tela),
// para mostrar na legenda de cada tela.
async function medirQualidadeRecebida() {
  let mudou = false;
  for (const [id, par] of estado.pares) {
    let texto = "";
    if (par.relay?.url) {
      const v = document.querySelector(`[data-chave="${CSS.escape(id)}"] video`);
      texto = textoDeQualidade(v?.videoHeight);
    } else if (par.compartilhando && par.pc.connectionState === "connected") {
      try {
        (await par.pc.getStats()).forEach((x) => {
          if (x.type === "inbound-rtp" && x.kind === "video" && x.frameHeight) texto = textoDeQualidade(x.frameHeight, x.framesPerSecond);
        });
      } catch { /* conexão fechando */ }
    }
    if (par.qualidadeRecebida !== texto) { par.qualidadeRecebida = texto; mudou = true; }
  }
  const minha = estado.minhaTela?.getVideoTracks()[0]?.getSettings();
  const textoMinha = minha ? textoDeQualidade(minha.height, minha.frameRate) : "";
  if (estado.qualidadeEnviada !== textoMinha) { estado.qualidadeEnviada = textoMinha; mudou = true; }
  if (mudou) desenharBlocos();
}

// Ajusta o SDP enviado. Os parâmetros de formato (fmtp) são lidos pelo navegador do OUTRO lado
// ao aplicar a descrição e valem para o que ele enviar; como os dois lados fazem isso, quem
// compartilha sempre recebe as dicas. Navegadores que não conhecem um parâmetro o ignoram.
//   - vídeo: x-google-start-bitrate, para começar nítido;
//   - áudio (Opus): por padrão o WebRTC manda voz mono a ~32 kbps, que estraga música e som de
//     jogo; aqui vira estéreo a 128 kbps.
function ajustarSdp(descricao) {
  const linhas = descricao.sdp.split("\r\n");
  let secao = "";
  const tiposVideo = new Set();
  const tiposOpus = new Set();
  for (const l of linhas) {
    if (l.startsWith("m=")) secao = l.slice(2, 7);
    const v = secao === "video" && /^a=rtpmap:(\d+) (VP8|VP9|AV1|H264)\//i.exec(l);
    if (v) tiposVideo.add(v[1]);
    const a = secao === "audio" && /^a=rtpmap:(\d+) opus\//i.exec(l);
    if (a) tiposOpus.add(a[1]);
  }
  const acrescentar = (linha, params) => {
    for (const [chave, valor] of Object.entries(params)) {
      if (!new RegExp(`[; ]${chave}=`).test(linha)) linha += `;${chave}=${valor}`;
    }
    return linha;
  };
  const comFmtp = new Set();
  const saida = linhas.map((l) => {
    const m = /^a=fmtp:(\d+) (.*)$/.exec(l);
    if (!m) return l;
    if (tiposOpus.has(m[1])) return acrescentar(l, PARAMETROS_OPUS);
    if (!tiposVideo.has(m[1])) return l;
    comFmtp.add(m[1]);
    return acrescentar(l, { "x-google-start-bitrate": BITRATE_INICIAL_KBPS });
  });
  const final = [];
  for (const l of saida) {
    final.push(l);
    const m = /^a=rtpmap:(\d+) /.exec(l);
    if (m && tiposVideo.has(m[1]) && !comFmtp.has(m[1])) final.push(`a=fmtp:${m[1]} x-google-start-bitrate=${BITRATE_INICIAL_KBPS}`);
  }
  return { type: descricao.type, sdp: final.join("\r\n") };
}

// Ordena os codecs que o navegador suporta pela preferência da qualidade escolhida.
function preferirCodecs(transceptor, q) {
  if (!transceptor?.setCodecPreferences || !window.RTCRtpReceiver?.getCapabilities) return;
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs || [];
  const posicao = (c) => {
    const nome = c.mimeType.split("/")[1].toUpperCase();
    const i = q.codecs.indexOf(nome);
    return i === -1 ? q.codecs.length : i; // RTX, RED e FEC vão para o fim, mas continuam na lista
  };
  try {
    transceptor.setCodecPreferences([...codecs].sort((a, b) => posicao(a) - posicao(b)));
  } catch (e) {
    console.warn("Não foi possível escolher o codec", e);
  }
}

let temporizadorToast = null;
function toast(texto, duracaoMs = 2200) {
  const el = $("aviso-flutuante");
  el.textContent = texto;
  el.classList.add("visivel");
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.classList.remove("visivel"), duracaoMs);
}

function corDoNome(nome) {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h} 65% 50%)`;
}
function avatar(nome) {
  const el = document.createElement("span");
  el.className = "avatar";
  el.style.background = corDoNome(nome);
  el.textContent = (nome.trim()[0] || "?").toUpperCase();
  return el;
}
function icone(nome) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", "#i-" + nome);
  svg.appendChild(use);
  return svg;
}

// ---------- Conexões com os outros ----------
function criarPar(id, nome) {
  if (estado.pares.has(id)) return estado.pares.get(id);
  const pc = new RTCPeerConnection(FORCAR_SERVIDOR ? { iceServers: [], iceTransportPolicy: "relay" } : { iceServers: ICE });
  const par = {
    pc, nome, fluxo: null, compartilhando: false, euPausei: false, desdeFalha: null, relay: null,
    envios: [], elePausou: false,
    // Um lado precisa ceder quando os dois mandam oferta ao mesmo tempo; a ordem dos ids decide.
    polido: estado.meuId < id,
    criandoOferta: false, ignorarOferta: false,
  };
  estado.pares.set(id, par);

  pc.onicecandidate = ({ candidate }) => { if (candidate) sinal("ice", candidate, id); };
  pc.onnegotiationneeded = async () => {
    try {
      par.criandoOferta = true;
      await pc.setLocalDescription();
      sinal("sdp", ajustarSdp(pc.localDescription), id);
    } catch (e) {
      console.warn("Erro ao negociar", e);
    } finally {
      par.criandoOferta = false;
    }
  };
  // Os parâmetros de codificação só existem depois da negociação; reaplica quando ela termina.
  pc.onsignalingstatechange = () => { if (pc.signalingState === "stable") ajustarQualidade(); };
  pc.ontrack = ({ track, streams }) => {
    par.fluxo = streams[0] || new MediaStream([track]);
    track.onunmute = () => desenharBlocos();
    if (par.compartilhando) desenharBlocos();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") pc.restartIce();
    desenharBlocos();
  };

  if (estado.minhaTela) enviarTelaPara(par);
  return par;
}

function enviarTelaPara(par) {
  const q = qualidadeAtual();
  par.envios = estado.minhaTela.getTracks().map((track) => {
    const sender = par.pc.addTrack(track, estado.minhaTela);
    // Precisa ser antes da negociação, que o addTrack só dispara na próxima volta do loop.
    if (track.kind === "video") preferirCodecs(par.pc.getTransceivers().find((t) => t.sender === sender), q);
    return { sender, track };
  });
}

function removerPar(id) {
  const par = estado.pares.get(id);
  if (!par) return;
  par.pc.close();
  fecharRelay(par);
  estado.pares.delete(id);
  removerAssinante(id);
  if (estado.destaque === id) estado.destaque = null;
  desenharPessoas();
  desenharBlocos();
  ajustarQualidade();
}

async function tratarSdp(id, descricao) {
  const par = estado.pares.get(id) || criarPar(id, "?");
  const pc = par.pc;
  const colisao = descricao.type === "offer" && (par.criandoOferta || pc.signalingState !== "stable");
  par.ignorarOferta = !par.polido && colisao;
  if (par.ignorarOferta) return;
  await pc.setRemoteDescription(descricao);
  if (descricao.type === "offer") {
    await pc.setLocalDescription();
    sinal("sdp", ajustarSdp(pc.localDescription), id);
  }
}

async function tratarIce(id, candidato) {
  const par = estado.pares.get(id);
  if (!par) return;
  try {
    await par.pc.addIceCandidate(candidato);
  } catch (e) {
    if (!par.ignorarOferta) console.warn("Candidato ICE rejeitado", e);
  }
}

// Alguém pausou/voltou a assistir a MINHA tela.
async function tratarPedidoAssistir(id, ativo) {
  const par = estado.pares.get(id);
  if (!par) return;
  par.elePausou = !ativo;
  for (const { sender, track } of par.envios) {
    try { await sender.replaceTrack(ativo && estado.minhaTela ? track : null); } catch (e) { console.warn(e); }
  }
  ajustarQualidade();
}

// A conexão direta com quem compartilha está entregando vídeo?
function conexaoDiretaOk(par) {
  return par.pc.connectionState === "connected" && Boolean(par.fluxo) &&
    par.fluxo.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
}

// Roda a cada 2 s: decide, para cada tela que eu estou vendo, se vai direto ou via servidor.
function verificarConexoes() {
  const agora = Date.now();
  for (const [id, par] of estado.pares) {
    if (!par.compartilhando || par.euPausei) {
      par.desdeFalha = null;
      if (par.relay) desligarRelay(id, par);
      continue;
    }
    if (conexaoDiretaOk(par)) {
      par.desdeFalha = null;
      if (par.relay) { desligarRelay(id, par); desenharBlocos(); }
      continue;
    }
    par.desdeFalha ??= agora;
    if (!par.relay && agora - par.desdeFalha > ESPERA_CONEXAO_DIRETA_MS) ligarRelay(id, par);
  }
}

// ---------- Plano B: tela via servidor (lado de quem assiste) ----------
function ligarRelay(id, par) {
  par.relay = { ms: null, sb: null, url: null, fila: [], mime: null };
  sinal("relay", { ativo: true }, id);
  desenharBlocos();
}

function desligarRelay(id, par) {
  sinal("relay", { ativo: false }, id);
  fecharRelay(par);
}

function fecharRelay(par) {
  if (!par.relay) return;
  if (par.relay.url) URL.revokeObjectURL(par.relay.url);
  par.relay = null;
}

// Quem compartilha (re)começou a gravação: começa um MediaSource novo.
function iniciarFluxoRelay(par, mime) {
  if (!par.relay) return;
  if (!window.MediaSource || !MediaSource.isTypeSupported(mime)) {
    par.relay.semSuporte = true;
    desenharBlocos();
    return;
  }
  if (par.relay.url) URL.revokeObjectURL(par.relay.url);
  const ms = new MediaSource();
  Object.assign(par.relay, { ms, sb: null, fila: [], mime, url: URL.createObjectURL(ms) });
  ms.addEventListener("sourceopen", () => {
    if (par.relay?.ms !== ms) return;
    const sb = ms.addSourceBuffer(mime);
    sb.mode = "sequence";
    sb.addEventListener("updateend", () => alimentarRelay(par));
    par.relay.sb = sb;
    alimentarRelay(par);
  }, { once: true });
  desenharBlocos();
}

function receberPedacoRelay(dados) {
  const id = new TextDecoder().decode(new Uint8Array(dados, 0, 36));
  const par = estado.pares.get(id);
  if (!par?.relay?.ms) return;
  par.relay.fila.push(dados.slice(36));
  alimentarRelay(par);
}

function alimentarRelay(par) {
  const r = par.relay;
  if (!r?.sb || r.sb.updating || r.ms.readyState !== "open") return;
  const video = document.querySelector(`[data-chave="${CSS.escape(idDoPar(par))}"] video`);
  if (video && r.sb.buffered.length) {
    const fim = r.sb.buffered.end(r.sb.buffered.length - 1);
    const folga = fim - video.currentTime;
    if (folga > ATRASO_MAXIMO_S) video.currentTime = fim - FOLGA_RELAY_S;
    // Só (re)começa a tocar com folga no buffer; tocar colado na borda faz o player travar a cada pedaço.
    if (video.paused && folga >= FOLGA_RELAY_S) tocar(video);
    // Descarta o que já passou para não encher a memória.
    const inicio = r.sb.buffered.start(0);
    if (video.currentTime - inicio > 30) { r.sb.remove(inicio, video.currentTime - 10); return; }
  }
  const pedaco = r.fila.shift();
  if (!pedaco) return;
  try {
    r.sb.appendBuffer(pedaco);
  } catch (e) {
    console.warn("Pedaço de vídeo rejeitado; pedindo para recomeçar", e);
    const id = idDoPar(par);
    desligarRelay(id, par);
    ligarRelay(id, par);
  }
}

function idDoPar(par) {
  for (const [id, p] of estado.pares) if (p === par) return id;
  return "";
}

// ---------- Plano B: tela via servidor (lado de quem compartilha) ----------
function escolherMime() {
  const opcoes = estado.minhaTela.getAudioTracks().length
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return opcoes.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null;
}

// Cada assinante novo precisa do começo do arquivo WebM (cabeçalho + quadro-chave), então a
// gravação recomeça e todos os assinantes reiniciam o player. Acontece só quando alguém novo cai
// no plano B, então o "piscar" é raro.
function reiniciarGravacao() {
  pararGravacao(false);
  const g = estado.gravacao;
  if (!estado.minhaTela || !g || !g.assinantes.size) return;
  const mime = escolherMime();
  if (!mime) {
    console.warn("Este navegador não grava a tela em WebM; plano B indisponível");
    return;
  }
  const recorder = new MediaRecorder(estado.minhaTela, {
    mimeType: mime,
    videoBitsPerSecond: qualidadeAtual().gravacao,
    audioBitsPerSecond: 128e3,
  });
  g.recorder = recorder;
  g.mime = mime;
  for (const id of g.assinantes) sinal("relay-inicio", { mime }, id);
  recorder.ondataavailable = (ev) => {
    if (!ev.data.size || g.recorder !== recorder) return;
    // arrayBuffer() é assíncrono: a fila garante que os pedaços saem na ordem certa.
    g.fila = g.fila.then(async () => {
      const buf = await ev.data.arrayBuffer();
      if (g.recorder === recorder && estado.ws?.readyState === WebSocket.OPEN) estado.ws.send(buf);
    });
  };
  recorder.start(FATIA_GRAVACAO_MS);
}

function pararGravacao(limparAssinantes) {
  const g = estado.gravacao;
  if (!g) return;
  if (g.recorder && g.recorder.state !== "inactive") g.recorder.stop();
  g.recorder = null;
  if (limparAssinantes) g.assinantes.clear();
}

function tratarPedidoRelay(id, ativo) {
  estado.gravacao ??= { recorder: null, mime: null, assinantes: new Set(), fila: Promise.resolve() };
  const g = estado.gravacao;
  if (ativo) {
    g.assinantes.add(id);
    reiniciarGravacao();
  } else {
    removerAssinante(id);
  }
  ajustarQualidade();
}

function removerAssinante(id) {
  const g = estado.gravacao;
  if (!g || !g.assinantes.delete(id)) return;
  if (!g.assinantes.size) pararGravacao(false);
}

// ---------- Qualidade adaptativa ----------
async function ajustarQualidade() {
  const info = $("info-envio");
  if (!estado.minhaTela) { info.textContent = ""; return; }
  const q = qualidadeAtual();
  const viaServidor = estado.gravacao?.assinantes.size || 0;
  const recebendo = [...estado.pares.entries()]
    .filter(([id, p]) => p.envios.length && !p.elePausou && !estado.gravacao?.assinantes.has(id))
    .map(([, p]) => p);
  // Quem recebe via servidor também sai do meu upload (uma cópia da gravação, não importa quantos).
  const orcamento = orcamentoUpload() - (viaServidor ? q.gravacao : 0);
  const porPessoa = Math.max(BITRATE_MINIMO, Math.min(q.maximo, orcamento / Math.max(1, recebendo.length)));

  for (const par of recebendo) {
    for (const { sender, track } of par.envios) {
      if (track.kind !== "video") continue;
      try {
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) continue; // ainda negociando
        p.encodings[0].maxBitrate = Math.round(porPessoa);
        p.encodings[0].maxFramerate = q.fps;
        p.encodings[0].scaleResolutionDownBy = 1;
        p.encodings[0].priority = p.encodings[0].networkPriority = "high";
        p.degradationPreference = q.degradacao;
        try {
          await sender.setParameters(p);
        } catch {
          // Navegadores mais antigos recusam degradationPreference/priority: tenta só o essencial.
          delete p.degradationPreference;
          delete p.encodings[0].priority;
          delete p.encodings[0].networkPriority;
          await sender.setParameters(p);
        }
      } catch (e) {
        console.warn("Não foi possível ajustar o bitrate", e);
      }
    }
  }
  const n = recebendo.length;
  const partes = [];
  if (n) partes.push(`${n} ${n === 1 ? "pessoa" : "pessoas"} direto · até ${mbps(porPessoa)} cada`);
  if (viaServidor) partes.push(`${viaServidor} via servidor`);
  let texto = partes.length ? "Assistindo você: " + partes.join(" · ") : "Ninguém assistindo sua tela ainda";
  if (n && porPessoa < q.recomendado) {
    texto += ` — pouco para ${q.nome.split(" (")[0]} (ideal: ${mbps(q.recomendado)} por pessoa). Se sua internet aguentar, aumente "Seu upload"; senão, use uma qualidade menor.`;
  }
  info.textContent = texto;
}

async function aplicarQualidadeNaFaixa() {
  const tela = estado.minhaTela;
  if (!tela) return;
  const q = qualidadeAtual();
  const video = tela.getVideoTracks()[0];
  video.contentHint = q.dica;
  try { await video.applyConstraints(restricoesDaTela(q)); } catch { /* nem todo navegador aceita */ }
  if (estado.gravacao?.assinantes.size) reiniciarGravacao();
  ajustarQualidade();
}

// ---------- Entrar / sair ----------
function erroEntrada(msg) {
  $("erro-entrada").textContent = msg;
  mostrar($("erro-entrada"), true);
}

function entrar() {
  estado.nome = $("campo-nome").value.trim();
  estado.sala = ($("campo-sala").value.trim() || "geral").slice(0, 40);
  estado.senha = $("campo-senha").value;
  estado.saindo = false;
  gravarLocal("nome", estado.nome);
  conectar(false);
}

// `reconectando`: a conexão caiu depois de já estarmos na sala (Wi-Fi oscilou, túnel reiniciou).
function conectar(reconectando) {
  const q = new URLSearchParams({ sala: estado.sala, nome: estado.nome, senha: estado.senha });
  const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocolo}//${location.host}/ws?${q}`);
  ws.binaryType = "arraybuffer";
  estado.ws = ws;
  let entrou = false, recusado = false;

  const ao = {
    recusado({ motivo }) {
      recusado = true;
      if (motivo === "senha") {
        mostrar($("rotulo-senha"), true);
        erroEntrada(estado.senha ? "Senha incorreta." : "Esta sala pede senha.");
      } else if (motivo === "cheia") {
        erroEntrada(`A sala "${estado.sala}" está cheia (máximo de ${estado.maxPorSala} pessoas).`);
      }
      if (reconectando) sair();
    },
    "bem-vindo"({ id, participantes, maxPorSala }) {
      entrou = true;
      estado.maxPorSala = maxPorSala || estado.maxPorSala;
      // Reconexão gera um id novo: descarta as conexões antigas.
      for (const pid of [...estado.pares.keys()]) removerPar(pid);
      pararGravacao(true);
      estado.meuId = id;
      for (const p of participantes) {
        const par = criarPar(p.id, p.nome);
        par.compartilhando = p.compartilhando;
      }
      if (estado.minhaTela) sinal("estado", estadoDoMeuCompartilhamento());
      mostrar($("aviso-conexao"), false);
      abrirSala();
    },
    entrou({ id, nome }) {
      criarPar(id, nome);
      if (estado.minhaTela) sinal("estado", estadoDoMeuCompartilhamento(), id);
      desenharPessoas();
      toast(`${nome} entrou na sala`);
    },
    saiu({ id }) {
      const nome = estado.pares.get(id)?.nome;
      removerPar(id);
      if (nome) toast(`${nome} saiu`);
    },
    async sinal({ de, tipo, dados }) {
      if (tipo === "sdp") await tratarSdp(de, dados);
      else if (tipo === "ice") await tratarIce(de, dados);
      else if (tipo === "assistir") await tratarPedidoAssistir(de, Boolean(dados && dados.ativo));
      else if (tipo === "relay") tratarPedidoRelay(de, Boolean(dados && dados.ativo));
      else if (tipo === "relay-inicio") {
        const par = estado.pares.get(de);
        if (par && typeof dados?.mime === "string") iniciarFluxoRelay(par, dados.mime);
      } else if (tipo === "relay-atrasado") {
        // O servidor cortou porque eu estava baixando devagar: pede de novo.
        const par = estado.pares.get(de);
        if (par?.relay) { fecharRelay(par); ligarRelay(de, par); }
      } else if (tipo === "estado") {
        const par = estado.pares.get(de);
        if (!par) return;
        const antes = par.compartilhando;
        par.compartilhando = Boolean(dados && dados.compartilhando);
        par.temAudio = Boolean(dados && dados.audio);
        if (!par.compartilhando) {
          par.euPausei = false; // próxima vez começa assistindo
          if (par.relay) desligarRelay(de, par);
        }
        if (!antes && par.compartilhando) toast(`${par.nome} começou a compartilhar`);
        desenharPessoas();
        desenharBlocos();
      }
    },
  };

  ws.onmessage = async (ev) => {
    if (typeof ev.data !== "string") { receberPedacoRelay(ev.data); return; }
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    try { await ao[msg.evento]?.(msg); } catch (e) { console.warn("Erro ao tratar mensagem", e); }
  };
  ws.onclose = () => {
    if (estado.ws !== ws || estado.saindo || recusado) return;
    if (!entrou && !reconectando) { erroEntrada("Não foi possível conectar ao servidor."); return; }
    // Estava na sala: avisa e tenta de novo. Sem sinalização ninguém novo consegue entrar
    // (e o plano B para), então refazemos tudo.
    mostrar($("aviso-conexao"), true);
    setTimeout(() => { if (!estado.saindo && estado.ws === ws) conectar(true); }, 2000);
  };
}

function abrirSala() {
  $("txt-sala").textContent = estado.sala;
  const url = new URL(location.href);
  url.search = "?sala=" + encodeURIComponent(estado.sala) + (FORCAR_SERVIDOR ? "&so_servidor=1" : "");
  history.replaceState(null, "", url);
  mostrar($("tela-entrada"), false);
  mostrar($("tela-sala"), true);
  desenharPessoas();
  desenharBlocos();
}

function sair() {
  estado.saindo = true;
  pararCompartilhar();
  estado.ws?.close();
  estado.ws = null;
  for (const id of [...estado.pares.keys()]) removerPar(id);
  mostrar($("aviso-conexao"), false);
  mostrar($("tela-sala"), false);
  mostrar($("tela-entrada"), true);
}

// ---------- Compartilhar ----------
function atualizarBotaoCompartilhar() {
  const btn = $("btn-compartilhar");
  const ativo = Boolean(estado.minhaTela);
  btn.classList.toggle("primario", !ativo);
  btn.classList.toggle("perigo", ativo);
  btn.replaceChildren(icone(ativo ? "parar" : "tela"), Object.assign(document.createElement("span"), {
    textContent: ativo ? "Parar de compartilhar" : "Compartilhar minha tela",
  }));
}

function estadoDoMeuCompartilhamento() {
  return { compartilhando: Boolean(estado.minhaTela), audio: Boolean(estado.minhaTela?.getAudioTracks().length) };
}

async function compartilhar() {
  if (estado.minhaTela) return pararCompartilhar();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast("Este navegador não deixa compartilhar a tela aqui. Use Chrome, Edge ou Firefox no computador.");
    return;
  }
  const q = qualidadeAtual();
  let tela;
  try {
    const querAudio = $("com-audio").checked;
    // restrictOwnAudio tira do áudio do sistema o som desta aba (as telas dos outros tocando
    // aqui), que voltaria para eles como eco. Só é pedido quando alguém está mesmo mandando som:
    // é um recurso novo do Chrome e, se der problema em algum Windows, ao menos não afeta o caso comum.
    const haSomDosOutros = [...estado.pares.values()].some((p) => p.compartilhando && p.temAudio);
    const audio = querAudio ? { ...AUDIO_DA_TELA, ...(haSomDosOutros ? { restrictOwnAudio: true } : {}) } : false;
    tela = await navigator.mediaDevices.getDisplayMedia({
      video: restricoesDaTela(q),
      audio,
      // Opções do seletor do Chrome/Edge (os outros navegadores ignoram):
      systemAudio: "include",        // oferece o áudio do sistema ao escolher "Tela inteira"
      windowAudio: "system",         // e ao escolher uma janela, onde o navegador suportar
      selfBrowserSurface: "exclude", // não oferece esta própria aba (daria espelho infinito)
      surfaceSwitching: "include",   // permite trocar o que está compartilhando sem parar
    });
  } catch {
    return; // cancelou a escolha
  }
  const faixaAudio = tela.getAudioTracks()[0];
  if (faixaAudio) faixaAudio.contentHint = "music";
  estado.minhaTela = tela;
  estado.silencioDesde = Date.now();
  // Aviso fixo (não some sozinho) quando a tela foi sem som: o seletor do Chrome deixa
  // "Compartilhar áudio do sistema" desligado em "Tela inteira", e é fácil não perceber.
  mostrarAvisoSom($("com-audio").checked && !faixaAudio ? "sem-faixa" : null);
  tela.getVideoTracks()[0].contentHint = q.dica;
  // O botão "Parar compartilhamento" do próprio navegador encerra a faixa.
  tela.getVideoTracks()[0].addEventListener("ended", pararCompartilhar);
  for (const par of estado.pares.values()) { par.elePausou = false; enviarTelaPara(par); }
  sinal("estado", estadoDoMeuCompartilhamento());
  atualizarBotaoCompartilhar();
  desenharPessoas();
  desenharBlocos();
  ajustarQualidade();
}

function pararCompartilhar() {
  const tela = estado.minhaTela;
  if (!tela) return;
  pararGravacao(true);
  estado.minhaTela = null;
  tela.getTracks().forEach((t) => t.stop());
  for (const par of estado.pares.values()) {
    for (const { sender } of par.envios) {
      try { par.pc.removeTrack(sender); } catch { /* conexão já fechada */ }
    }
    par.envios = [];
    par.elePausou = false;
  }
  if (estado.destaque === "eu") estado.destaque = null;
  mostrarAvisoSom(null);
  sinal("estado", { compartilhando: false });
  atualizarBotaoCompartilhar();
  desenharPessoas();
  desenharBlocos();
  ajustarQualidade();
}

function alternarPausa(id) {
  const par = estado.pares.get(id);
  if (!par) return;
  par.euPausei = !par.euPausei;
  sinal("assistir", { ativo: !par.euPausei }, id);
  if (par.euPausei && par.relay) desligarRelay(id, par);
  desenharBlocos();
}

// ---------- Som ----------
// Medidor de nível: mostra em cada tela se o som está saindo (na minha) ou chegando (nas dos
// outros). É o jeito de saber, na hora, se o problema é a captura ou a reprodução.
let contextoAudio = null;
const medidores = new WeakMap(); // MediaStreamTrack -> AnalyserNode

function nivelDaFaixa(track) {
  if (!track || track.readyState !== "live") return null;
  try {
    contextoAudio ??= new AudioContext();
    if (contextoAudio.state === "suspended") contextoAudio.resume().catch(() => {});
    let analisador = medidores.get(track);
    if (!analisador) {
      analisador = contextoAudio.createAnalyser();
      analisador.fftSize = 1024;
      contextoAudio.createMediaStreamSource(new MediaStream([track])).connect(analisador);
      medidores.set(track, analisador);
    }
    const amostras = new Float32Array(analisador.fftSize);
    analisador.getFloatTimeDomainData(amostras);
    let soma = 0;
    for (const a of amostras) soma += a * a;
    return Math.sqrt(soma / amostras.length);
  } catch {
    return null;
  }
}

// Faixa de áudio que está tocando num bloco (fluxo direto) ou capturada do player (via servidor).
function faixaDeAudioDoBloco(bloco) {
  const video = bloco.querySelector("video");
  if (video.srcObject) return video.srcObject.getAudioTracks()[0] || null;
  if (video.dataset.url && video.captureStream) {
    try {
      video.__captura ??= video.captureStream();
      return video.__captura.getAudioTracks()[0] || null;
    } catch { return null; }
  }
  return null;
}

function atualizarMedidores() {
  for (const bloco of document.querySelectorAll(".bloco")) {
    const barra = bloco.querySelector(".medidor");
    if (!barra) continue;
    const nivel = nivelDaFaixa(faixaDeAudioDoBloco(bloco));
    // Escala logarítmica: som de jogo/música fica entre -50 e 0 dB.
    const fracao = nivel ? Math.max(0, Math.min(1, (20 * Math.log10(nivel) + 50) / 50)) : 0;
    barra.style.setProperty("--nivel", fracao.toFixed(2));
  }
  // Minha tela com faixa de áudio mas em silêncio há muito tempo: provavelmente o som do jogo
  // está saindo por outro dispositivo, ou o volume do Windows está mudo.
  const minhaFaixa = estado.minhaTela?.getAudioTracks()[0];
  if (minhaFaixa) {
    const nivel = nivelDaFaixa(minhaFaixa) ?? 0;
    if (nivel > NIVEL_MINIMO_SOM) {
      estado.silencioDesde = Date.now();
      if (estado.avisoSom === "silencio") mostrarAvisoSom(null);
    } else if (Date.now() - estado.silencioDesde > SILENCIO_SUSPEITO_MS && !estado.avisoSom) {
      mostrarAvisoSom("silencio");
    }
  }
}

function mostrarAvisoSom(tipo) {
  estado.avisoSom = tipo;
  const el = $("aviso-som");
  mostrar(el, Boolean(tipo));
  if (!tipo) return;
  $("txt-aviso-som").textContent = tipo === "sem-faixa"
    ? "Sua tela está indo SEM SOM. Clique em \"Compartilhar de novo com som\" e, no seletor, escolha \"Tela inteira\" (ou uma aba) e LIGUE a opção \"Compartilhar áudio do sistema\" embaixo da miniatura. Janelas avulsas e o Firefox não mandam som."
    : "Nenhum som saindo da sua tela há 20 segundos. Se era para ter som: confira se o volume do Windows não está mudo e se o jogo toca no dispositivo de saída padrão do Windows (é só dele que o navegador captura).";
}

async function recompartilharComSom() {
  $("com-audio").checked = true;
  gravarLocal("audio-v2", "sim");
  pararCompartilhar();
  await compartilhar();
}
// Navegadores só tocam vídeo com som depois de um clique na página. Normalmente o clique em
// "Entrar na sala" basta; se mesmo assim recusarem, toca sem som e mostra "Ativar som".
function tocar(video) {
  video.play().catch((e) => {
    if (e?.name !== "NotAllowedError" || video.muted) return;
    estado.somBloqueado = true;
    video.muted = true;
    video.play().catch(() => {});
    mostrar($("btn-ativar-som"), true);
  });
}

function ativarSom() {
  estado.somBloqueado = false;
  mostrar($("btn-ativar-som"), false);
  desenharBlocos();
  for (const v of document.querySelectorAll(".bloco video")) if (!v.muted && v.paused && !v.dataset.url) tocar(v);
}

function alternarMudo(chave) {
  if (estado.mudos.has(chave)) estado.mudos.delete(chave); else estado.mudos.add(chave);
  if (estado.somBloqueado) ativarSom(); else desenharBlocos();
}

// ---------- Desenho ----------
function desenharPessoas() {
  const lista = $("lista-pessoas");
  lista.replaceChildren();
  const pessoas = [{ nome: estado.nome, rotulo: estado.nome + " (você)", aoVivo: Boolean(estado.minhaTela) }];
  for (const par of estado.pares.values()) pessoas.push({ nome: par.nome, rotulo: par.nome, aoVivo: par.compartilhando });
  for (const p of pessoas) {
    const el = document.createElement("span");
    el.className = "pessoa" + (p.aoVivo ? " ao-vivo" : "");
    el.append(avatar(p.nome), document.createTextNode(p.rotulo));
    if (p.aoVivo) {
      const selo = document.createElement("span");
      selo.className = "selo vivo";
      selo.textContent = "AO VIVO";
      el.appendChild(selo);
    }
    lista.appendChild(el);
  }
  $("txt-lotacao").textContent = `${pessoas.length}/${estado.maxPorSala}`;
}

function botaoIcone(nomeIcone, titulo, aoClicar) {
  const b = document.createElement("button");
  b.type = "button";
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  b.appendChild(icone(nomeIcone));
  b.addEventListener("click", (e) => { e.stopPropagation(); aoClicar(); });
  return b;
}

function criarBloco(chave) {
  // (o medidor de som fica na legenda; ver atualizarBloco)
  const bloco = document.createElement("div");
  bloco.className = "bloco" + (chave === "eu" ? " minha" : "");
  bloco.dataset.chave = chave;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  // Plano B: se o buffer esvaziou, pausa e deixa alimentarRelay() retomar quando houver folga.
  video.addEventListener("waiting", () => { if (video.dataset.url) video.pause(); });
  const legenda = document.createElement("div");
  legenda.className = "legenda";
  const sobre = document.createElement("div");
  sobre.className = "sobreposicao oculto";
  sobre.addEventListener("click", () => { if (estado.pares.get(chave)?.euPausei) alternarPausa(chave); });
  const acoes = document.createElement("div");
  acoes.className = "acoes-bloco";
  if (chave !== "eu") {
    const som = botaoIcone("som", "Silenciar esta tela", () => alternarMudo(chave));
    som.classList.add("btn-som");
    const b = botaoIcone("pausa", "Pausar esta tela", () => alternarPausa(chave));
    b.classList.add("btn-pausa");
    acoes.append(som, b);
  }
  acoes.append(
    botaoIcone("ampliar", "Destacar", () => { estado.destaque = estado.destaque === chave ? null : chave; desenharBlocos(); }),
    botaoIcone("cheia", "Tela cheia", () => (document.fullscreenElement ? document.exitFullscreen() : bloco.requestFullscreen?.())),
  );
  bloco.append(video, legenda, sobre, acoes);
  return bloco;
}

function atualizarBloco(bloco, d) {
  const video = bloco.querySelector("video");
  // Fonte do vídeo: fluxo WebRTC (srcObject) ou, no plano B, o MediaSource (src).
  if (d.url) {
    if (video.srcObject) video.srcObject = null;
    if (video.dataset.url !== d.url) {
      video.dataset.url = d.url;
      video.autoplay = false; // quem dá o play é alimentarRelay(), quando houver folga
      video.src = d.url;
    }
  } else {
    if (video.dataset.url) { delete video.dataset.url; video.removeAttribute("src"); video.load(); video.autoplay = true; }
    if (video.srcObject !== d.fluxo) {
      video.srcObject = d.fluxo;
      tocar(video);
    }
  }
  // A minha própria tela fica sempre muda aqui: eu já ouço o som no meu PC.
  const mudo = d.eu || estado.mudos.has(bloco.dataset.chave) || estado.somBloqueado;
  if (video.muted !== mudo) video.muted = mudo;
  video.controls = !d.eu && !d.pausado && d.audio; // controle de volume, quando há som

  const btnSom = bloco.querySelector(".btn-som");
  if (btnSom) {
    mostrar(btnSom, Boolean(d.audio));
    const titulo = mudo ? "Ativar o som desta tela" : "Silenciar esta tela";
    btnSom.title = titulo;
    btnSom.setAttribute("aria-label", titulo);
    btnSom.replaceChildren(icone(mudo ? "mudo" : "som"));
  }

  const legenda = bloco.querySelector(".legenda");
  const nome = Object.assign(document.createElement("span"), { className: "nome", textContent: d.rotulo });
  const filhos = [avatar(d.nomeAvatar), nome];
  if (d.selo) filhos.push(Object.assign(document.createElement("span"), { className: "selo " + d.selo.classe, textContent: d.selo.texto, title: d.selo.dica || "" }));
  if (d.resolucao && !d.sobreposicao) {
    filhos.push(Object.assign(document.createElement("span"), {
      className: "selo resolucao", textContent: d.resolucao,
      title: d.eu ? "Resolução e fps que você está capturando" : "Resolução e fps que estão chegando para você agora",
    }));
  }
  // Diz se a tela tem som, para ninguém ficar procurando volume numa tela que foi sem áudio.
  const selo = document.createElement("span");
  selo.className = "selo som" + (d.audio ? "" : " sem");
  selo.title = d.audio ? "Esta tela está com som" : "Esta tela foi compartilhada sem som";
  selo.appendChild(icone(d.audio ? "som" : "mudo"));
  if (d.audio) selo.appendChild(Object.assign(document.createElement("span"), { className: "medidor" }));
  filhos.push(selo);
  legenda.replaceChildren(...filhos);

  bloco.classList.toggle("destaque", estado.destaque === bloco.dataset.chave);

  const sobre = bloco.querySelector(".sobreposicao");
  sobre.replaceChildren();
  sobre.classList.toggle("clicavel", Boolean(d.pausado));
  if (d.sobreposicao) {
    if (d.sobreposicao.girando) sobre.appendChild(Object.assign(document.createElement("div"), { className: "girando" }));
    sobre.appendChild(Object.assign(document.createElement("div"), { className: "titulo", textContent: d.sobreposicao.titulo }));
    if (d.sobreposicao.texto) sobre.appendChild(Object.assign(document.createElement("div"), { textContent: d.sobreposicao.texto }));
  }
  mostrar(sobre, Boolean(d.sobreposicao));

  const btnPausa = bloco.querySelector(".btn-pausa");
  if (btnPausa) {
    const titulo = d.pausado ? "Voltar a assistir" : "Pausar esta tela";
    btnPausa.title = titulo;
    btnPausa.setAttribute("aria-label", titulo);
    btnPausa.replaceChildren(icone(d.pausado ? "play" : "pausa"));
  }
}

function descreverTela(par) {
  const base = { rotulo: par.nome, nomeAvatar: par.nome, eu: false, pausado: par.euPausei, audio: par.temAudio, resolucao: par.qualidadeRecebida };
  if (par.euPausei) {
    return { ...base, sobreposicao: { titulo: "Pausado", texto: "Clique para voltar a assistir" } };
  }
  if (par.relay) {
    if (par.relay.semSuporte) {
      return { ...base, sobreposicao: { titulo: "Não foi possível exibir", texto: "A conexão direta falhou e este navegador não toca o modo via servidor. Tente o Chrome, Edge ou Firefox." } };
    }
    const selo = { classe: "servidor", texto: "via servidor", dica: "Sua rede bloqueou a conexão direta; a tela chega retransmitida (1–2 s de atraso)" };
    if (!par.relay.url) return { ...base, selo, sobreposicao: { girando: true, titulo: "Conectando via servidor…", texto: "A conexão direta não funcionou na sua rede." } };
    return { ...base, selo, url: par.relay.url };
  }
  if (conexaoDiretaOk(par)) return { ...base, fluxo: par.fluxo, selo: { classe: "direto", texto: "direto", dica: "Conexão direta entre os navegadores" } };
  return { ...base, fluxo: par.fluxo, sobreposicao: { girando: true, titulo: "Conectando…", texto: `Recebendo a tela de ${par.nome}` } };
}

function desenharBlocos() {
  const grade = $("grade");
  const desejados = new Map();
  if (estado.minhaTela) {
    desejados.set("eu", { rotulo: "Sua tela", nomeAvatar: estado.nome, fluxo: estado.minhaTela, eu: true,
      audio: estado.minhaTela.getAudioTracks().length > 0,
      resolucao: estado.qualidadeEnviada,
      selo: { classe: "vivo", texto: "AO VIVO" } });
  }
  for (const [id, par] of estado.pares) if (par.compartilhando) desejados.set(id, descreverTela(par));
  if (estado.destaque && !desejados.has(estado.destaque)) estado.destaque = null;
  // Mantém os blocos existentes para o vídeo não piscar a cada atualização.
  for (const bloco of [...grade.children]) {
    if (!desejados.has(bloco.dataset.chave)) bloco.remove();
  }
  for (const [chave, d] of desejados) {
    let bloco = grade.querySelector(`[data-chave="${CSS.escape(chave)}"]`);
    if (!bloco) { bloco = criarBloco(chave); grade.appendChild(bloco); }
    atualizarBloco(bloco, d);
  }
  // O destacado vai para o topo, ocupando a largura toda.
  const destacado = estado.destaque && grade.querySelector(`[data-chave="${CSS.escape(estado.destaque)}"]`);
  if (destacado && grade.firstChild !== destacado) grade.prepend(destacado);
  grade.classList.toggle("muitos", desejados.size >= 4);
  mostrar($("vazio"), desejados.size === 0);
}

// ---------- Inicialização ----------
for (const [chave, q] of Object.entries(QUALIDADES)) {
  const op = document.createElement("option");
  op.value = chave;
  op.textContent = q.nome;
  $("sel-qualidade").appendChild(op);
}
$("sel-qualidade").value = QUALIDADES[lerLocal("qualidade")] ? lerLocal("qualidade") : QUALIDADE_PADRAO;
$("sel-qualidade").addEventListener("change", () => { gravarLocal("qualidade", $("sel-qualidade").value); aplicarQualidadeNaFaixa(); });
for (const mb of UPLOADS_MBPS) {
  const op = document.createElement("option");
  op.value = String(mb);
  op.textContent = mb >= 1000 ? "1 Gbps" : `${mb} Mbps`;
  $("sel-upload").appendChild(op);
}
$("sel-upload").value = UPLOADS_MBPS.includes(Number(lerLocal("upload"))) ? lerLocal("upload") : String(UPLOAD_PADRAO_MBPS);
$("sel-upload").addEventListener("change", () => { gravarLocal("upload", $("sel-upload").value); ajustarQualidade(); });

$("form-entrada").addEventListener("submit", (e) => { e.preventDefault(); mostrar($("erro-entrada"), false); entrar(); });
$("btn-compartilhar").addEventListener("click", compartilhar);
$("btn-ativar-som").addEventListener("click", ativarSom);
// Áudio vem ligado por padrão; quem desligar, fica desligado só para essa pessoa. A chave
// "audio-v2" zera a escolha antiga (de quando o padrão era desligado), para todos voltarem com som.
$("com-audio").checked = lerLocal("audio-v2") !== "nao";
$("com-audio").addEventListener("change", () => {
  gravarLocal("audio-v2", $("com-audio").checked ? "sim" : "nao");
  if (estado.minhaTela) toast("Vale a partir do próximo compartilhamento. Pare e compartilhe de novo para mudar o som.", 4500);
});
$("btn-sair").addEventListener("click", sair);
$("btn-copiar").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.searchParams.delete("so_servidor");
  try {
    await navigator.clipboard.writeText(url.toString());
    toast("Link copiado! Mande para os amigos.");
  } catch {
    prompt("Copie o link:", url.toString());
  }
});
window.addEventListener("beforeunload", () => { estado.saindo = true; estado.ws?.close(); });
setInterval(verificarConexoes, 2000);
setInterval(medirQualidadeRecebida, 2000);
setInterval(atualizarMedidores, 150);
$("btn-recompartilhar").addEventListener("click", recompartilharComSom);
$("btn-fechar-aviso-som").addEventListener("click", () => mostrarAvisoSom(null));

$("campo-nome").value = lerLocal("nome");
$("campo-sala").value = new URLSearchParams(location.search).get("sala") || "";
if (!window.isSecureContext) mostrar($("aviso-seguro"), true);
fetch("/config").then((r) => r.json()).then((c) => {
  mostrar($("rotulo-senha"), c.exigeSenha);
  estado.maxPorSala = c.maxPorSala || estado.maxPorSala;
}).catch(() => {});
