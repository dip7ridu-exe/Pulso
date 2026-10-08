# Pulso 3.0 — suas playlists, com mais controle

Site estático para GitHub Pages, em português. Vanilla HTML, CSS e JavaScript, sem instalação, servidor ou build. As playlists da versão anterior são preservadas no mesmo navegador e endereço.

## Atualizar no GitHub Pages

1. Extraia o ZIP.
2. Substitua os arquivos no repositório: **index.html, style.css, playlist-utils.js, spotify-service.js, app.js e icon.svg**. O novo `spotify-service.js` também deve ser enviado. Eles precisam ficar juntos na pasta publicada. Não envie apenas o ZIP.
3. Em **Settings → Pages**, use **Deploy from a branch → main → / (root)** se publicar na raiz.
4. Abra o endereço HTTPS informado pelo GitHub, por exemplo `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.
5. Recarregue com **Ctrl + F5**. O rodapé deve mostrar **Pulso 3.0**.

Abrir `index.html` por duplo clique (`file://`) pode causar erros no YouTube e impede a conexão avançada do Spotify. Use o endereço publicado.

## Novidades

- Botões de play/pausa, anterior e próxima, conforme o modo de reprodução.
- Volume e silenciar no YouTube e no Spotify com modo Premium.
- Barra de tempo e avanço no YouTube e no Spotify Premium. No Spotify padrão, a barra apenas mostra o progresso recebido do player.
- **Adicionar música**: cole o link de uma música da mesma plataforma para incluir na fila.
- Fila local do YouTube e Spotify padrão: tocar agora, mover para o início, remover e limpar.
- Spotify Premium: adicionar músicas à fila oficial e ver as próximas músicas. A ordem segue o Spotify; o Pulso não oferece remoção/reordenação da fila oficial.
- Repetição da faixa, ordem aleatória e temporizador para pausar em 15, 30 ou 60 minutos, nos modos com suporte.
- Atalhos: **Espaço** para play/pausa, **M** para silenciar e **← / →** para avançar/voltar 10 segundos. Atalhos não são acionados enquanto você digita em formulários.
- Um único player ativo, para evitar dois áudios ao trocar de plataforma.

As filas locais ficam abertas nesta sessão da página; não alteram suas playlists nas plataformas. O volume fica salvo neste navegador. Google e Spotify são conexões independentes.

## O erro do YouTube mostrado no print

**Erro 150** (equivalente ao 101) significa que o dono do vídeo bloqueou a reprodução em sites externos. O site não consegue remover essa restrição. Os erros 100, 101 e 150 agora marcam a faixa como indisponível e tentam avançar para outra faixa, com limite de tentativas para evitar um ciclo infinito.

Quando o YouTube não entrega a lista de músicas, o Pulso tenta avançar pelo player. Se isso também falhar, mostra **Carregar lista de faixas** e **Abrir no YouTube**. Você pode:

- Conectar o Google ou configurar uma chave da YouTube Data API para obter as faixas da playlist.
- Adicionar links individuais em **Adicionar música**. Eles também precisam permitir reprodução em outros sites.
- Abrir a playlist diretamente no YouTube quando as músicas estiverem bloqueadas.

Quando há metadados da API mas a lista nativa não abre, o Pulso monta a reprodução usando os IDs individuais dos vídeos. Isso ajuda a alcançar as outras faixas, mas não libera vídeos bloqueados, privados, excluídos ou restritos por região/idade. O erro 153 tem outra causa: referência/identificação do site bloqueada ou ausente; publique em HTTPS e verifique as proteções do navegador.

### Listar faixas do YouTube com uma chave de API (opcional)

