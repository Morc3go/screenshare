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

- **Windows** (SmartScreen, "O Windows protegeu o computador"): clique em **Mais informações →
  Executar assim mesmo**. As atualizações automáticas seguintes não mostram esse aviso.
- **macOS** ("não pode ser aberto porque é de um desenvolvedor não identificado"): clique com o
  botão direito no app → **Abrir** → **Abrir**. Se disser que o app "está danificado", rode
  `xattr -cr "/Applications/Compartilha Tela.app"` no Terminal.
- **Linux**: `chmod +x CompartilhaTela-*.AppImage` e abra.

### Windows: segurança

- **Firewall**: o app só aceita conexões do próprio PC (os amigos chegam pelo túnel, que também
  roda no seu PC), então o Firewall do Windows não precisa liberar nada.
- **Antivírus**: o `cloudflared` (o programa da Cloudflare que cria o link) já vem dentro do
  instalador, em vez de ser baixado na primeira vez.
- **SmartScreen / Controle Inteligente de Aplicativos**: o aviso some de vez só com uma
  **assinatura de código**. Sem ela, o SmartScreen avisa até o app ganhar "reputação" (muitos
  downloads), e o *Controle Inteligente de Aplicativos* do Windows 11, se estiver ligado, bloqueia
  apps sem assinatura sem dar a opção "Executar assim mesmo". Caminhos para assinar:
  - **SignPath Foundation**: assinatura **gratuita** para projetos de código aberto (este
    repositório é público e MIT). É preciso se inscrever e ser aprovado;
  - **Azure Artifact Signing** (antigo *Trusted Signing*), da Microsoft: pago, por mês. Confira
    se está disponível para pessoa física no Brasil;
  - certificado de assinatura comprado de uma autoridade certificadora: o mais caro.

  Com qualquer um deles, é só colocar as credenciais nos *secrets* do repositório e ligar a
  assinatura no workflow.

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

- **Qualidade**: *Full HD* (padrão: 1080p, 60 fps), *Quad HD* (1440p, 60 fps), *4K* (2160p,
  60 fps), *Fluidez máxima* (jogos rápidos: mantém os 60 fps e baixa a resolução se precisar),
  *Texto nítido* (resolução do monitor, 30 fps) ou *Internet fraca* (720p, 30 fps). No Full HD,
  faltando banda ou processador, cai um pouco de resolução e de fps; no Quad HD e no 4K a
  resolução fica travada e só o fps cai. Quad HD e 4K só saem se o monitor tiver essa resolução.
