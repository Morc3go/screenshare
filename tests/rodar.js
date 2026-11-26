// Roda todos os cenários e gera docs/relatorio-de-testes.md.
//   npm test                    todos
//   npm test -- som 4k          só os cenários cujo nome contém "som" ou "4k"

"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Ambiente } = require("./ajudantes");
const cenarios = require("./cenarios");

const TEMPO_MAXIMO_MS = 180000;
const filtros = process.argv.slice(2).map((f) => f.toLowerCase());
const escolhidos = filtros.length ? cenarios.filter((c) => filtros.some((f) => c.nome.toLowerCase().includes(f))) : cenarios;

const verde = (s) => `\x1b[32m${s}\x1b[0m`;
const vermelho = (s) => `\x1b[31m${s}\x1b[0m`;
const cinza = (s) => `\x1b[90m${s}\x1b[0m`;

async function rodarCenario(c) {
  const resultado = { nome: c.nome, verificacoes: [], medidas: [], erro: null, ms: 0 };
  const ambientes = [];
  const t = {
    ambiente: async (opcoes) => { const a = await new Ambiente().iniciar(opcoes); ambientes.push(a); return a; },
    verificar: (ok, descricao, observado) => {
      resultado.verificacoes.push({ ok: Boolean(ok), descricao, observado });
      console.log(`  ${ok ? verde("✓") : vermelho("✗")} ${descricao}${observado !== undefined ? cinza(` (${observado})`) : ""}`);
    },
    medir: (nome, valor, unidade = "") => {
      resultado.medidas.push({ nome, valor, unidade });
      console.log(`  ${cinza("·")} ${nome}: ${valor}${unidade ? " " + unidade : ""}`);
    },
  };
  const t0 = Date.now();
  try {
    await Promise.race([
      c.rodar(t),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`passou de ${TEMPO_MAXIMO_MS / 1000} s`)), TEMPO_MAXIMO_MS)),
    ]);
  } catch (e) {
    resultado.erro = e.message.split("\n")[0];
    console.log(`  ${vermelho("✗ erro:")} ${resultado.erro}`);
  }
  for (const a of ambientes) {
    for (const erro of a.erros) { resultado.erro ??= `erro na página: ${erro}`; console.log(`  ${vermelho("✗ erro na página:")} ${erro}`); }
    await a.encerrar();
  }
  resultado.ms = Date.now() - t0;
  return resultado;
}

function relatorio(resultados, navegador) {
  const total = resultados.reduce((n, r) => n + r.verificacoes.length, 0);
  const ok = resultados.reduce((n, r) => n + r.verificacoes.filter((v) => v.ok).length, 0);
  const comErro = resultados.filter((r) => r.erro).length;
  const linhas = [];
  linhas.push("# Relatório de testes", "");
  linhas.push(`Gerado por \`npm test\` em ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`, "");
  linhas.push(`**${ok} de ${total} verificações passaram**${comErro ? `, ${comErro} cenário(s) com erro` : ""}.`, "");
  linhas.push("## Ambiente", "");
  linhas.push(`- ${navegador}, sem interface (headless), todos os participantes no mesmo computador`);
  linhas.push(`- ${os.cpus().length} núcleos (${os.cpus()[0]?.model || "?"}), ${Math.round(os.totalmem() / 2 ** 30)} GB de RAM, ${os.platform()}`);
  linhas.push("- Sem placa de vídeo: toda codificação de vídeo é por software, e todos os participantes dividem o mesmo processador. Num PC de verdade, com placa de vídeo, fps e resolução tendem a ser maiores.");
  linhas.push("- A tela compartilhada é uma animação gerada pelo teste; o som, um tom de 440 Hz. Todo o resto é o código real do app.", "");
  linhas.push("## Medições", "", "| Cenário | Medida | Valor |", "|---|---|---|");
  for (const r of resultados) for (const m of r.medidas) linhas.push(`| ${r.nome} | ${m.nome} | ${m.valor}${m.unidade ? " " + m.unidade : ""} |`);
  linhas.push("", "## Verificações", "");
  for (const r of resultados) {
    linhas.push(`### ${r.erro || r.verificacoes.some((v) => !v.ok) ? "❌" : "✅"} ${r.nome} (${(r.ms / 1000).toFixed(0)} s)`, "");
    for (const v of r.verificacoes) linhas.push(`- ${v.ok ? "✅" : "❌"} ${v.descricao}${v.observado !== undefined ? ` — \`${String(v.observado).replace(/`/g, "'")}\`` : ""}`);
    if (r.erro) linhas.push(`- ❌ **erro:** ${r.erro}`);
    linhas.push("");
  }
  return linhas.join("\n");
}

(async () => {
  const { chromium } = require("playwright");
  let versao = "Chromium";
  try { const b = await chromium.launch(); versao = `Chromium ${b.version()}`; await b.close(); } catch { /* ajudantes tenta outro caminho */ }
  const resultados = [];
  for (const c of escolhidos) {
    console.log(`\n${c.nome}`);
    resultados.push(await rodarCenario(c));
  }
  const falhas = resultados.filter((r) => r.erro || r.verificacoes.some((v) => !v.ok));
  if (!filtros.length) {
    const destino = path.join(__dirname, "..", "docs", "relatorio-de-testes.md");
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, relatorio(resultados, versao) + "\n");
    console.log(cinza(`\nRelatório: ${path.relative(process.cwd(), destino)}`));
  }
  const total = resultados.reduce((n, r) => n + r.verificacoes.length, 0);
  const ok = resultados.reduce((n, r) => n + r.verificacoes.filter((v) => v.ok).length, 0);
  console.log(`\n${falhas.length ? vermelho(`${falhas.length} cenário(s) com falha`) : verde("Tudo certo")} · ${ok}/${total} verificações`);
  process.exit(falhas.length ? 1 : 0);
})();
