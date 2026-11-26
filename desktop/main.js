// App desktop: ao abrir, liga o servidor e o túnel HTTPS; ao fechar a janela, desliga tudo.
// A janela é só um painel de controle (link para mandar aos amigos, quem está na sala, senha).
// O compartilhamento em si acontece no navegador, que tem o seletor de tela nativo.

"use strict";
const { app, BrowserWindow, ipcMain, shell, clipboard, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { iniciarServidor } = require("../server");
const { Tunel } = require("./tunel");
const { Atualizador } = require("./atualizador");

const PORTA_PREFERIDA = 3000;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let janela = null;
  let servidor = null;
  let tunel = null;
  let erroServidor = null;
  const atualizador = new Atualizador();
  const arquivoConfig = () => path.join(app.getPath("userData"), "config.json");
  let config = { senha: "", sala: "geral" };

  function carregarConfig() {
    try {
      config = { ...config, ...JSON.parse(fs.readFileSync(arquivoConfig(), "utf8")) };
    } catch { /* primeira vez */ }
  }
  function salvarConfig() {
    try {
      fs.mkdirSync(path.dirname(arquivoConfig()), { recursive: true });
      fs.writeFileSync(arquivoConfig(), JSON.stringify(config, null, 2));
    } catch (e) {
      console.warn("Não foi possível salvar a configuração", e);
    }
  }

  function estadoAtual() {
    return {
      portaLocal: servidor?.porta ?? null,
      erroServidor,
      tunel: tunel?.estado ?? { fase: "parado" },
      salas: servidor ? servidor.resumo() : [],
      senha: config.senha,
      sala: config.sala,
      versao: app.getVersion(),
      atualizacao: atualizador.estado,
    };
  }
  function avisarPainel() {
    if (janela && !janela.isDestroyed()) janela.webContents.send("estado", estadoAtual());
  }

  function linkDaSala(base) {
    const sala = (config.sala || "").trim();
    return base + (sala && sala !== "geral" ? "/?sala=" + encodeURIComponent(sala) : "/");
  }

  async function ligar() {
    const opcoes = {
      obterSenha: () => config.senha,
      maxPorSala: 10,
      aoMudarSalas: avisarPainel,
    };
    try {
      servidor = await iniciarServidor({ ...opcoes, porta: PORTA_PREFERIDA });
    } catch {
      // Porta ocupada (outro programa, ou o `node server.js` aberto): usa qualquer porta livre.
      try {
        servidor = await iniciarServidor({ ...opcoes, porta: 0 });
      } catch (e) {
        erroServidor = e.message;
        avisarPainel();
        return;
      }
    }
    tunel = new Tunel(app.getPath("userData"));
    tunel.on("estado", avisarPainel);
    avisarPainel();
    tunel.iniciar(servidor.porta);
  }

  async function desligar() {
    tunel?.parar();
    await servidor?.fechar();
    servidor = null;
  }

  function criarJanela() {
    janela = new BrowserWindow({
      width: 560,
      height: 720,
      minWidth: 420,
      minHeight: 520,
      title: "Compartilha Tela",
      backgroundColor: "#111318",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    janela.loadFile(path.join(__dirname, "painel.html"));
    // Links clicados no painel abrem no navegador padrão, nunca dentro do app.
    janela.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://") || url.startsWith("http://localhost")) shell.openExternal(url);
      return { action: "deny" };
    });
    janela.on("closed", () => { janela = null; });
  }

  ipcMain.handle("obter-estado", () => estadoAtual());
  ipcMain.handle("copiar-link", () => {
    if (tunel?.estado.fase !== "online") return false;
    clipboard.writeText(linkDaSala(tunel.estado.url));
    return true;
  });
  ipcMain.handle("abrir-sala", () => {
    // O dono abre pelo localhost: é contexto seguro, então compartilhar a tela funciona sem túnel.
    if (servidor) shell.openExternal(linkDaSala(`http://localhost:${servidor.porta}`));
  });
  ipcMain.handle("definir-senha", (_e, senha) => {
    config.senha = String(senha || "").slice(0, 100);
    salvarConfig();
    avisarPainel();
  });
  ipcMain.handle("definir-sala", (_e, sala) => {
    config.sala = String(sala || "").trim().slice(0, 40) || "geral";
    salvarConfig();
    avisarPainel();
  });
  ipcMain.handle("reiniciar-tunel", () => tunel?.reiniciar());
  ipcMain.handle("atualizar", () => atualizador.agir());

  app.on("second-instance", () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    carregarConfig();
    criarJanela();
    atualizador.on("estado", avisarPainel);
    atualizador.iniciar();
    await ligar();
  });

  // Fechar a janela encerra tudo (inclusive no macOS, onde o padrão seria continuar aberto):
  // o objetivo é não deixar servidor nem túnel rodando escondidos.
  app.on("window-all-closed", () => app.quit());

  let saindo = false;
  app.on("before-quit", (evento) => {
    if (saindo) return;
    evento.preventDefault();
    saindo = true;
    desligar().finally(() => app.quit());
  });
}