- **Resolução e fps reais**: cada tela mostra o que está chegando de verdade (ex.: "1080p · 60
  fps"). Quem compartilha vê embaixo dos controles o que está enviando, se a codificação está na
  placa de vídeo e, se o fps estiver baixo, **o motivo**: processador ou internet. Quando o envio
  está limitado, o selo da tela fica laranja com ⚠ para quem assiste também; clique nele para ver.
- **Seu upload**: deixe em **Automático** (padrão). O app observa o atraso da conexão e, quando
  o upload começa a encher (o que deixa o resto da internet ruim: jogo, Discord, navegação), corta
  o envio na hora e volta a subir aos poucos. Se preferir, escolha um valor fixo; o app usa 70% dele.
- **Pausar** numa tela: você para de receber essa tela, e quem compartilha para de enviar
  para você, sobrando banda para os outros.
- **Destacar**: amplia uma tela no topo. **Tela cheia**: ocupa o monitor.
- **Som**: vai junto por padrão (**Incluir áudio** ligado; desligue se não quiser). No seletor do
  Chrome ou Edge, escolha **Tela inteira** ou uma **Aba** e **ligue "Compartilhar áudio do
  sistema"** (em "Tela inteira" essa opção vem desligada e o site não consegue ligá-la por você).
  Se a tela sair sem som, aparece um aviso fixo com o botão **Compartilhar de novo com som**.
  Cada tela tem um medidor de som: na sua, mostra se o som está saindo; nas dos outros, se está
  chegando. Se sua tela estiver com som ligado mas muda por 20 s, o site avisa (volume do Windows
  no mudo, ou o jogo tocando num dispositivo que não é o padrão do Windows).
- **Volume de cada tela**: botão de mudo e barra de volume no canto de cada tela.
- **Tela cheia**: botão no canto ou clique duplo no vídeo. Com o mouse parado por 2,5 s, a legenda,
  os botões e o cursor somem; mexeu o mouse, voltam.
- **Aba escondida**: se você deixar a aba do site escondida (jogando, por exemplo), depois de 5 s
  o site para de receber o vídeo das telas e mantém só o som. Isso alivia seu PC e o upload de
  quem compartilha. Voltou para a aba, o vídeo volta.
- **Reforçar volume** (ligado por padrão): som de jogo capturado do sistema costuma sair baixo.
  Com isso ligado, o som baixo sobe até uns 12 dB e um limitador impede o alto de estourar. Dá
  para ligar e desligar durante o compartilhamento.

## Qualidade da imagem

- **Resolução nativa**: no modo *Texto nítido* a tela vai sem reduzir (1440p, 4K…), porque
  reduzir é o que mais borra texto.
- **Codec**: H.264 nos modos de 60 fps, porque quase toda placa de vídeo o codifica por hardware
  e o fps não cai por falta de processador; VP9 no *Texto nítido*, que tem um modo próprio para
  conteúdo de tela e deixa letras bem mais nítidas.
- **O que sacrificar quando falta banda ou CPU**: no *Texto nítido* cai o fps e a nitidez fica;
  no *Jogos e vídeos* cai a resolução e os 60 fps ficam; o *Equilibrado* divide entre os dois.
- **Começa nítido**: o navegador começa já em 2,5 Mbps, em vez de começar baixo e ir subindo.

## Como ele aguenta 10 pessoas

Cada pessoa se conecta direto com cada outra, então quem compartilha envia uma cópia da tela
para cada pessoa que está assistindo. Para isso caber no seu upload:

- o app divide 80% do upload informado entre quem está assistindo, com teto por pessoa de
  12 Mbps no Full HD, 20 no Quad HD e 40 no 4K. Se o que sobra por pessoa for pouco para a
  qualidade escolhida (Full HD pede uns 4 Mbps; 4K, uns 15), a sala avisa. Com 20 Mbps de upload e 9 pessoas assistindo, cada uma recebe
  até 1,8 Mbps; com 100 Mbps, até 8 Mbps cada;
- a contagem aparece na sala ("Assistindo você: 9 pessoas direto · até 1,8 Mbps cada");
- quem pausa uma tela deixa de contar nessa divisão;
- se o upload informado for maior que o real, o navegador detecta a congestão e reduz sozinho,
  mas a imagem oscila. Prefira informar um valor um pouco abaixo do medido.

Várias pessoas compartilhando ao mesmo tempo funciona. O limite é o upload e a CPU de cada uma:
cada pessoa assistindo direto é uma codificação a mais no PC de quem compartilha.

## Alguém está sem som

Se a tela de alguém aparece com o ícone de som **cortado (vermelho)**, a tela dessa pessoa chegou
sem áudio. **Clique no ícone**: o site diz o motivo, que pode ser:

- **janela avulsa**: a pessoa escolheu uma janela no seletor; janelas não mandam som. Compartilhe a
  **Tela inteira** ou uma **Aba**;
- **"Compartilhar áudio do sistema" desligado**: em "Tela inteira", essa chave embaixo da
  miniatura vem desligada no Chrome e precisa ser ligada;
- **navegador**: Firefox e Safari não mandam som de tela; use Chrome ou Edge;
- **a captura parou**: o Windows trocou o dispositivo de saída no meio (comum ao entrar numa
  chamada do Discord). Pare e compartilhe de novo;
- **página desatualizada**: a página da pessoa estava aberta desde antes de uma atualização.
  Recarregue (F5). O site também mostra um aviso pedindo para recarregar quando isso acontece.

Quem compartilha também vê um aviso vermelho com o motivo e o botão **Compartilhar de novo com som**.

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
