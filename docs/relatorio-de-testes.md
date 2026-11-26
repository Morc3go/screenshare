# Relatório de testes

Gerado por `npm test` em 2026-11-26 03:28 UTC.

**52 de 52 verificações passaram**.

## Ambiente

- Chromium 158.0.8127.36, sem interface (headless), todos os participantes no mesmo computador
- 4 núcleos (Intel(R) Xeon(R) Processor @ 2.10GHz), 16 GB de RAM, linux
- Sem placa de vídeo: toda codificação de vídeo é por software, e todos os participantes dividem o mesmo processador. Num PC de verdade, com placa de vídeo, fps e resolução tendem a ser maiores.
- A tela compartilhada é uma animação gerada pelo teste; o som, um tom de 440 Hz. Todo o resto é o código real do app.

## Medições

| Cenário | Medida | Valor |
|---|---|---|
| Compartilhar e assistir (conexão direta) | Tempo até a primeira imagem (direto) | 225 ms |
| Compartilhar e assistir (conexão direta) | Resolução recebida (Full HD, 1 pessoa) | 1280×720 |
| Compartilhar e assistir (conexão direta) | FPS recebido (Full HD, 1 pessoa) | 60 fps |
| Compartilhar e assistir (conexão direta) | Codec | video/H264 |
| Modo via servidor (rede que bloqueia conexão direta) | Tempo até a primeira imagem (via servidor, inclui 7 s de espera da direta) | 10626 ms |
| Modo via servidor (rede que bloqueia conexão direta) | Atraso do modo via servidor (buffer) | 0.98 s |
| Modo via servidor (rede que bloqueia conexão direta) | Travadas do player em 6 s (via servidor) | 1 |
| Modo via servidor (rede que bloqueia conexão direta) | Resolução via servidor | 1080p |
| Sala cheia: 10 pessoas, 3 compartilhando | Tempo para 10 pessoas entrarem | 2099 ms |
| Sala cheia: 10 pessoas, 3 compartilhando | Tempo até 3 telas aparecerem para quem assiste (10 na sala) | 3837 ms |
| Som | Bitrate do som (direto) | 129 kbps |
| Som | Som baixo (−29 dB) com reforço | -11.4 dB |
| Som | Ganho do 'Reforçar volume' | 17.0 dB |
| Queda e volta do servidor | Tempo para voltar a ver a tela depois da queda | 2151 ms |
| Upload automático (não saturar a internet) | Tempo para cortar o envio quando a internet engasga | 466 ms |
| Upload automático (não saturar a internet) | Envio: normal → engasgando → recuperado | 12.0 → 4.3 → 6.5 Mbps |
| Qualidade 4K | Resolução recebida (4K) | 3840×2160 |
| Qualidade 4K | FPS recebido (4K, tela de teste a 30 fps) | 16 fps |

## Verificações

### ✅ Compartilhar e assistir (conexão direta) (7 s)

- ✅ chega pelo menos em 720p — `720p`
- ✅ chega com pelo menos 25 fps — `60 fps`
- ✅ a tela mostra o selo 'direto'
- ✅ o selo mostra a resolução real — `720p · 61 fps ⚠`
- ✅ parar de compartilhar some com a tela para os outros

### ✅ Modo via servidor (rede que bloqueia conexão direta) (17 s)

- ✅ a tela mostra o selo 'via servidor'
- ✅ o vídeo anda (mais de 4 s de vídeo em 6 s) — `5.0 s`
- ✅ atraso abaixo de 3,5 s — `0.98 s`
- ✅ o som também chega via servidor — `90146 bytes`
- ✅ o player quase não trava (no máximo 3 vezes em 6 s) — `1`

### ✅ Sala cheia: 10 pessoas, 3 compartilhando (7 s)

- ✅ a sala mostra 10/10 — `10/10`
- ✅ a 11ª pessoa é recusada com 'sala cheia'
- ✅ quem assiste vê as 3 telas
- ✅ quando alguém sai, a tela dele some para os outros

### ✅ Som (18 s)

- ✅ 'Incluir áudio' vem ligado
- ✅ 'Reforçar volume' vem ligado
- ✅ som em qualidade de música (≥ 96 kbps) — `129 kbps`
- ✅ o reforço aumenta o som baixo em pelo menos 10 dB — `17.0 dB`
- ✅ o reforço não estoura (abaixo de 0 dB) — `-11.4 dB`
- ✅ silenciar uma tela continua valendo depois de vários redesenhos
- ✅ a barra de volume tira o mudo e o volume fica em 30% — `{"m":false,"vol":0.3}`
- ✅ sem o player nativo (um controle de som só)
- ✅ o ícone mostra que a tela tem som

### ✅ Avisos quando a tela vai sem som (1 s)

- ✅ quem assiste vê o motivo: 'janela avulsa'
- ✅ quem compartilha vê o aviso fixo de 'sem som'
- ✅ 'Compartilhar de novo com som' resolve e o aviso some
- ✅ se a captura de som para no meio, quem assiste vê 'parou'

### ✅ Tela cheia e aba escondida (20 s)

- ✅ clique duplo entra em tela cheia
- ✅ mouse parado: legenda e cursor somem — `{"cheia":true,"legenda":"0","cursor":"none"}`
- ✅ mexeu o mouse: legenda volta
- ✅ aba escondida: para de receber vídeo — `0 quadros em 3 s`
- ✅ aba escondida: o som continua
- ✅ quem compartilha vê '1 só ouvindo'
- ✅ voltou para a aba: o vídeo volta
- ✅ não cai no modo via servidor à toa

### ✅ Queda e volta do servidor (3 s)

- ✅ todos reconectam sozinhos e a tela volta

### ✅ Upload automático (não saturar a internet) (21 s)

- ✅ 'Seu upload' vem em Automático
- ✅ corta o envio quando o atraso sobe — `12.0 → 4.3 Mbps`
- ✅ volta a subir quando normaliza — `4.3 → 6.5 Mbps`

### ✅ Qualidade 4K (9 s)

- ✅ 4K chega em 2160p (resolução travada) — `2160p`

### ✅ Segurança e robustez do servidor (0 s)

- ✅ não aceita conexões de outros PCs da rede (Firewall não precisa liberar) — `recusou`
- ✅ não entrega arquivos fora da pasta do site (/..%2fserver.js) — `403`
- ✅ não entrega arquivos fora da pasta do site (/%2e%2e/package.json) — `404`
- ✅ não entrega arquivos fora da pasta do site (/..%5cserver.js) — `404`
- ✅ sem senha: recusa e pede a senha
- ✅ senha errada: recusa
- ✅ senha certa: entra
- ✅ mensagem gigante só derruba quem mandou; o servidor segue de pé — `200`

### ✅ Página e link (4 s)

- ✅ 'Copiar link' do dono dá o link público, não localhost — `https://exemplo.trycloudflare.com/?sala=jogo`
- ✅ página desatualizada mostra 'Recarregar página'
- ✅ no celular, some o 'Compartilhar' e explica que é só para assistir
- ✅ nome com HTML aparece como texto (sem injeção de código)

