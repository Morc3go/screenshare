"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Única ponte entre o painel e o processo principal: só estas ações existem.
contextBridge.exposeInMainWorld("app", {
  obterEstado: () => ipcRenderer.invoke("obter-estado"),
  copiarLink: () => ipcRenderer.invoke("copiar-link"),
  abrirSala: () => ipcRenderer.invoke("abrir-sala"),
  definirSenha: (senha) => ipcRenderer.invoke("definir-senha", senha),
  definirSala: (sala) => ipcRenderer.invoke("definir-sala", sala),
  reiniciarTunel: () => ipcRenderer.invoke("reiniciar-tunel"),
  atualizar: () => ipcRenderer.invoke("atualizar"),
  aoMudarEstado: (fn) => ipcRenderer.on("estado", (_e, estado) => fn(estado)),
});
