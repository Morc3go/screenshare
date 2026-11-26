// Túnel HTTPS gratuito da Cloudflare ("quick tunnel"): não precisa de conta nem de abrir porta
// no roteador. O `cloudflared` cria um endereço https://<palavras>.trycloudflare.com que
// encaminha para o servidor local. HTTPS é obrigatório: sem ele o navegador dos amigos não
// deixa compartilhar a tela.
//
// O executável é procurado no PATH; se não existir, é baixado uma vez da página oficial de
// releases da Cloudflare no GitHub e guardado na pasta de dados do app.

"use strict";
const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download/";

function nomeDoArquivo() {
  const { platform, arch } = process;
  if (platform === "win32") return arch === "ia32" ? "cloudflared-windows-386.exe" : "cloudflared-windows-amd64.exe";
  if (platform === "darwin") return arch === "arm64" ? "cloudflared-darwin-arm64.tgz" : "cloudflared-darwin-amd64.tgz";
  if (platform === "linux") return { arm64: "cloudflared-linux-arm64", arm: "cloudflared-linux-arm" }[arch] || "cloudflared-linux-amd64";
  throw new Error("Sistema não suportado: " + platform);
}

function testarExecutavel(caminho) {
  return new Promise((resolve) => {
    execFile(caminho, ["--version"], { timeout: 10000, windowsHide: true }, (err) => resolve(!err));
  });
}

function baixar(url, destino, aoProgresso, redirecionamentos = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "compartilha-tela" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirecionamentos > 5) return reject(new Error("Redirecionamentos demais"));
        return resolve(baixar(new URL(res.headers.location, url).toString(), destino, aoProgresso, redirecionamentos + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("Download falhou: HTTP " + res.statusCode));
      }
      const total = Number(res.headers["content-length"]) || 0;
      let recebido = 0;
      const temporario = destino + ".baixando";
      const arquivo = fs.createWriteStream(temporario);
      res.on("data", (c) => {
        recebido += c.length;
        if (total) aoProgresso(Math.round((recebido / total) * 100));
      });
      res.pipe(arquivo);
      arquivo.on("finish", () => arquivo.close(() => {
        fs.renameSync(temporario, destino);
        resolve();
      }));
      arquivo.on("error", reject);
    }).on("error", reject);
  });
}

async function obterExecutavel(pastaDados, aoProgresso) {
  // 1) O que vem dentro do instalador (Windows): evita baixar um executável na primeira vez,
  //    comportamento que antivírus costumam estranhar.
  if (process.resourcesPath) {
    const embutido = path.join(process.resourcesPath, "bin", process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
    if (fs.existsSync(embutido) && (await testarExecutavel(embutido))) return embutido;
  }
  // 2) Um cloudflared já instalado no PC. 3) Baixar da página oficial da Cloudflare.
  if (await testarExecutavel("cloudflared")) return "cloudflared";

  const pasta = path.join(pastaDados, "bin");
  const exe = path.join(pasta, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(exe) && (await testarExecutavel(exe))) return exe;

  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = nomeDoArquivo();
  if (arquivo.endsWith(".tgz")) {
    const tgz = path.join(pasta, arquivo);
    await baixar(BASE + arquivo, tgz, aoProgresso);
    await new Promise((resolve, reject) =>
      execFile("tar", ["-xzf", tgz, "-C", pasta], (err) => (err ? reject(err) : resolve())));
    fs.rmSync(tgz, { force: true });
  } else {
    await baixar(BASE + arquivo, exe, aoProgresso);
  }
  if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
  if (!(await testarExecutavel(exe))) throw new Error("O cloudflared baixado não executou");
  return exe;
}

/**
 * Emite "estado" com { fase: "baixando"|"conectando"|"online"|"erro"|"parado", url?, progresso?, erro? }
 */
class Tunel extends EventEmitter {
  constructor(pastaDados) {
    super();
    this.pastaDados = pastaDados;
    this.processo = null;
    this.porta = null;
    this.parando = false;
    this.tentativas = 0;
    this.estado = { fase: "parado" };
  }

  mudar(estado) {
    this.estado = estado;
    this.emit("estado", estado);
  }

  async iniciar(porta) {
    this.porta = porta;
    this.parando = false;
    let exe;
    try {
      exe = await obterExecutavel(this.pastaDados, (progresso) => this.mudar({ fase: "baixando", progresso }));
    } catch (e) {
      this.mudar({ fase: "erro", erro: "Não foi possível obter o cloudflared: " + e.message });
      return;
    }
    if (this.parando) return;
    this.mudar({ fase: "conectando" });

    const proc = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${porta}`], { windowsHide: true });
    this.processo = proc;
    let urlEncontrada = null;
    const lerSaida = (pedaco) => {
      const m = pedaco.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !urlEncontrada) {
        urlEncontrada = m[0];
        this.tentativas = 0;
        this.mudar({ fase: "online", url: urlEncontrada });
      }
    };
    proc.stdout.on("data", lerSaida);
    proc.stderr.on("data", lerSaida); // o cloudflared escreve o endereço no stderr
    proc.on("error", (e) => this.mudar({ fase: "erro", erro: e.message }));
    proc.on("exit", () => {
      if (this.processo === proc) this.processo = null;
      if (this.parando) return;
      // Caiu sozinho (internet oscilou): tenta de novo algumas vezes, esperando cada vez mais.
      this.tentativas += 1;
      if (this.tentativas > 5) {
        this.mudar({ fase: "erro", erro: "O túnel caiu várias vezes seguidas. Verifique sua internet e clique em Reiniciar túnel." });
        return;
      }
      this.mudar({ fase: "conectando" });
      setTimeout(() => { if (!this.parando && !this.processo) this.iniciar(this.porta); }, 2000 * this.tentativas);
    });
  }

  parar() {
    this.parando = true;
    if (this.processo) this.processo.kill();
    this.processo = null;
    this.mudar({ fase: "parado" });
  }

  async reiniciar() {
    this.parar();
    this.tentativas = 0;
    await this.iniciar(this.porta);
  }
}

module.exports = { Tunel };
