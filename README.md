# Compartilha Tela

App para você e até 9 amigos (10 pessoas por sala) compartilharem a tela uns com os
outros pelo navegador. Todo mundo pode compartilhar ao mesmo tempo, e cada tela aparece
num bloco separado, com botões de pausar, destacar e tela cheia.

**Você abre o app, ele gera um link, você manda o link para os amigos. Fechou o app, desligou tudo.**

- Os amigos não instalam nada: só abrem o link no Chrome, Edge ou Firefox.
- O vídeo vai direto de um navegador para o outro (WebRTC). Ele não passa pelo seu PC
  nem por servidor nenhum, então o app quase não gasta CPU ou internet.

## Instalar o app

Baixe o instalador na página de **[Releases](../../releases/latest)**:

| Sistema | Arquivo |
|---|---|
| Windows | `CompartilhaTela-Instalador-*.exe` (recomendado: instala, cria atalho e **se atualiza sozinho**) |
| Windows (sem instalar) | `CompartilhaTela-Portatil-*.exe` (roda direto, mas não se atualiza sozinho) |
| macOS | `CompartilhaTela-*-arm64.dmg` (Apple Silicon) ou `-x64.dmg` (Intel) |
| Linux | `CompartilhaTela-*.AppImage` (se atualiza sozinho) |

O app **não tem assinatura de código**, então o sistema vai reclamar na primeira vez:

- **Windows** (SmartScreen, "O Windows protegeu o computador"): clique em **Mais informações → Executar assim mesmo**.
- **macOS** ("não pode ser aberto porque é de um desenvolvedor não identificado"): clique com o
  botão direito no app → **Abrir** → **Abrir**. Se disser que o app "está danificado", rode
  `xattr -cr "/Applications/Compartilha Tela.app"` no Terminal.
- **Linux**: `chmod +x CompartilhaTela-*.AppImage` e abra.

## Atualizações

No **Windows (instalador)** e no **Linux**, o app procura versão nova ao abrir (e a cada 4 horas
aberto). Quando acha, baixa em segundo plano e mostra um aviso no topo do painel. A atualização
instala sozinha quando você fecha o app, ou na hora pelo botão **Reiniciar e atualizar agora**.

No **Windows portátil** e no **macOS**, o painel avisa que há versão nova e o botão abre a
página de download (o portátil é um .exe avulso, e o macOS só deixa um app se substituir sozinho
se ele tiver assinatura).

**Para lançar uma versão nova** (quem mantém o código): aumente `"version"` no `package.json` e
faça push na `main`. O GitHub Actions gera os instaladores e publica a Release `v<versão>`
sozinho. Push sem mudar a versão só gera os arquivos em Actions → Artifacts.

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

- **Qualidade**: *Texto nítido* (código e documentos, na resolução nativa do seu monitor),
  *Equilibrado* (até 1440p, 30 fps), *Vídeos e jogos* (1080p, 60 fps) ou *Internet fraca*.
  Pode trocar durante o compartilhamento.
- **Seu upload**: informe a velocidade de **upload** da sua internet (em [fast.com](https://fast.com),
  clique em "Mais informações"). O app usa 80% dela para a tela. Quanto maior, mais nítida sua
  tela chega para os outros. O padrão é 20 Mbps.
- **Pausar** numa tela: você para de receber essa tela, e quem compartilha para de enviar
  para você, sobrando banda para os outros.
- **Destacar**: amplia uma tela no topo. **Tela cheia**: ocupa o monitor.
- **Som**: vem ligado (**Incluir áudio**). Para a tela ir com som, no Chrome ou Edge escolha
  **Tela inteira** ou uma **Aba** e deixe marcado **Compartilhar áudio** no seletor. Janelas
  avulsas e o Firefox não mandam som; o site avisa quando a tela saiu sem som. Cada tela mostra um
  ícone de alto-falante (com ou sem som) e tem botão para silenciar só ela. O som vai em estéreo,
  com qualidade de música, sem os filtros de chamada de voz que cortam música e jogo.

## Qualidade da imagem

- **Resolução nativa**: no modo *Texto nítido* a tela vai sem reduzir (1440p, 4K…), porque
  reduzir é o que mais borra texto.
- **Codec VP9** (ou H.264 no modo de 60 fps): o VP9 tem um modo próprio para conteúdo de tela e
  deixa texto bem mais nítido que o VP8 padrão no mesmo bitrate.
- **Resolução tem prioridade**: se faltar banda ou CPU, cai a fluidez (fps), não a nitidez.
  No modo *Vídeos e jogos* é o contrário.
- **Começa nítido**: o navegador começa já em 2,5 Mbps, em vez de começar baixo e ir subindo.

## Como ele aguenta 10 pessoas

Cada pessoa se conecta direto com cada outra, então quem compartilha envia uma cópia da tela
para cada pessoa que está assistindo. Para isso caber no seu upload:

- o app divide 80% do upload informado entre quem está assistindo, com teto de 8 Mbps por
  pessoa (10 no modo de 60 fps). Com 20 Mbps de upload e 9 pessoas assistindo, cada uma recebe
  até 1,8 Mbps; com 100 Mbps, até 8 Mbps cada;
- a contagem aparece na sala ("Assistindo você: 9 pessoas direto · até 1,8 Mbps cada");
- quem pausa uma tela deixa de contar nessa divisão;
- se o upload informado for maior que o real, o navegador detecta a congestão e reduz sozinho,
  mas a imagem oscila. Prefira informar um valor um pouco abaixo do medido.

Várias pessoas compartilhando ao mesmo tempo funciona. O limite é o upload e a CPU de cada uma:
cada pessoa assistindo direto é uma codificação a mais no PC de quem compartilha.

## Quando a conexão direta não funciona ("via servidor")

O normal é o vídeo ir direto de um navegador para o outro, com o selo verde **direto** na tela.
Mas várias redes bloqueiam essa conexão direta, principalmente internet de operadora com CGNAT,
4G e redes de empresa ou faculdade. Nesse caso o site espera uns 7 segundos e passa sozinho para
o modo **via servidor** (selo amarelo):

- quem compartilha grava a tela em pedaços de vídeo e manda pelo mesmo canal que já liga ao
  seu app (o túnel). O seu PC repassa para quem precisa;
- tem cerca de 1 a 2 segundos de atraso, mas funciona em qualquer rede que abra o site;
- se a conexão direta voltar a funcionar, a tela volta sozinha para **direto**;
- nesse modo o vídeo passa pelo PC de quem está com o app aberto, então gasta o upload dele
  (até 4 Mbps por pessoa nesse modo, na qualidade "Texto nítido").

Para testar o modo via servidor de propósito, abra a sala com `?so_servidor=1` no fim do link.

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
(saem em `dist/`). Para publicar uma versão, veja [Atualizações](#atualizações).

## Limitações

- **Link de túnel grátis**: o `trycloudflare.com` não tem garantia de disponibilidade. Se ele
  cair, o app tenta de novo sozinho, e há o botão **Reiniciar túnel** (o link muda).
- **Modo via servidor no Safari**: o Safari (iPhone/Mac) não toca o vídeo nesse modo. Quem
  estiver numa rede que bloqueia a conexão direta precisa usar Chrome, Edge ou Firefox.
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
