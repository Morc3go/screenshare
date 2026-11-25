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

const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

// orcamento: upload total que a tela pode usar (bits/s), dividido entre quem assiste.
const QUALIDADES = {
  texto:     { nome: "Texto nítido (código, documentos)", altura: 1080, fps: 15, dica: "detail", orcamento: 8e6,  maximo: 2.5e6 },
  equilibrado:{ nome: "Equilibrado",                       altura: 1080, fps: 30, dica: "detail", orcamento: 10e6, maximo: 3e6 },
  movimento: { nome: "Vídeos e jogos (mais fluido)",       altura: 720,  fps: 30, dica: "motion", orcamento: 10e6, maximo: 3e6 },
  leve:      { nome: "Internet fraca",                     altura: 720,  fps: 10, dica: "detail", orcamento: 3e6,  maximo: 1e6 },
};
const BITRATE_MINIMO = 250e3;

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
  pares: new Map(),
  // id -> { pc, nome, polido, criandoOferta, ignorarOferta,
  //         fluxo, compartilhando,          (a tela DELE)
  //         euPausei,                       (eu não quero ver a tela dele)
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
  return QUALIDADES[$("sel-qualidade").value] || QUALIDADES.texto;
}

// ---------- Conexões com os outros ----------
function criarPar(id, nome) {
  if (estado.pares.has(id)) return estado.pares.get(id);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const par = {
    pc, nome, fluxo: null, compartilhando: false, euPausei: false, envios: [], elePausou: false,
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
      sinal("sdp", pc.localDescription, id);
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
  par.envios = estado.minhaTela.getTracks().map((track) => ({ sender: par.pc.addTrack(track, estado.minhaTela), track }));
}

function removerPar(id) {
  const par = estado.pares.get(id);
  if (!par) return;
  par.pc.close();
  estado.pares.delete(id);
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
    sinal("sdp", pc.localDescription, id);
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

// ---------- Qualidade adaptativa ----------
async function ajustarQualidade() {
  const info = $("info-envio");
  if (!estado.minhaTela) { info.textContent = ""; return; }
  const q = qualidadeAtual();
  const recebendo = [...estado.pares.values()].filter((p) => p.envios.length && !p.elePausou);
  const porPessoa = Math.max(BITRATE_MINIMO, Math.min(q.maximo, q.orcamento / Math.max(1, recebendo.length)));

  for (const par of recebendo) {
    for (const { sender, track } of par.envios) {
      if (track.kind !== "video") continue;
      try {
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length) continue; // ainda negociando
        p.encodings[0].maxBitrate = Math.round(porPessoa);
        p.encodings[0].maxFramerate = q.fps;
        await sender.setParameters(p);
      } catch (e) {
        console.warn("Não foi possível ajustar o bitrate", e);
      }
    }
  }
  const n = recebendo.length;
  info.textContent = n === 0
    ? "Ninguém assistindo sua tela agora"
    : `Enviando para ${n} ${n === 1 ? "pessoa" : "pessoas"} · até ${mbps(porPessoa)} cada · ${mbps(porPessoa * n)} no total`;
}

async function aplicarQualidadeNaFaixa() {
  const tela = estado.minhaTela;
  if (!tela) return;
  const q = qualidadeAtual();
  const video = tela.getVideoTracks()[0];
  video.contentHint = q.dica;
  try { await video.applyConstraints({ height: { max: q.altura }, frameRate: { max: q.fps } }); } catch { /* nem todo navegador aceita */ }
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
      estado.meuId = id;
      for (const p of participantes) {
        const par = criarPar(p.id, p.nome);
        par.compartilhando = p.compartilhando;
      }
      if (estado.minhaTela) sinal("estado", { compartilhando: true });
      mostrar($("aviso-conexao"), false);
      abrirSala();
    },
    entrou({ id, nome }) {
      criarPar(id, nome);
      if (estado.minhaTela) sinal("estado", { compartilhando: true }, id);
      desenharPessoas();
    },
    saiu({ id }) { removerPar(id); },
    async sinal({ de, tipo, dados }) {
      if (tipo === "sdp") await tratarSdp(de, dados);
      else if (tipo === "ice") await tratarIce(de, dados);
      else if (tipo === "assistir") await tratarPedidoAssistir(de, Boolean(dados && dados.ativo));
      else if (tipo === "estado") {
        const par = estado.pares.get(de);
        if (!par) return;
        par.compartilhando = Boolean(dados && dados.compartilhando);
        if (!par.compartilhando) par.euPausei = false; // próxima vez começa assistindo
        desenharPessoas();
        desenharBlocos();
      }
    },
  };

  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    try { await ao[msg.evento]?.(msg); } catch (e) { console.warn("Erro ao tratar mensagem", e); }
  };
  ws.onclose = () => {
    if (estado.ws !== ws || estado.saindo || recusado) return;
    if (!entrou && !reconectando) { erroEntrada("Não foi possível conectar ao servidor."); return; }
    // Estava na sala: avisa e tenta de novo. As conexões de vídeo diretas podem até continuar vivas,
    // mas sem sinalização ninguém novo consegue entrar, então refazemos tudo.
    mostrar($("aviso-conexao"), true);
    setTimeout(() => { if (!estado.saindo && estado.ws === ws) conectar(true); }, 2000);
  };
}

