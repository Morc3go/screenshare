// Peças comuns dos testes: sobe o servidor de verdade (em processo, numa porta livre), abre
// "pessoas" (cada uma é um navegador isolado) e simula a tela compartilhada.
//
// A tela é um <canvas> animado e o som é um oscilador: o resto (WebRTC, codificação, servidor,
// modo via servidor, interface) é o código real do app, rodando num Chromium de verdade.

"use strict";
const { chromium } = require("playwright");
const { iniciarServidor } = require("../server");

async function abrirNavegador() {
  const args = ["--autoplay-policy=no-user-gesture-required"];
  try {
    return await chromium.launch({ args });
  } catch (e) {
    // Ambientes com o Chromium em outro lugar (ex.: imagem com navegadores pré-instalados).
    const fs = require("node:fs");
    if (fs.existsSync("/opt/pw-browsers/chromium")) return chromium.launch({ args, executablePath: "/opt/pw-browsers/chromium" });
    throw e;
  }
}

// Roda dentro da página antes do app: troca o seletor de tela por uma tela simulada e guarda as
// RTCPeerConnection criadas para os testes lerem estatísticas.
function scriptDaTelaSimulada() {
  window.__pcs = [];
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) { const pc = new Original(...a); window.__pcs.push(pc); return pc; };
  window.RTCPeerConnection.prototype = Original.prototype;
  window.__tela = { largura: 1920, altura: 1080, fps: 60, audio: true, volume: 0.25, superficie: "monitor" };
  navigator.mediaDevices.getDisplayMedia = async (opcoes) => {
    window.__pedido = opcoes;
    const t = window.__tela;
    const c = document.createElement("canvas");
    c.width = t.largura; c.height = t.altura;
    const g = c.getContext("2d");
    let i = 0;
    const desenhar = () => {
      i++;
      g.fillStyle = `hsl(${(i * 3) % 360} 55% 35%)`;
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#fff";
      g.font = `bold ${Math.round(c.height / 12)}px sans-serif`;
      g.fillText(`${window.__nome || "tela"} ${i}`, c.width / 20, c.height / 6);
      g.fillStyle = "#ffd166";
      g.fillRect((i * 16) % c.width, c.height / 2, c.height / 8, c.height / 8);
    };
    desenhar();
    setInterval(desenhar, 1000 / t.fps);
    const fluxo = c.captureStream(t.fps);
    const video = fluxo.getVideoTracks()[0];
    const configOriginal = video.getSettings.bind(video);
    video.getSettings = () => ({ ...configOriginal(), displaySurface: t.superficie });
    if (opcoes.audio && t.audio && t.superficie !== "window") {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 440;
      const ganho = ac.createGain();
      ganho.gain.value = t.volume;
      const destino = ac.createMediaStreamDestination();
      osc.connect(ganho).connect(destino);
      osc.start();
      fluxo.addTrack(destino.stream.getAudioTracks()[0]);
    }
    return fluxo;
  };
}

class Ambiente {
  constructor() {
    this.navegador = null;
    this.servidor = null;
    this.porta = 0;
    this.contextos = [];
    this.erros = [];
    this.opcoesServidor = {};
  }

  async iniciar(opcoesServidor = {}) {
    this.opcoesServidor = opcoesServidor;
    this.navegador = await abrirNavegador();
    this.servidor = await iniciarServidor({ porta: 0, ...opcoesServidor });
    this.porta = this.servidor.porta;
    return this;
  }

  // Derruba e sobe o servidor na mesma porta (como o túnel caindo e voltando).
  async reiniciarServidor() {
    await this.servidor.fechar();
    this.servidor = await iniciarServidor({ ...this.opcoesServidor, porta: this.porta });
  }

  url(caminho = "/") { return `http://127.0.0.1:${this.porta}${caminho}`; }

  /** Abre uma pessoa na sala (já entra, a menos que `entrar: false`). */
  async pessoa(nome, { sala = "teste", extra = "", tela = {}, tema = "dark", viewport = { width: 1366, height: 850 }, entrar = true, antes } = {}) {
    const ctx = await this.navegador.newContext({ viewport, colorScheme: tema });
    this.contextos.push(ctx);
    await ctx.addInitScript(scriptDaTelaSimulada);
    await ctx.addInitScript(`window.__nome = ${JSON.stringify(nome)}; Object.assign(window.__tela, ${JSON.stringify(tela)});`);
    if (antes) await ctx.addInitScript(antes);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => this.erros.push(`${nome}: ${e.message}`));
    await p.goto(this.url(`/?sala=${encodeURIComponent(sala)}${extra}`));
    if (entrar) {
      await p.fill("#campo-nome", nome);
      await p.click("button[type=submit]");
      await p.waitForSelector("#tela-sala:not(.oculto)");
    }
    return p;
  }

  async encerrar() {
    for (const c of this.contextos) await c.close().catch(() => {});
    await this.navegador?.close().catch(() => {});
    await this.servidor?.fechar().catch(() => {});
  }
}

// ---------- leituras feitas dentro da página ----------

/** Quantas telas com vídeo de verdade (quadros chegando) a página está mostrando. */
const telasComVideo = (p) => p.evaluate(() => [...document.querySelectorAll(".bloco video")].filter((v) => v.videoWidth > 0).length);

/** Espera até a página mostrar `n` telas com vídeo; devolve quanto tempo levou (ms). */
async function esperarTelas(p, n, timeout = 30000) {
  const t0 = Date.now();
  await p.waitForFunction((k) => [...document.querySelectorAll(".bloco video")].filter((v) => v.videoWidth > 0).length >= k, n, { timeout });
  return Date.now() - t0;
}

/** Estatísticas de vídeo e áudio recebidos por WebRTC (soma de todas as conexões). */
const estatisticasRecebidas = (p) => p.evaluate(async () => {
  const r = { videos: [], audioBytes: 0 };
  for (const pc of window.__pcs) {
    const st = await pc.getStats();
    st.forEach((x) => {
      if (x.type === "inbound-rtp" && x.kind === "video" && x.frameHeight) {
        r.videos.push({ largura: x.frameWidth, altura: x.frameHeight, fps: x.framesPerSecond || 0, quadros: x.framesDecoded, codec: st.get(x.codecId)?.mimeType });
      }
      if (x.type === "inbound-rtp" && x.kind === "audio") r.audioBytes += x.bytesReceived || 0;
    });
  }
  return r;
});

/** Nível (dBFS) do som que chega no primeiro bloco, medido por meio segundo. */
const nivelDoSomRecebido = (p) => p.evaluate(async () => {
  const faixa = document.querySelector(".bloco video").srcObject?.getAudioTracks()[0];
  if (!faixa) return null;
  const ac = new AudioContext();
  const an = ac.createAnalyser();
  an.fftSize = 2048;
  ac.createMediaStreamSource(new MediaStream([faixa])).connect(an);
  await new Promise((r) => setTimeout(r, 600));
  const a = new Float32Array(2048);
  an.getFloatTimeDomainData(a);
  let s = 0;
  for (const x of a) s += x * x;
  await ac.close();
  return 20 * Math.log10(Math.sqrt(s / a.length) || 1e-9);
});

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { Ambiente, telasComVideo, esperarTelas, estatisticasRecebidas, nivelDoSomRecebido, dormir };
