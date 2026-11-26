// Atualização automática a partir das Releases do GitHub (Morc3go/screenshare).
//
// - Windows (instalador) e Linux (AppImage): baixa a versão nova em segundo plano e instala
//   ao fechar o app, ou na hora se a pessoa clicar em "Reiniciar e atualizar".
// - Windows portátil e macOS: não dá para se substituir sozinho (o portátil é um .exe avulso e o
//   macOS exige app assinado), então só avisa e abre a página de download.

"use strict";
const { app, shell } = require("electron");
const { EventEmitter } = require("node:events");

const PAGINA_RELEASES = "https://github.com/Morc3go/screenshare/releases/latest";
const INTERVALO_VERIFICACAO_MS = 4 * 60 * 60 * 1000;

class Atualizador extends EventEmitter {
  constructor() {
    super();
    // fase: "desligado" | "verificando" | "atualizado" | "baixando" | "pronto" | "disponivel" | "erro"
    this.estado = { fase: "desligado" };
    this.automatico = process.platform !== "darwin" && !process.env.PORTABLE_EXECUTABLE_FILE;
    this.autoUpdater = null;
  }

  mudar(estado) {
    this.estado = estado;
    this.emit("estado", estado);
  }

  iniciar() {
    // Rodando pelo código (npm run app) não há instalação para atualizar.
    if (!app.isPackaged) return;
    const { autoUpdater } = require("electron-updater");
    this.autoUpdater = autoUpdater;
    autoUpdater.autoDownload = this.automatico;
    autoUpdater.autoInstallOnAppQuit = this.automatico;
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => {
      if (!["baixando", "pronto"].includes(this.estado.fase)) this.mudar({ fase: "verificando" });
    });
    autoUpdater.on("update-not-available", () => this.mudar({ fase: "atualizado" }));
    autoUpdater.on("update-available", (info) => {
      this.mudar(this.automatico
        ? { fase: "baixando", versao: info.version, progresso: 0 }
        : { fase: "disponivel", versao: info.version });
    });
    autoUpdater.on("download-progress", (p) => {
      this.mudar({ fase: "baixando", versao: this.estado.versao, progresso: Math.round(p.percent) });
    });
    autoUpdater.on("update-downloaded", (info) => this.mudar({ fase: "pronto", versao: info.version }));
    autoUpdater.on("error", (e) => {
      // Sem internet ou GitHub fora do ar: não atrapalha o uso, só tenta de novo depois.
      if (this.estado.fase !== "pronto") this.mudar({ fase: "erro", erro: e?.message || String(e) });
    });

    const verificar = () => autoUpdater.checkForUpdates().catch(() => {});
    verificar();
    setInterval(verificar, INTERVALO_VERIFICACAO_MS).unref();
  }

  // Botão do painel: instala agora (modo automático) ou abre a página de download.
  agir() {
    if (this.estado.fase === "pronto" && this.autoUpdater) {
      // isSilent=false mostra o progresso do instalador; isForceRunAfter=true reabre o app.
      setImmediate(() => this.autoUpdater.quitAndInstall(false, true));
      return;
    }
    shell.openExternal(PAGINA_RELEASES);
  }
}

module.exports = { Atualizador };