function abrirSala() {
  $("txt-sala").textContent = estado.sala;
  const url = new URL(location.href);
  url.search = "?sala=" + encodeURIComponent(estado.sala);
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
  mostrar($("aviso-conexao"), false);
  for (const id of [...estado.pares.keys()]) removerPar(id);
  mostrar($("tela-sala"), false);
  mostrar($("tela-entrada"), true);
}

// ---------- Compartilhar ----------
async function compartilhar() {
  if (estado.minhaTela) return pararCompartilhar();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    alert("Este navegador não deixa compartilhar a tela aqui. Use Chrome, Edge ou Firefox no computador, e abra o site pelo link HTTPS (ou localhost).");
    return;
  }
  const q = qualidadeAtual();
  let tela;
  try {
    tela = await navigator.mediaDevices.getDisplayMedia({
      video: { height: { max: q.altura }, frameRate: { max: q.fps } },
      audio: $("com-audio").checked,
    });
  } catch {
    return; // cancelou a escolha
  }
  estado.minhaTela = tela;
  tela.getVideoTracks()[0].contentHint = q.dica;
  // O botão "Parar compartilhamento" do próprio navegador encerra a faixa.
  tela.getVideoTracks()[0].addEventListener("ended", pararCompartilhar);
  for (const par of estado.pares.values()) { par.elePausou = false; enviarTelaPara(par); }
  sinal("estado", { compartilhando: true });
  $("btn-compartilhar").textContent = "Parar de compartilhar";
  $("btn-compartilhar").classList.add("perigo");
  desenharPessoas();
  desenharBlocos();
  ajustarQualidade();
}

function pararCompartilhar() {
  const tela = estado.minhaTela;
  if (!tela) return;
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
  sinal("estado", { compartilhando: false });
  $("btn-compartilhar").textContent = "Compartilhar minha tela";
  $("btn-compartilhar").classList.remove("perigo");
  desenharPessoas();
  desenharBlocos();
  ajustarQualidade();
}

function alternarPausa(id) {
  const par = estado.pares.get(id);
  if (!par) return;
  par.euPausei = !par.euPausei;
  sinal("assistir", { ativo: !par.euPausei }, id);
  desenharBlocos();
}

// ---------- Desenho ----------
function desenharPessoas() {
  const lista = $("lista-pessoas");
  lista.replaceChildren();
  const pessoas = [{ nome: estado.nome + " (você)", aoVivo: Boolean(estado.minhaTela) }];
  for (const par of estado.pares.values()) pessoas.push({ nome: par.nome, aoVivo: par.compartilhando });
  for (const p of pessoas) {
    const el = document.createElement("span");
    el.className = "pessoa" + (p.aoVivo ? " ao-vivo" : "");
    el.textContent = p.nome;
    lista.appendChild(el);
  }
  $("txt-lotacao").textContent = `${pessoas.length}/${estado.maxPorSala}`;
}