1. Crie um projeto no [Google Cloud Console](https://console.cloud.google.com/) e ative **YouTube Data API v3**.
2. Em **APIs e serviços → Credenciais**, crie uma **Chave de API**.
3. Restrinja o uso da chave à **YouTube Data API v3** e às referências HTTP do seu site, por exemplo `https://SEU-USUARIO.github.io/*`.
4. No Pulso, clique na engrenagem e cole a chave em **Chave da YouTube Data API**. O campo de Client ID do Google pode ficar vazio se você usar apenas essa opção.

A chave é pública no navegador e fica salva localmente; suas restrições devem ser configuradas no Google. Ela só lista conteúdo acessível pela API e não faz login nem desbloqueia vídeos.

### Conectar suas playlists da conta Google (opcional)

1. No seu projeto Google, ative **YouTube Data API v3**.
2. Configure a tela de consentimento OAuth com `https://www.googleapis.com/auth/youtube.readonly`. Se o app estiver em teste, adicione sua conta como usuário de teste.
3. Crie um **ID do cliente OAuth → Aplicativo da Web**. Em **Origens JavaScript autorizadas**, informe a origem do site, como `https://SEU-USUARIO.github.io`, sem o caminho do repositório.
4. No Pulso, salve o Client ID na engrenagem e clique em **Conectar Google**. O login oficial autoriza a leitura; a senha não passa pelo Pulso.

O botão Sincronizar busca playlists criadas na conta. O token do Google fica na memória da página e precisa ser autorizado novamente após recarregar.

## Spotify: dois modos

| Função | Player padrão | Controle completo · Premium |
| --- | --- | --- |
| Abrir sua playlist por link | Sim, sem configurar um app | Sim, após conectar |
| Play/pausa no Pulso | Se a API do embed carregar | Sim |
| Lista de faixas | No player oficial | Também no Pulso, quando a API permitir |
| Volume / silenciar no Pulso | Não; use o volume do sistema | Sim |
| Avançar/voltar na música | Controles disponíveis no embed | Sim |
| Próxima música | Faixas no embed ou fila local | Sim, fila oficial |
| Repetir / aleatório | Controles disponíveis no embed | Sim |
| Música completa | Depende do embed, conta e navegador; pode ser prévia | Exige conta Premium e acesso autorizado |

### Player padrão

Continue usando o link da playlist que já funcionou. Você pode adicionar links `https://open.spotify.com/track/...` ou URIs `spotify:track:...` à fila local. O Pulso muda para a próxima quando o embed informa o fim ou a troca da faixa; você também pode apertar **Próxima**. Bloqueios de autoplay podem exigir apertar Play dentro do embed. Ao terminar a fila, volta ao **início** da playlist, porque o embed não expõe um controle para retomar a coleção no ponto exato. **Voltar à playlist selecionada** permite voltar antes.

O embed oficial não oferece um método de volume para o site hospedeiro. Por isso, o volume fica desativado neste modo, com indicação do modo necessário. Se a API de controles adicionais não carregar, use o próprio player oficial. Prévias continuam sendo prévias.

### Ativar volume e fila oficial com Spotify Premium

1. Use uma conta **Spotify Premium**. Crie seu aplicativo em [Spotify for Developers](https://developer.spotify.com/dashboard), com **Web API** e **Web Playback SDK** habilitados.
2. Adicione às **Redirect URIs** o endereço exato da página, incluindo o caminho do repositório e a barra final, se houver. Exemplo: `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`. O Pulso mostra o endereço correto na janela **Conectar Spotify**.
3. Em app no modo de desenvolvimento, inclua a conta em **User Management**. As regras atuais também exigem Premium para o dono do app e limitam usuários autorizados. O acesso às faixas de playlists alheias pode não estar disponível; playlists ainda podem ser tocadas pelo seu contexto, conforme o Spotify permitir.
4. Copie o **Client ID**, abra sua playlist no Pulso, clique em **Conectar Spotify**, cole o ID e escolha **Salvar e conectar Spotify**. **Não cole Client Secret**.
5. Após o login, selecione **Controle completo · Premium** e aperte **Play**. O Pulso aparece como dispositivo **Pulso — navegador**.
6. Use o volume, o botão **+** nas faixas da sua playlist ou **Adicionar música** para incluir um link na fila oficial. Inicie a reprodução antes de adicionar à fila.

A integração usa OAuth com PKCE e o SDK oficial; não exige backend, Client Secret ou extração de áudio. A sessão Spotify fica no armazenamento desta aba até desconectar/fechar a sessão, com renovação do token quando necessário. **Desconectar Spotify** remove a sessão local. Para revogar o acesso permanentemente, use as configurações de aplicativos da conta Spotify.

Se a autorização, Premium ou áudio protegido não estiver disponível, volte ao **Player padrão**. O Pulso mantém o player que já funcionava.

## Verificação e limites

Foram verificados sintaxe, referências locais, URLs, preservação da biblioteca antiga, controles de volume/progresso, fila e retorno ao contexto, tratamento dos erros 150/153, metadados e fluxos do embed/SDK com simulações dos players oficiais. O login real e o áudio completo do Spotify Premium dependem de seu aplicativo e sua conta; não foram validados com credenciais pessoais.

O site é uma interface enxuta, mas os players oficiais continuam consumindo recursos. Não há download, conversão em MP3, remoção de anúncios ou garantia de áudio com o navegador fechado.

## Documentação oficial

- [YouTube IFrame Player API: controles e códigos de erro](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube Player Parameters](https://developers.google.com/youtube/player_parameters)
- [Spotify iFrame API](https://developer.spotify.com/documentation/embeds/references/iframe-api)
- [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/reference)
- [Spotify OAuth com PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify: adicionar à fila](https://developer.spotify.com/documentation/web-api/reference/add-to-queue)
- [Spotify: regras de desenvolvimento de 2026](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
