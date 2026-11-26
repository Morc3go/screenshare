// Cenários de teste. Cada um sobe um ambiente limpo (servidor + navegadores) e usa:
//   t.verificar(condição, "o que deveria acontecer", valorObservado)
//   t.medir("nome", valor, "unidade")   (entra no relatório)

"use strict";
const os = require("node:os");
const { WebSocket } = require("ws");
const { Ambiente, esperarTelas, estatisticasRecebidas, nivelDoSomRecebido, dormir } = require("./ajudantes");

const melhorVideo = (st) => st.videos.sort((a, b) => b.altura - a.altura)[0];

module.exports = [
  {
    nome: "Compartilhar e assistir (conexão direta)",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana");
      const bia = await amb.pessoa("Bia");
      const t0 = Date.now();
      await ana.click("#btn-compartilhar");
      await esperarTelas(bia, 1, 15000);
      t.medir("Tempo até a primeira imagem (direto)", Date.now() - t0, "ms");
      await dormir(6000);
      const v = melhorVideo(await estatisticasRecebidas(bia));
      t.medir("Resolução recebida (Full HD, 1 pessoa)", `${v.largura}×${v.altura}`);
      t.medir("FPS recebido (Full HD, 1 pessoa)", Math.round(v.fps), "fps");
      t.medir("Codec", v.codec);
      t.verificar(v.altura >= 720, "chega pelo menos em 720p", `${v.altura}p`);
      t.verificar(v.fps >= 25, "chega com pelo menos 25 fps", `${Math.round(v.fps)} fps`);
      t.verificar(await bia.isVisible(".selo.direto"), "a tela mostra o selo 'direto'");
      t.verificar(/1080p|720p/.test(await bia.textContent(".selo.resolucao")), "o selo mostra a resolução real", await bia.textContent(".selo.resolucao"));
      await ana.click("#btn-compartilhar");
      await bia.waitForFunction(() => !document.querySelector(".bloco"), null, { timeout: 8000 });
      t.verificar(true, "parar de compartilhar some com a tela para os outros");
    },
  },

  {
    nome: "Modo via servidor (rede que bloqueia conexão direta)",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana");
      const bia = await amb.pessoa("Bia", { extra: "&so_servidor=1" });
      const t0 = Date.now();
      await ana.click("#btn-compartilhar");
      await bia.waitForFunction(() => { const v = document.querySelector(".bloco video"); return v && v.videoWidth > 0 && v.currentTime > 0; }, null, { timeout: 40000 });
      t.medir("Tempo até a primeira imagem (via servidor, inclui 7 s de espera da direta)", Date.now() - t0, "ms");
      t.verificar(await bia.isVisible(".selo.servidor"), "a tela mostra o selo 'via servidor'");
      await bia.evaluate(() => { window.__travas = 0; document.querySelector(".bloco video").addEventListener("waiting", () => window.__travas++); });
      const c1 = await bia.evaluate(() => document.querySelector(".bloco video").currentTime);
      await dormir(6000);
      const r = await bia.evaluate(() => { const v = document.querySelector(".bloco video"); return { t: v.currentTime, atraso: v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : -1, travas: window.__travas, altura: v.videoHeight, som: v.webkitAudioDecodedByteCount }; });
      t.medir("Atraso do modo via servidor (buffer)", r.atraso.toFixed(2), "s");
      t.medir("Travadas do player em 6 s (via servidor)", r.travas);
      t.medir("Resolução via servidor", `${r.altura}p`);
      t.verificar(r.t - c1 > 4, "o vídeo anda (mais de 4 s de vídeo em 6 s)", `${(r.t - c1).toFixed(1)} s`);
      t.verificar(r.atraso < 3.5, "atraso abaixo de 3,5 s", `${r.atraso.toFixed(2)} s`);
      t.verificar(r.som > 0, "o som também chega via servidor", `${r.som} bytes`);
      t.verificar(r.travas <= 3, "o player quase não trava (no máximo 3 vezes em 6 s)", r.travas);
    },
  },

  {
    nome: "Sala cheia: 10 pessoas, 3 compartilhando",
    async rodar(t) {
      const amb = await t.ambiente();
      const nomes = ["Ana", "Bia", "Caio", "Duda", "Edu", "Fê", "Gui", "Hugo", "Iris", "João"];
      const t0 = Date.now();
      const ps = [];
      for (const n of nomes) ps.push(await amb.pessoa(n, { viewport: { width: 1000, height: 700 } }));
      t.medir("Tempo para 10 pessoas entrarem", Date.now() - t0, "ms");
      t.verificar((await ps[9].textContent("#txt-lotacao")) === "10/10", "a sala mostra 10/10", await ps[9].textContent("#txt-lotacao"));
      const extra = await amb.pessoa("Extra", { entrar: false });
      await extra.fill("#campo-nome", "Extra");
      await extra.click("button[type=submit]");
      await extra.waitForSelector("#erro-entrada:not(.oculto)");
      t.verificar(/cheia/.test(await extra.textContent("#erro-entrada")), "a 11ª pessoa é recusada com 'sala cheia'");
      const t1 = Date.now();
      for (const i of [0, 1, 2]) await ps[i].click("#btn-compartilhar");
      await Promise.all([3, 6, 9].map((i) => esperarTelas(ps[i], 3, 45000)));
      t.medir("Tempo até 3 telas aparecerem para quem assiste (10 na sala)", Date.now() - t1, "ms");
      t.verificar(true, "quem assiste vê as 3 telas");
      await ps[0].close();
      await ps[3].waitForFunction(() => document.querySelectorAll(".bloco").length === 2, null, { timeout: 10000 });
      t.verificar(true, "quando alguém sai, a tela dele some para os outros");
    },
  },

  {
    nome: "Som",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana", { tela: { volume: 0.05 } });
      const bia = await amb.pessoa("Bia");
      t.verificar(await ana.$eval("#com-audio", (c) => c.checked), "'Incluir áudio' vem ligado");
      t.verificar(await ana.$eval("#reforcar-volume", (c) => c.checked), "'Reforçar volume' vem ligado");
      await ana.click("#btn-compartilhar");
      await esperarTelas(bia, 1);
      await dormir(2500);
      const a1 = (await estatisticasRecebidas(bia)).audioBytes; await dormir(3000); const a2 = (await estatisticasRecebidas(bia)).audioBytes;
      const kbps = Math.round(((a2 - a1) * 8) / 3000);
      t.medir("Bitrate do som (direto)", kbps, "kbps");
      t.verificar(kbps >= 96, "som em qualidade de música (≥ 96 kbps)", `${kbps} kbps`);
      const com = await nivelDoSomRecebido(bia);
      await ana.click("#reforcar-volume", { force: true });
      await dormir(1500);
      const sem = await nivelDoSomRecebido(bia);
      await ana.click("#reforcar-volume", { force: true });
      t.medir("Som baixo (−29 dB) com reforço", com.toFixed(1), "dB");
      t.medir("Ganho do 'Reforçar volume'", (com - sem).toFixed(1), "dB");
      t.verificar(com - sem >= 10, "o reforço aumenta o som baixo em pelo menos 10 dB", `${(com - sem).toFixed(1)} dB`);
      t.verificar(com < -0.5, "o reforço não estoura (abaixo de 0 dB)", `${com.toFixed(1)} dB`);
      // mudo e volume continuam como a pessoa deixou, mesmo com o site redesenhando
      await bia.hover(".bloco");
      await bia.click(".btn-som");
      await dormir(5000);
      t.verificar(await bia.$eval(".bloco video", (v) => v.muted), "silenciar uma tela continua valendo depois de vários redesenhos");
      await bia.$eval(".volume", (el) => { el.value = "0.3"; el.dispatchEvent(new Event("input")); });
      await dormir(4000);
      const v = await bia.$eval(".bloco video", (x) => ({ m: x.muted, vol: x.volume }));
      t.verificar(!v.m && Math.abs(v.vol - 0.3) < 0.01, "a barra de volume tira o mudo e o volume fica em 30%", JSON.stringify(v));
      t.verificar(!(await bia.$eval(".bloco video", (x) => x.controls)), "sem o player nativo (um controle de som só)");
      t.verificar((await bia.getAttribute(".selo.som", "title")).includes("com som"), "o ícone mostra que a tela tem som");
    },
  },

  {
    nome: "Avisos quando a tela vai sem som",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana", { tela: { superficie: "window" } });
      const bia = await amb.pessoa("Bia");
      await ana.click("#btn-compartilhar");
      await bia.waitForFunction(() => (document.querySelector(".selo.som")?.title || "").includes("janela"), null, { timeout: 10000 });
      t.verificar(true, "quem assiste vê o motivo: 'janela avulsa'");
      t.verificar(await ana.isVisible("#aviso-som"), "quem compartilha vê o aviso fixo de 'sem som'");
      await ana.evaluate(() => { window.__tela.superficie = "monitor"; });
      await ana.click("#btn-recompartilhar");
      await bia.waitForFunction(() => (document.querySelector(".selo.som")?.title || "").includes("com som"), null, { timeout: 10000 });
      t.verificar(!(await ana.isVisible("#aviso-som")), "'Compartilhar de novo com som' resolve e o aviso some");
      await ana.evaluate(() => { const f = estado.minhaTela.getAudioTracks()[0]; f.stop(); f.dispatchEvent(new Event("ended")); });
      await bia.waitForFunction(() => (document.querySelector(".selo.som")?.title || "").includes("parou"), null, { timeout: 10000 });
      t.verificar(true, "se a captura de som para no meio, quem assiste vê 'parou'");
    },
  },

  {
    nome: "Câmera",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana");
      const bia = await amb.pessoa("Bia");
      const quadros = (p) => p.evaluate(() => [...document.querySelectorAll(".bloco")].map((b) => {
        const v = b.querySelector("video");
        return { nome: b.querySelector(".nome")?.textContent, camera: b.classList.contains("camera"), largura: v.videoWidth, altura: v.videoHeight, res: b.querySelector(".selo.resolucao")?.textContent || "" };
      }));
      const t0 = Date.now();
      await ana.click("#btn-camera");
      await esperarTelas(bia, 1, 15000);
      t.medir("Tempo até a câmera aparecer", Date.now() - t0, "ms");
      let q = await quadros(bia);
      t.verificar(q.length === 1 && q[0].camera && q[0].nome === "Ana · câmera", "ligar a câmera cria um quadro 'Ana · câmera' para os outros", JSON.stringify(q.map((x) => x.nome)));
      t.verificar(await ana.isVisible(".bloco.camera-propria"), "a própria câmera aparece (espelhada) para quem ligou");
      t.verificar(/Desligar/.test(await ana.textContent("#btn-camera")), "o botão vira 'Desligar câmera'");
      // tela + câmera ao mesmo tempo: dois quadros, cada um com o vídeo certo
      await ana.click("#btn-compartilhar");
      await esperarTelas(bia, 2, 15000);
      await dormir(5000);
      q = await quadros(bia);
      const tela = q.find((x) => !x.camera), cam = q.find((x) => x.camera);
      t.medir("Câmera recebida", `${cam.largura}×${cam.altura} (${cam.res})`);
      t.verificar(tela && cam, "tela e câmera juntas aparecem em dois quadros", JSON.stringify(q.map((x) => x.nome)));
      t.verificar(tela.largura !== cam.largura || tela.altura !== cam.altura, "o quadro da tela mostra a tela e o da câmera mostra a câmera (não trocados)", `tela ${tela.largura}×${tela.altura}, câmera ${cam.largura}×${cam.altura}`);
      t.verificar(cam.altura <= 720 && cam.altura >= 360, "a câmera vai em até 720p", `${cam.altura}p`);
      // quem entra depois também vê
      const caio = await amb.pessoa("Caio");
      await esperarTelas(caio, 2, 20000);
      t.verificar(true, "quem entra depois vê a tela e a câmera");
      // parar a tela não desliga a câmera
      await ana.click("#btn-compartilhar");
      await bia.waitForFunction(() => document.querySelectorAll(".bloco").length === 1 && document.querySelector(".bloco.camera"), null, { timeout: 10000 });
      t.verificar(true, "parar a tela mantém a câmera ligada");
      // aba escondida: a câmera também para de chegar
      const quadrosCamera = () => bia.evaluate(async () => { let n = 0; for (const pc of window.__pcs) (await pc.getStats()).forEach((x) => { if (x.type === "inbound-rtp" && x.kind === "video") n += x.framesDecoded || 0; }); return n; });
      await bia.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
      await dormir(7000);
      const c1 = await quadrosCamera(); await dormir(2500); const c2 = await quadrosCamera();
      t.verificar(c2 === c1, "com a aba escondida, a câmera também para de chegar (alivia o PC)", `${c2 - c1} quadros`);
      await bia.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
      await dormir(2500);
      const c3 = await quadrosCamera(); await dormir(2000); const c4 = await quadrosCamera();
      t.verificar(c4 > c3, "voltou para a aba: a câmera volta");
      // desligar
      await ana.click("#btn-camera");
      await bia.waitForFunction(() => document.querySelectorAll(".bloco").length === 0, null, { timeout: 10000 });
      t.verificar(true, "desligar a câmera tira o quadro dos outros");
      // celular: não compartilha tela, mas liga a câmera
      const cel = await amb.pessoa("Cel", { viewport: { width: 390, height: 800 }, antes: () => { delete navigator.mediaDevices.getDisplayMedia; delete MediaDevices.prototype.getDisplayMedia; } });
      t.verificar(await cel.isVisible("#btn-camera"), "no celular o botão de câmera aparece");
      await cel.click("#btn-camera");
      await bia.waitForFunction(() => [...document.querySelectorAll(".bloco .nome")].some((n) => n.textContent === "Cel · câmera"), null, { timeout: 15000 });
      await esperarTelas(bia, 1, 15000);
      t.verificar(true, "a câmera do celular chega para os outros");
    },
  },

  {
    nome: "Tela cheia e aba escondida",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana");
      const bia = await amb.pessoa("Bia");
      await ana.click("#btn-compartilhar");
      await esperarTelas(bia, 1);
      await bia.dblclick(".bloco video");
      await dormir(400);
      const vis = () => bia.evaluate(() => ({ cheia: Boolean(document.fullscreenElement), legenda: getComputedStyle(document.querySelector(".legenda")).opacity, cursor: getComputedStyle(document.querySelector(".bloco")).cursor }));
      t.verificar((await vis()).cheia, "clique duplo entra em tela cheia");
      await dormir(3200);
      const parado = await vis();
      t.verificar(parado.legenda === "0" && parado.cursor === "none", "mouse parado: legenda e cursor somem", JSON.stringify(parado));
      await bia.mouse.move(200, 200); await bia.mouse.move(220, 210); await dormir(400);
      t.verificar((await vis()).legenda === "1", "mexeu o mouse: legenda volta");
      await bia.evaluate(() => document.exitFullscreen());
      // aba escondida: só o som
      const esconder = (h) => bia.evaluate((x) => { Object.defineProperty(document, "hidden", { configurable: true, get: () => x }); document.dispatchEvent(new Event("visibilitychange")); }, h);
      await esconder(true);
      await dormir(7000);
      const e1 = await estatisticasRecebidas(bia); await dormir(3000); const e2 = await estatisticasRecebidas(bia);
      const quadros = (e2.videos[0]?.quadros || 0) - (e1.videos[0]?.quadros || 0);
      t.verificar(quadros === 0, "aba escondida: para de receber vídeo", `${quadros} quadros em 3 s`);
      t.verificar(e2.audioBytes > e1.audioBytes, "aba escondida: o som continua");
      t.verificar(/só ouvindo/.test(await ana.textContent("#info-envio")), "quem compartilha vê '1 só ouvindo'");
      await esconder(false);
      await dormir(3000);
      const f1 = await estatisticasRecebidas(bia); await dormir(2000); const f2 = await estatisticasRecebidas(bia);
      t.verificar((f2.videos[0]?.quadros || 0) > (f1.videos[0]?.quadros || 0), "voltou para a aba: o vídeo volta");
      t.verificar(!(await bia.evaluate(() => [...estado.pares.values()].some((p) => p.relay))), "não cai no modo via servidor à toa");
    },
  },

  {
    nome: "Queda e volta do servidor",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana");
      const bia = await amb.pessoa("Bia");
      await ana.click("#btn-compartilhar");
      await esperarTelas(bia, 1);
      await amb.reiniciarServidor();
      const t0 = Date.now();
      await bia.waitForSelector("#aviso-conexao:not(.oculto)", { timeout: 10000 }).catch(() => {});
      await bia.waitForFunction(() => document.getElementById("aviso-conexao").classList.contains("oculto") && document.getElementById("lista-pessoas").textContent.includes("Ana"), null, { timeout: 20000 });
      await esperarTelas(bia, 1, 20000);
      t.medir("Tempo para voltar a ver a tela depois da queda", Date.now() - t0, "ms");
      t.verificar(true, "todos reconectam sozinhos e a tela volta");
    },
  },

  {
    nome: "Upload automático (não saturar a internet)",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana");
      const bia = await amb.pessoa("Bia");
      t.verificar((await ana.$eval("#sel-upload", (s) => s.value)) === "auto", "'Seu upload' vem em Automático");
      await ana.click("#btn-compartilhar");
      await esperarTelas(bia, 1);
      // Simula fila no roteador somando atraso ao RTT que o app lê.
      await ana.evaluate(() => { window.__extra = 0; for (const par of estado.pares.values()) { const orig = par.pc.getStats.bind(par.pc); par.pc.getStats = async (...a) => { const r = await orig(...a); const m = new Map(); r.forEach((v, k) => m.set(k, v.type === "candidate-pair" ? { ...v, currentRoundTripTime: (v.currentRoundTripTime || 0) + window.__extra } : v)); return m; }; } });
      const orc = () => ana.evaluate(() => estado.auto.orcamento / 1e6);
      await dormir(5000);
      const antes = await orc();
      await ana.evaluate(() => { window.__extra = 0.2; });
      const t0 = Date.now();
      await ana.waitForFunction((a) => estado.auto.orcamento / 1e6 < a * 0.6, antes, { timeout: 15000 });
      t.medir("Tempo para cortar o envio quando a internet engasga", Date.now() - t0, "ms");
      const corte = await orc();
      await ana.evaluate(() => { window.__extra = 0; });
      await dormir(15000);
      const depois = await orc();
      t.medir("Envio: normal → engasgando → recuperado", `${antes.toFixed(1)} → ${corte.toFixed(1)} → ${depois.toFixed(1)}`, "Mbps");
      t.verificar(corte < antes * 0.6, "corta o envio quando o atraso sobe", `${antes.toFixed(1)} → ${corte.toFixed(1)} Mbps`);
      t.verificar(depois > corte, "volta a subir quando normaliza", `${corte.toFixed(1)} → ${depois.toFixed(1)} Mbps`);
    },
  },

  {
    nome: "Qualidade 4K",
    async rodar(t) {
      const amb = await t.ambiente();
      const ana = await amb.pessoa("Ana", { tela: { largura: 3840, altura: 2160, fps: 30 } });
      const bia = await amb.pessoa("Bia");
      await ana.selectOption("#sel-qualidade", "uhd");
      await ana.selectOption("#sel-upload", "100");
      await ana.click("#btn-compartilhar");
      await esperarTelas(bia, 1);
      await dormir(8000);
      const v = melhorVideo(await estatisticasRecebidas(bia));
      t.medir("Resolução recebida (4K)", `${v.largura}×${v.altura}`);
      t.medir("FPS recebido (4K, tela de teste a 30 fps)", Math.round(v.fps), "fps");
      t.verificar(v.altura === 2160, "4K chega em 2160p (resolução travada)", `${v.altura}p`);
    },
  },

  {
    nome: "Segurança e robustez do servidor",
    async rodar(t) {
      const amb = await t.ambiente({ obterSenha: () => "gato123" });
      // só aceita conexões do próprio PC
      const ip = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
      if (ip) {
        const externo = await fetch(`http://${ip}:${amb.porta}/`, { signal: AbortSignal.timeout(3000) }).then(() => "aceitou", () => "recusou");
        t.verificar(externo === "recusou", "não aceita conexões de outros PCs da rede (Firewall não precisa liberar)", externo);
      }
      // arquivos fora da pasta pública
      for (const caminho of ["/..%2fserver.js", "/%2e%2e/package.json", "/..%5cserver.js"]) {
        const r = await fetch(amb.url(caminho));
        t.verificar(r.status !== 200, `não entrega arquivos fora da pasta do site (${caminho})`, r.status);
      }
      // senha
      const p = await amb.pessoa("Ana", { entrar: false });
      await p.fill("#campo-nome", "Ana");
      await p.click("button[type=submit]");
      await p.waitForSelector("#erro-entrada:not(.oculto)");
      t.verificar(/senha/i.test(await p.textContent("#erro-entrada")), "sem senha: recusa e pede a senha");
      await p.fill("#campo-senha", "errada");
      await p.click("button[type=submit]");
      await p.waitForFunction(() => /incorreta/.test(document.getElementById("erro-entrada").textContent));
      t.verificar(true, "senha errada: recusa");
      await p.fill("#campo-senha", "gato123");
      await p.click("button[type=submit]");
      await p.waitForSelector("#tela-sala:not(.oculto)");
      t.verificar(true, "senha certa: entra");
      // mensagem gigante não derruba o servidor
      const ws = new WebSocket(`ws://127.0.0.1:${amb.porta}/ws?sala=x&nome=y&senha=gato123`);
      await new Promise((r) => ws.once("open", r));
      const fechou = new Promise((r) => ws.once("close", r));
      ws.send(Buffer.alloc(6 * 1024 * 1024));
      await fechou;
      const cfg = await fetch(amb.url("/config")).then((r) => r.status);
      t.verificar(cfg === 200, "mensagem gigante só derruba quem mandou; o servidor segue de pé", cfg);
    },
  },

  {
    nome: "Página e link",
    async rodar(t) {
      const amb = await t.ambiente({ obterLinkPublico: () => "https://exemplo.trycloudflare.com" });
      // o dono abre pelo 127.0.0.1; "Copiar link" tem que dar o link público
      const dono = await amb.pessoa("Dono", { sala: "jogo" });
      await dono.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: amb.url("") });
      await dono.click("#btn-copiar");
      await dormir(400);
      const copiado = await dono.evaluate(() => navigator.clipboard.readText());
      t.verificar(copiado === "https://exemplo.trycloudflare.com/?sala=jogo", "'Copiar link' do dono dá o link público, não localhost", copiado);
      // app atualizado com a página aberta: pede para recarregar
      await dono.evaluate(() => { estado.versaoPagina = "0.0.1"; });
      await amb.reiniciarServidor();
      await dono.waitForSelector("#aviso-versao:not(.oculto)", { timeout: 20000 });
      t.verificar(true, "página desatualizada mostra 'Recarregar página'");
      // aparelho que não compartilha tela (celular): só assistir
      const cel = await amb.pessoa("Cel", { viewport: { width: 390, height: 800 }, antes: () => { delete navigator.mediaDevices.getDisplayMedia; delete MediaDevices.prototype.getDisplayMedia; } });
      t.verificar(!(await cel.isVisible("#btn-compartilhar")) && (await cel.isVisible("#txt-so-assistir")), "no celular, some o 'Compartilhar' e explica que é só para assistir");
      // nomes com HTML não viram código
      const x = await amb.pessoa("<img src=x onerror=window.__xss=1>", { sala: "jogo" });
      await dormir(500);
      const xss = await dono.evaluate(() => window.__xss === 1 || Boolean(document.querySelector("#lista-pessoas img")));
      t.verificar(!xss, "nome com HTML aparece como texto (sem injeção de código)");
      await x.close();
    },
  },
];