function botao(texto, aoClicar) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = texto;
  b.addEventListener("click", (e) => { e.stopPropagation(); aoClicar(); });
  return b;
}

function criarBloco(chave) {
  const bloco = document.createElement("div");
  bloco.className = "bloco";
  bloco.dataset.chave = chave;
  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  const etiqueta = document.createElement("div");
  etiqueta.className = "rotulo";
  const pausado = document.createElement("div");
  pausado.className = "pausado";
  const acoes = document.createElement("div");
  acoes.className = "acoes-bloco";
  const btnPausa = botao("Pausar", () => alternarPausa(chave));
  btnPausa.classList.add("btn-pausa");
  if (chave === "eu") btnPausa.classList.add("oculto");
  acoes.append(
    btnPausa,
    botao("Destacar", () => { estado.destaque = estado.destaque === chave ? null : chave; desenharBlocos(); }),
    botao("Tela cheia", () => (document.fullscreenElement ? document.exitFullscreen() : bloco.requestFullscreen?.())),
  );
  pausado.addEventListener("click", () => { if (estado.pares.get(chave)?.euPausei) alternarPausa(chave); });
  bloco.append(video, etiqueta, pausado, acoes);
  return bloco;
}

function atualizarBloco(bloco, d) {
  const video = bloco.querySelector("video");
  if (video.srcObject !== d.fluxo) {
    video.srcObject = d.fluxo;
    video.muted = d.eu;
    video.controls = !d.eu; // dá a quem assiste o controle de volume do áudio compartilhado
    video.play().catch(() => {});
  }
  bloco.querySelector(".rotulo").textContent = d.rotulo;
  bloco.classList.toggle("destaque", estado.destaque === bloco.dataset.chave);
  const pausado = bloco.querySelector(".pausado");
  pausado.textContent = d.pausado ? "Pausado — clique para voltar a assistir" : d.conectando ? "Conectando…" : "";
  mostrar(pausado, d.pausado || d.conectando);
  bloco.querySelector(".btn-pausa").textContent = d.pausado ? "Assistir" : "Pausar";
}

function desenharBlocos() {
  const grade = $("grade");
  const desejados = new Map();
  if (estado.minhaTela) desejados.set("eu", { rotulo: "Sua tela", fluxo: estado.minhaTela, eu: true });
  for (const [id, par] of estado.pares) {
    if (!par.compartilhando) continue;
    desejados.set(id, {
      rotulo: par.nome, fluxo: par.fluxo, eu: false, pausado: par.euPausei,
      conectando: !par.euPausei && (!par.fluxo || par.pc.connectionState !== "connected"),
    });
  }
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
$("sel-qualidade").value = QUALIDADES[lerLocal("qualidade")] ? lerLocal("qualidade") : "texto";
$("sel-qualidade").addEventListener("change", () => { gravarLocal("qualidade", $("sel-qualidade").value); aplicarQualidadeNaFaixa(); });

$("form-entrada").addEventListener("submit", (e) => { e.preventDefault(); mostrar($("erro-entrada"), false); entrar(); });
$("btn-compartilhar").addEventListener("click", compartilhar);
$("btn-sair").addEventListener("click", sair);
$("btn-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $("btn-copiar").textContent = "Link copiado!";
  } catch {
    prompt("Copie o link:", location.href);
  }
  setTimeout(() => ($("btn-copiar").textContent = "Copiar link"), 1500);
});
window.addEventListener("beforeunload", () => { estado.saindo = true; estado.ws?.close(); });

$("campo-nome").value = lerLocal("nome");
$("campo-sala").value = new URLSearchParams(location.search).get("sala") || "";
if (!window.isSecureContext) mostrar($("aviso-seguro"), true);
fetch("/config").then((r) => r.json()).then((c) => {
  mostrar($("rotulo-senha"), c.exigeSenha);
  estado.maxPorSala = c.maxPorSala || estado.maxPorSala;
}).catch(() => {});
