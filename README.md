# Pulso 2.0 — playlists do YouTube e Spotify

Site estático para GitHub Pages. Não há servidor, banco de dados nem etapa de instalação. Os arquivos `index.html`, `style.css`, `playlist-utils.js`, `app.js` e `icon.svg` devem ficar juntos na raiz do repositório publicado.

## Publicar no GitHub Pages

1. Extraia o ZIP e envie `index.html`, `style.css`, `playlist-utils.js`, `app.js` e `icon.svg` à raiz de um repositório GitHub. O `README.md` também pode ser enviado. Não envie só o ZIP.
2. No repositório, abra **Settings → Pages**. Em **Build and deployment**, selecione **Deploy from a branch**, depois `main` e `/ (root)`. Salve.
3. Abra o endereço informado pelo GitHub, normalmente `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.
4. Clique em **Adicionar playlist**, cole um link do YouTube com `list=...` ou um link do Spotify como `https://open.spotify.com/playlist/55lxQh4uRizzGJtM68hOKD`, dê um nome e salve. O player é aberto diretamente; clique no **Play dentro dele**. A importação por link não precisa de Client ID ou chave de API.
5. Se estiver atualizando a versão anterior, substitua todos os arquivos, incluindo o novo `playlist-utils.js`, e recarregue com `Ctrl + F5`. O rodapé deve mostrar **Pulso 2.0**. As playlists salvas anteriormente são preservadas no mesmo navegador e endereço.

## Correções desta versão

- O player abre diretamente a playlist; uma falha na API de controles adicionais não impede a abertura do player oficial.
- Spotify aceita links com parâmetros de compartilhamento, URLs com `/intl-pt/` e URIs `spotify:playlist:...`.
- A troca de plataforma encerra o player anterior para evitar dois áudios ao mesmo tempo.
- O YouTube recebe a origem do site e a política de referência adequada; erros retornados pelo player aparecem na tela com seu código e um botão **Tentar novamente**.
- Os arquivos JavaScript/CSS têm identificação de versão para evitar misturar o código antigo com o atualizado.

### Conectar suas playlists da conta Google (opcional)

Essa etapa é necessária somente para o botão **Conectar Google** listar automaticamente as playlists criadas na sua conta. Você precisa configurar o seu próprio projeto Google; o ZIP não pode vir com as credenciais de outra pessoa.

1. Em [Google Cloud Console](https://console.cloud.google.com/), crie/selecione um projeto e ative **YouTube Data API v3** em **APIs e serviços → Biblioteca**.
2. Configure a tela de consentimento OAuth. Escolha o público apropriado para seu uso. Se deixar o aplicativo em **Testing**, inclua a sua conta Google como **usuário de teste**. Adicione o escopo `https://www.googleapis.com/auth/youtube.readonly` quando solicitado.
3. Em **Credenciais**, crie um **ID do cliente OAuth → Aplicativo da Web**. Em **Origens JavaScript autorizadas**, informe a **origem** do seu site, por exemplo `https://SEU-USUARIO.github.io` (sem o caminho `/NOME-DO-REPOSITORIO/`, sem barra final). Para um domínio próprio, adicione também a origem desse domínio. Alterações podem levar alguns minutos para surtir efeito.
4. Copie somente o **Client ID**, que termina em `.apps.googleusercontent.com`. No Pulso, abra o ícone de engrenagem, cole o ID, salve e clique em **Conectar Google**. Autorize a leitura das playlists na janela oficial do Google.

**Não cole o Client Secret no site ou no GitHub.** O Pulso usa o fluxo de token do Google no navegador e guarda apenas o Client ID e os links que você adicionar no armazenamento local. O token de acesso permanece apenas na memória da aba; após recarregar, clique em **Conectar Google** novamente. O Google poderá exigir verificação adicional para disponibilizar o login a pessoas fora da lista de teste.

## O que funciona

- Biblioteca de links do YouTube e Spotify salva no navegador, pesquisa e remoção.
- YouTube: fila e botões extras de próxima/anterior quando a API estiver disponível. O player nativo continua acessível se a API não carregar.
- Spotify: lista de faixas e controles integrados ao player oficial. O nome da playlist é consultado automaticamente quando o Spotify disponibiliza o metadado; você também pode definir um nome manual.
- Login opcional para ler playlists da conta via YouTube Data API v3 e exibir os títulos das faixas. As listas da conta precisam de nova sincronização ao recarregar a página.
- Layout adaptado a computador e celular, sem framework de interface.

## Limitações do YouTube

- O vídeo é reproduzido pelo **player oficial do YouTube, visível na página**. O site não extrai áudio, não baixa músicas, não remove anúncios e não cria reprodução oculta em segundo plano.
- Algumas músicas ou playlists podem impedir a incorporação, estar indisponíveis, exigir login no próprio player ou ter restrições regionais. Nesses casos, use **Abrir no YouTube**.
- O player ainda carrega recursos e vídeo do YouTube. Esta interface elimina partes da página principal, mas não garante uma redução específica de memória ou tráfego.
- Playlists privadas e certas listas especiais do YouTube Music podem não tocar ou aparecer da mesma forma que no YouTube, mesmo que seus metadados sejam acessíveis pela conta.
- A fila sem login pode mostrar números das faixas em vez dos títulos, conforme o que o player disponibilizar. Com login, o site consulta os títulos na API.
- A reprodução começa quando você aperta **Play dentro do player**, evitando depender do autoplay do navegador.
- Se abrir o `index.html` diretamente pelo computador (`file://`), o YouTube pode retornar **erro 153** por falta de identificação do site. Use o endereço HTTPS publicado no GitHub Pages.
- Se o erro persistir, o aviso do site identifica o código quando a API do YouTube o disponibilizar. `100` indica faixa removida/privada; `101` e `150` indicam reprodução em outros sites bloqueada pelo dono. Use os controles nativos ou **Abrir no YouTube**.

## Limitações do Spotify

- O link abre o **player oficial do Spotify**. A integração não transforma a playlist em músicas do YouTube e não copia o áudio do Spotify.
- Alguns navegadores/sessões só recebem **prévias curtas**. Faixas completas dependem das condições do Spotify, da disponibilidade da faixa e do suporte a áudio protegido no navegador. O iframe mantém a permissão `encrypted-media`; o site não pode garantir faixas completas em qualquer conta/navegador.
- Se aparecer o rótulo **Prévia**, use **Abrir no Spotify**, ou entre pelo próprio player se o Spotify solicitar. A configuração do Google não altera a sessão do Spotify.
- Playlists privadas ou indisponíveis podem exigir abrir a plataforma original.

## Arquivos

- `index.html`: estrutura e interface.
- `style.css`: tema e responsividade.
- `playlist-utils.js`: interpretação e validação dos links.
- `app.js`: biblioteca local, OAuth, APIs e players.
- `icon.svg`: ícone do site.

Fontes: [Spotify Embeds](https://developer.spotify.com/documentation/embeds), [solução de problemas do Spotify](https://developer.spotify.com/documentation/embeds/tutorials/troubleshooting), [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [YouTube Data API](https://developers.google.com/youtube/v3), [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [políticas do YouTube](https://developers.google.com/youtube/terms/developer-policies).
