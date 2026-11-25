# Compartilha Tela

App para você e até 9 amigos (10 pessoas por sala) compartilharem a tela uns com os
outros pelo navegador. Todo mundo pode compartilhar ao mesmo tempo, e cada tela aparece
num bloco separado, com botões de pausar, destacar e tela cheia.

**Você abre o app, ele gera um link, você manda o link para os amigos. Fechou o app, desligou tudo.**

- Os amigos não instalam nada: só abrem o link no Chrome, Edge ou Firefox.
- O vídeo vai direto de um navegador para o outro (WebRTC). Ele não passa pelo seu PC
  nem por servidor nenhum, então o app quase não gasta CPU ou internet.

## Instalar o app

Baixe o instalador na página de [Releases](../../releases) (ou em **Actions → Gerar app →
última execução → Artifacts**):

| Sistema | Arquivo |
|---|---|
| Windows | `CompartilhaTela-Instalador-*.exe` (instala e cria atalho) ou `CompartilhaTela-Portatil-*.exe` (roda sem instalar) |
| macOS | `CompartilhaTela-*-arm64.dmg` (Apple Silicon) ou `-x64.dmg` (Intel) |
| Linux | `CompartilhaTela-*.AppImage` |

O app **não tem assinatura de código**, então o sistema vai reclamar na primeira vez:

- **Windows** (SmartScreen, "O Windows protegeu o computador"): clique em **Mais informações → Executar assim mesmo**.
- **macOS** ("não pode ser aberto porque é de um desenvolvedor não identificado"): clique com o
  botão direito no app → **Abrir** → **Abrir**. Se disser que o app "está danificado", rode
  `xattr -cr "/Applications/Compartilha Tela.app"` no Terminal.
- **Linux**: `chmod +x CompartilhaTela-*.AppImage` e abra.

## Usar

1. Abra o **Compartilha Tela**. Na primeira vez ele baixa o `cloudflared` (cerca de 30 MB,
   direto do GitHub da Cloudflare), que cria o link HTTPS.
2. Quando aparecer **Online**, clique em **Copiar link** e mande para os amigos.
3. Clique em **Abrir a sala no meu navegador** para entrar você também.
4. Na sala, **Compartilhar minha tela** e escolha tela inteira, janela ou aba.
5. Para desligar, feche a janela do app.

O painel mostra quem está na sala e quem está compartilhando. Dá para definir uma **senha**,
o que é recomendado, porque qualquer pessoa com o link consegue entrar. O link muda toda vez
que o app é aberto.

### Na sala

- **Qualidade**: *Texto nítido* (código e documentos), *Equilibrado*, *Vídeos e jogos* (mais
  fluido, menos nítido) ou *Internet fraca*. Pode trocar durante o compartilhamento.
- **Pausar** numa tela: você para de receber essa tela, e quem compartilha para de enviar
  para você, sobrando banda para os outros.
- **Destacar**: amplia uma tela no topo. **Tela cheia**: ocupa o monitor.
- **Incluir áudio**: transmite o som (Chrome/Edge; no Windows com tela inteira ou aba, no
  macOS só aba).

## Como ele aguenta 10 pessoas

Cada pessoa se conecta direto com cada outra, então quem compartilha envia uma cópia da tela
para cada pessoa que está assistindo. Para isso caber no upload de uma internet comum:

- o app divide um orçamento de upload (8 a 10 Mbps, conforme a qualidade) entre quem está
  assistindo. Com 9 pessoas assistindo, cada uma recebe cerca de 0,9 Mbps, o que dá texto
  legível. Com menos gente, a qualidade sobe sozinha;
- a contagem aparece na sala ("Enviando para 9 pessoas · até 0,9 Mbps cada");
- quem pausa uma tela deixa de contar nessa divisão;
- se sua internet tiver menos de ~8 Mbps de upload, use **Internet fraca** (3 Mbps no total).

Várias pessoas compartilhando ao mesmo tempo funciona. O limite é o upload de cada uma, não o app.

## Rodar pelo código (desenvolvimento)

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```bash
npm install
```

```bash
npm run app
```

Esse segundo comando abre o app desktop. Se quiser só o servidor, sem app e sem túnel:

```bash
npm run servidor
```

(`PORTA`, `SENHA` e `MAX_POR_SALA` são variáveis de ambiente opcionais.) Nesse modo, para os
amigos acessarem, rode o túnel à mão em outro terminal: `cloudflared tunnel --url http://localhost:3000`.

Gerar o instalador localmente: `npm run dist:win`, `npm run dist:mac` ou `npm run dist:linux`
(saem em `dist/`). Mas é mais fácil deixar o GitHub Actions gerar: todo push na `main` gera os três,
e uma tag `v*` publica uma Release:

```bash
git tag v2.0.0
```

```bash
git push origin v2.0.0
```

## Limitações

- **Link de túnel grátis**: o `trycloudflare.com` não tem garantia de disponibilidade. Se ele
  cair, o app tenta de novo sozinho, e há o botão **Reiniciar túnel** (o link muda).
- **Redes muito restritivas**: em algumas redes (corporativas, 4G com CGNAT duplo) a conexão
  direta entre navegadores não fecha. Para esses casos seria preciso um servidor TURN, que dá
  para adicionar em `ICE` no topo de `public/app.js`.
- **Mais de 10 pessoas**: a malha começa a pesar no upload de quem compartilha. Para salas
  maiores o caminho seria um SFU (um servidor que recebe uma cópia e redistribui).

## Estrutura

```
server.js           servidor HTTP + sinalização WebSocket (salas, limite de 10, senha)
public/             o site da sala (HTML, CSS, app.js com o WebRTC)
desktop/main.js     app Electron: liga servidor + túnel ao abrir e desliga ao fechar
desktop/tunel.js    baixa e controla o cloudflared, extrai o link https://*.trycloudflare.com
desktop/painel.*    janela de controle (link, quem está na sala, senha)
```

```
 navegador A ──(WebSocket: offer/answer/ICE)──▶ server.js ◀── navegador B
      ╰──────────────── vídeo direto (WebRTC) ────────────────╯
```
