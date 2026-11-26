// Servidor de sinalização + arquivos estáticos.
//
// O vídeo NÃO passa por aqui: os navegadores se conectam direto (WebRTC).
// O servidor só repassa, por WebSocket, as mensagens de combinação (offer/answer/ICE) entre eles.
//
// Pode ser usado de dois jeitos:
//   - linha de comando:  node server.js
//   - como módulo (o app desktop usa assim):  require("./server").iniciarServidor({...})

"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PASTA_PUBLICA = path.join(__dirname, "public");
const LIMITE_MENSAGEM = 64 * 1024;      // mensagens de texto: um SDP com vários candidatos cabe folgado
const LIMITE_BINARIO = 4 * 1024 * 1024;  // um pedaço de vídeo retransmitido
const LIMITE_ATRASO = 8 * 1024 * 1024;   // fila máxima por assinante antes de cortar
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function limpar(texto, max) {
  return String(texto || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

/**
 * @param {object} opcoes
 * @param {number} [opcoes.porta=3000]  0 escolhe uma porta livre
 * @param {() => string} [opcoes.obterSenha]  lida a cada conexão, então pode mudar com o servidor ligado
 * @param {number} [opcoes.maxPorSala=10]
 * @param {(texto: string) => void} [opcoes.log]
 * @param {() => void} [opcoes.aoMudarSalas]  avisado quando alguém entra, sai ou começa/para de compartilhar
 */
function iniciarServidor(opcoes = {}) {
  const obterSenha = opcoes.obterSenha || (() => "");
  const maxPorSala = opcoes.maxPorSala || 10;
  const log = opcoes.log || (() => {});
  const aoMudarSalas = opcoes.aoMudarSalas || (() => {});

  /** salas: Map<nomeSala, Map<idParticipante, { ws, nome, compartilhando, vivo }>> */
  const salas = new Map();

  function senhaOk(recebida) {
    const senha = obterSenha();
    if (!senha) return true;
    const a = Buffer.from(String(recebida || ""));
    const b = Buffer.from(senha);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function enviar(ws, evento, dados) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ evento, ...dados }));
  }

  function participantes(sala) {
    return [...sala.entries()].map(([id, p]) => ({ id, nome: p.nome, compartilhando: p.compartilhando }));
  }

  function avisarTodos(sala, evento, dados, excetoId) {
    for (const [id, p] of sala) if (id !== excetoId) enviar(p.ws, evento, dados);
  }

  function servirEstatico(req, res, url) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel === "/") rel = "/index.html";
    const arquivo = path.normalize(path.join(PASTA_PUBLICA, rel));
    if (!arquivo.startsWith(PASTA_PUBLICA + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(arquivo, (err, conteudo) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Não encontrado");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(conteudo);
    });
  }

  // Conexão WebSocket em /ws?sala=&nome=&senha=  -> registra o participante.
  // (WebSocket em vez de Server-Sent Events porque o túnel gratuito da Cloudflare não repassa SSE.)
  //
  // Mensagens do navegador: { tipo, para?, dados }
  //   com `para`: repassa só para esse participante (offer/answer/ICE/pedido de pausa)
  //   sem `para`: avisa a sala inteira (ex.: começou/parou de compartilhar)
  function aoConectar(ws, url) {
    // Recusas chegam como mensagem antes do fechamento, para o navegador mostrar o motivo.
    const recusar = (motivo) => {
      enviar(ws, "recusado", { motivo });
      ws.close(4000, motivo);
    };
    if (!senhaOk(url.searchParams.get("senha"))) return recusar("senha");

    const nomeSala = limpar(url.searchParams.get("sala"), 40) || "geral";
    const nome = limpar(url.searchParams.get("nome"), 30) || "Anônimo";
    const sala = salas.get(nomeSala) || new Map();
    if (sala.size >= maxPorSala) return recusar("cheia");

    const id = crypto.randomUUID();
    salas.set(nomeSala, sala);
    enviar(ws, "bem-vindo", { id, participantes: participantes(sala), maxPorSala });
    // assinantes: quem recebe a tela deste participante retransmitida pelo servidor (ver abaixo).
    const eu = { ws, nome, compartilhando: false, vivo: true, assinantes: new Set() };
    sala.set(id, eu);
    avisarTodos(sala, "entrou", { id, nome }, id);
    log(`+ ${nome} entrou em "${nomeSala}" (${sala.size}/${maxPorSala})`);
    aoMudarSalas();

    ws.on("pong", () => { eu.vivo = true; });
    const prefixoId = Buffer.from(id, "ascii"); // 36 bytes

    ws.on("message", (bruto, binario) => {
      // Mensagem binária = pedaço de vídeo da tela deste participante, para os que não conseguiram
      // conexão direta (CGNAT, 4G, firewall). O servidor repassa a cada assinante, prefixando o
      // id de quem compartilha para o navegador saber de quem é.
      if (binario) {
        for (const idAssinante of eu.assinantes) {
          const destino = sala.get(idAssinante);
          if (!destino) { eu.assinantes.delete(idAssinante); continue; }
          // Quem não dá conta de baixar não pode encher a memória do servidor: corta e avisa,
          // o navegador dele pede de novo e recomeça de um quadro-chave.
          if (destino.ws.bufferedAmount > LIMITE_ATRASO) {
            eu.assinantes.delete(idAssinante);
            enviar(destino.ws, "sinal", { de: id, tipo: "relay-atrasado", dados: {} });
            continue;
          }
          destino.ws.send(Buffer.concat([prefixoId, bruto]), { binary: true });
        }
        return;
      }
      if (bruto.length > LIMITE_MENSAGEM) return;
      let msg;
      try {
        msg = JSON.parse(bruto.toString("utf8"));
      } catch {
        return;
      }
      const tipo = limpar(msg.tipo, 20);
      if (msg.para) {
        const destino = sala.get(msg.para);
        if (!destino) return;
        if (tipo === "relay") {
          // Pedido para receber a tela de `para` pelo servidor (ou parar de receber).
          if (msg.dados && msg.dados.ativo) destino.assinantes.add(id);
          else destino.assinantes.delete(id);
        }
        enviar(destino.ws, "sinal", { de: id, tipo, dados: msg.dados });
      } else {
        if (tipo === "estado") {
          eu.compartilhando = Boolean(msg.dados && msg.dados.compartilhando);
          aoMudarSalas();
        }
        avisarTodos(sala, "sinal", { de: id, tipo, dados: msg.dados }, id);
      }
    });
    ws.on("close", () => {
      sala.delete(id);
      for (const outro of sala.values()) outro.assinantes.delete(id);
      avisarTodos(sala, "saiu", { id });
      if (sala.size === 0 && salas.get(nomeSala) === sala) salas.delete(nomeSala);
      log(`- ${nome} saiu de "${nomeSala}" (${sala.size}/${maxPorSala})`);
      aoMudarSalas();
    });
  }

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/config") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      return res.end(JSON.stringify({ exigeSenha: Boolean(obterSenha()), maxPorSala }));
    }
    if (req.method === "GET") return servirEstatico(req, res, url);
    res.writeHead(405).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITE_BINARIO });
  servidor.on("upgrade", (req, socket, cabeca) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws") return socket.destroy();
    wss.handleUpgrade(req, socket, cabeca, (ws) => aoConectar(ws, url));
  });

  // Ping periódico: mantém a conexão viva atrás de túneis que fecham conexões ociosas
  // e derruba quem sumiu sem fechar (rede caiu, notebook dormiu).
  const pulso = setInterval(() => {
    for (const sala of salas.values()) {
      for (const p of sala.values()) {
        if (!p.vivo) { p.ws.terminate(); continue; }
        p.vivo = false;
        p.ws.ping();
      }
    }
  }, 20000);

  function resumo() {
    return [...salas.entries()].map(([sala, mapa]) => ({
      sala,
      pessoas: [...mapa.values()].map((p) => ({ nome: p.nome, compartilhando: p.compartilhando })),
    }));
  }

  function fechar() {
    return new Promise((resolve) => {
      clearInterval(pulso);
      for (const sala of salas.values()) for (const p of sala.values()) p.ws.terminate();
      salas.clear();
      wss.close();
      servidor.close(() => resolve());
      servidor.closeAllConnections?.();
    });
  }

  return new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(opcoes.porta ?? 3000, () => {
      servidor.off("error", reject);
      resolve({ porta: servidor.address().port, fechar, resumo });
    });
  });
}

module.exports = { iniciarServidor };

// Uso por linha de comando.
if (require.main === module) {
  const senha = process.env.SENHA || "";
  const hora = () => new Date().toLocaleTimeString("pt-BR");
  iniciarServidor({
    porta: Number(process.env.PORTA || process.env.PORT || 3000),
    obterSenha: () => senha,
    maxPorSala: Number(process.env.MAX_POR_SALA || 10),
    log: (t) => console.log(`[${hora()}] ${t}`),
  }).then(({ porta }) => {
    console.log(`\nCompartilha Tela rodando em http://localhost:${porta}`);
    console.log(senha ? "Senha de acesso: ativada" : "Senha de acesso: desativada (defina SENHA=... para ativar)");
    console.log("Para os amigos acessarem pela internet, abra um túnel HTTPS (veja o README).\n");
  }).catch((e) => {
    console.error("Não foi possível iniciar:", e.message);
    process.exit(1);
  });
}
