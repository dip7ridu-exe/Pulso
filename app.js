/* Pulso 2.0: static playlist library with native YouTube and Spotify embeds. */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const STORAGE_LIST = 'pulso.playlists.v1';
  const STORAGE_CLIENT = 'pulso.oauthClient.v1';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  const P = window.PulsoPlaylist;
  const PALETTES = [
    ['#8f577b', '#463361'], ['#655da7', '#272e63'], ['#bb735c', '#713951'],
    ['#437e88', '#345077'], ['#b57f96', '#594268'], ['#738f70', '#365d58']
  ];
  const state = {
    saved: readSaved(), synced: [], token: null, tokenExpires: 0,
    clientId: readStorage(STORAGE_CLIENT) || '', activeId: null,
    player: null, playerReady: false, playerId: null,
    items: [], playlistIds: [], queueLimit: 60, requestId: 0, search: '',
    syncing: false, selected: null
  };
  let toastTimer;
  let iframePromise;
  let playerTimer;

  function readStorage(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function writeStorage(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
  function readSaved() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_LIST) || '[]');
      return Array.isArray(data) ? data.map(P.normalize).filter(Boolean).slice(0, 300) : [];
    } catch { return []; }
  }
  function saveLists() { return writeStorage(STORAGE_LIST, JSON.stringify(state.saved)); }
  function icon(name) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name); el.append(use); return el;
  }
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 4500);
  }
  function allLists() {
    const map = new Map();
    for (const list of state.saved) map.set(P.key(list), { ...list, saved: true });
    for (const list of state.synced) map.set(P.key(list), { ...map.get(P.key(list)), ...list, synced: true });
    return [...map.values()];
  }
  function colorsFor(id) {
    let hash = 0; for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return PALETTES[Math.abs(hash) % PALETTES.length];
  }
  function artLetter(title) { return (Array.from(title.trim())[0] || '♫').toUpperCase(); }
  function renderLibrary() {
    const lists = allLists();
    const visible = lists.filter(x => x.title.toLocaleLowerCase('pt-BR').includes(state.search));
    $('#playlist-count').textContent = lists.length;
    const grid = $('#playlist-grid'); grid.replaceChildren();
    for (const list of visible) {
      const [a, b] = colorsFor(list.id);
      const listKey = P.key(list);
      const card = document.createElement('article'); card.className = 'playlist-card' + (state.activeId === listKey ? ' selected' : '');
      const button = document.createElement('button'); button.className = 'card-open'; button.type = 'button'; button.setAttribute('aria-label', 'Ouvir ' + list.title); button.addEventListener('click', () => openPlaylist(listKey));
      const art = document.createElement('div'); art.className = 'card-art'; art.style.setProperty('--card-a', a); art.style.setProperty('--card-b', b);
      const letter = document.createElement('span'); letter.textContent = artLetter(list.title);
      const play = document.createElement('div'); play.className = 'card-play'; play.append(icon('play')); art.append(letter, play);
      const body = document.createElement('div'); body.className = 'card-body';
      const info = document.createElement('div'); info.className = 'card-info';
      const title = document.createElement('strong'); title.textContent = list.title;
      const subtitle = document.createElement('small'); subtitle.textContent = list.provider === 'spotify' ? 'Spotify · link salvo' : list.synced ? 'YouTube · sua conta' : 'YouTube · link salvo';
      info.append(title, subtitle); body.append(info); button.append(art, body); card.append(button);
      if (list.saved && !list.synced) {
        const remove = document.createElement('button'); remove.className = 'card-remove'; remove.type = 'button'; remove.title = 'Remover desta biblioteca'; remove.setAttribute('aria-label', 'Remover ' + list.title);
        remove.append(icon('trash')); remove.addEventListener('click', () => removePlaylist(listKey)); card.append(remove); card.classList.add('removable');
      }
      grid.append(card);
    }
    const empty = $('#empty-state'); empty.hidden = visible.length > 0;
    $('#empty-title').textContent = state.search ? 'Nenhuma playlist encontrada' : 'A sua biblioteca começa aqui';
    $('#empty-description').textContent = state.search ? 'Tente buscar por outro nome.' : 'Cole uma playlist do YouTube ou Spotify e abra o player.';
    $('#empty-add').hidden = !!state.search;
    renderShortcuts(lists);
  }
  function renderShortcuts(lists) {
    const box = $('#shortcut-list'); box.replaceChildren();
    for (const list of lists.slice(0, 12)) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'shortcut' + (state.activeId === P.key(list) ? ' active' : '');
      const dot = document.createElement('span'); dot.className = 'shortcut-dot'; dot.style.setProperty('--accent', colorsFor(list.id)[0]);
      const text = document.createElement('span'); text.textContent = list.title; row.append(dot, text);
      row.addEventListener('click', () => openPlaylist(P.key(list))); box.append(row);
    }
  }
  function removePlaylist(id) {
    const list = state.saved.find(x => P.key(x) === id); if (!list) return;
    if (!window.confirm('Remover "' + list.title + '" deste navegador?')) return;
    state.saved = state.saved.filter(x => P.key(x) !== id);
    if (!saveLists()) toast('Não foi possível salvar a alteração neste navegador.');
    if (state.activeId === id) resetPlayer();
    renderLibrary(); toast('Playlist removida.');
  }
  function openDialog(dialog, focusSelector) {
    if (!dialog.open) dialog.showModal();
    setTimeout(() => $(focusSelector)?.focus(), 0);
  }
  function addPlaylistDialog() { $('#import-error').hidden = true; openDialog($('#import-dialog'), '#playlist-url'); }
  function settingsDialog() {
    $('#settings-error').hidden = true; $('#client-id').value = state.clientId;
    $('#origin-value').textContent = location.protocol === 'https:' ? location.origin : 'https://SEU-USUARIO.github.io';
    $('#disconnect-button').hidden = !state.token;
    openDialog($('#settings-dialog'), '#client-id');
  }
  function setPlayerStatus(message, level = 'info') {
    const box = $('#player-status'); box.hidden = !message;
    box.dataset.level = level; $('#status-message').textContent = message;
    $('#retry-player').hidden = !state.selected;
  }
  function destroyPlayer() {
    clearTimeout(playerTimer);
    const oldPlayer = state.player;
    state.player = null; state.playerReady = false; state.playerId = null;
    try { oldPlayer?.destroy(); } catch {}
    $('#embed-host').replaceChildren();
    $('#prev-button').disabled = true; $('#next-button').disabled = true;
  }
  function resetPlayer() {
    state.requestId++; destroyPlayer();
    state.activeId = null; state.selected = null; state.items = []; state.playlistIds = []; state.queueLimit = 60;
    $('#player-frame').classList.remove('spotify-frame');
    $('#player-placeholder').hidden = false;
    $('#playing-title').textContent = 'Nada por aqui ainda'; $('#playing-description').textContent = 'Adicione sua primeira playlist e dê o play.';
    $('#listen-title').textContent = 'Seu player'; $('#listen-subtitle').textContent = 'Escolha uma playlist para começar.';
    $('#source-link').hidden = true; $('#source-badge').hidden = true;
    setPlayerStatus(''); renderQueue(); renderLibrary();
  }
  function selectPlaylist(id) {
    const list = allLists().find(x => P.key(x) === id); if (!list) return null;
    state.activeId = id; state.selected = list; state.items = []; state.playlistIds = []; state.queueLimit = 60;
    const providerName = list.provider === 'spotify' ? 'Spotify' : 'YouTube';
    $('#listen-title').textContent = list.title; $('#listen-subtitle').textContent = 'Aperte Play no player do ' + providerName + ' para ouvir.';
    $('#playing-title').textContent = list.title; $('#playing-description').textContent = 'Playlist do ' + providerName;
    const cover = $('#playing-cover'); cover.textContent = artLetter(list.title);
    const [a, b] = colorsFor(list.id); cover.style.background = `linear-gradient(145deg, ${a}, ${b})`;
    const link = $('#source-link'); link.href = P.sourceUrl(list); link.hidden = false;
    $('#source-link-label').textContent = 'Abrir no ' + providerName;
    const badge = $('#source-badge'); badge.textContent = providerName; badge.hidden = false; badge.dataset.provider = list.provider;
    renderQueue(); renderLibrary();
    $('#listen-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return list;
  }
  function openPlaylist(id) {
    const list = selectPlaylist(id); if (!list) return;
    const request = ++state.requestId;
    destroyPlayer();
    $('#player-frame').classList.toggle('spotify-frame', list.provider === 'spotify');
    $('#player-placeholder').hidden = true;
    const frame = document.createElement('iframe');
    frame.id = 'pulso-embed'; frame.title = 'Playlist de ' + (list.provider === 'spotify' ? 'Spotify' : 'YouTube') + ': ' + list.title;
    frame.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
    frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = P.embedUrl(list, location.origin);
    // The native embed opens immediately. API initialization only adds optional controls.
    frame.addEventListener('load', () => {
      if (request !== state.requestId) return;
      clearTimeout(playerTimer);
    });
    frame.addEventListener('error', () => {
      if (request === state.requestId) setPlayerStatus('O player não carregou. Tente novamente ou abra a playlist na plataforma.', 'error');
    });
    $('#embed-host').append(frame);
    playerTimer = setTimeout(() => {
      if (request === state.requestId) setPlayerStatus('O player está demorando para carregar. Você pode tentar novamente.', 'warning');
    }, 18000);
    if (list.provider === 'spotify') {
      setPlayerStatus('Use os controles e a lista de faixas do Spotify abaixo. Se forem exibidas apenas prévias, abra a playlist no Spotify.');
      updateSpotifyTitle(list, request);
    } else {
      setPlayerStatus(location.protocol === 'file:' ?
        'Abra o endereço publicado no GitHub Pages. O YouTube pode recusar a reprodução ao abrir este arquivo diretamente no computador.' :
        'Aperte Play dentro do player. Não é preciso conectar o Google para tocar uma playlist pública.', location.protocol === 'file:' ? 'warning' : 'info');
      if (validToken()) loadItems(list.id, request);
      attachYoutubeControls(frame, request);
    }
  }
  function ensureIframeAPI() {
    if (window.YT?.Player) return Promise.resolve();
    if (iframePromise) return iframePromise;
    iframePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
      const fail = () => { clearTimeout(timer); script.remove(); iframePromise = null; reject(new Error('API indisponível')); };
      const timer = setTimeout(fail, 12000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
      script.onerror = fail; document.head.append(script);
    });
    return iframePromise;
  }
  async function attachYoutubeControls(frame, request) {
    try {
      await ensureIframeAPI();
      if (request !== state.requestId || !frame.isConnected) return;
      state.playerId = state.activeId;
      state.player = new YT.Player(frame, { events: {
        onReady: (event) => {
          if (request !== state.requestId) return;
          state.player = event.target; state.playerReady = true;
          $('#prev-button').disabled = false; $('#next-button').disabled = false;
          updatePlaylistFromPlayer();
        },
        onStateChange: (event) => {
          if (request !== state.requestId) return;
          if (event.data === 1) setPlayerStatus('Reproduzindo no YouTube.');
          updatePlaylistFromPlayer();
        },
        onError: (event) => {
          if (request !== state.requestId) return;
          const messages = {
            2: 'O YouTube recusou o link ou ID. Confira se ele aponta para uma playlist válida.',
            5: 'O navegador não conseguiu reproduzir este vídeo. Tente novamente ou abra no YouTube.',
            100: 'Esta faixa foi removida ou é privada. Tente a próxima faixa ou abra no YouTube.',
            101: 'O dono desta faixa bloqueou a reprodução em outros sites. Tente a próxima faixa.',
            150: 'O dono desta faixa bloqueou a reprodução em outros sites. Tente a próxima faixa.',
            153: 'O YouTube não recebeu a identificação do site. Use o endereço publicado no GitHub Pages e verifique se a proteção de privacidade do navegador está bloqueando o player.'
          };
          setPlayerStatus((messages[event.data] || 'O YouTube não conseguiu abrir esta playlist.') + ' (Erro ' + event.data + ')', 'error');
        },
        onAutoplayBlocked: () => { if (request === state.requestId) setPlayerStatus('Aperte Play dentro do player para autorizar a reprodução.'); }
      }});
    } catch {
      if (request === state.requestId) {
        $('#prev-button').disabled = true; $('#next-button').disabled = true;
        setPlayerStatus('Use os controles dentro do player. Os controles adicionais estão indisponíveis nesta conexão.', 'warning');
        renderQueue();
      }
    }
  }
  async function updateSpotifyTitle(list, request) {
    if (!list.autoTitle) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const url = new URL('https://open.spotify.com/oembed'); url.searchParams.set('url', P.sourceUrl(list));
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.title !== 'string' || !data.title.trim()) return;
      const saved = state.saved.find(x => P.key(x) === P.key(list));
      if (!saved) return;
      saved.title = data.title.slice(0, 200); saved.autoTitle = false; saveLists(); renderLibrary();
      if (request === state.requestId) {
        state.selected.title = saved.title; $('#playing-title').textContent = saved.title; $('#listen-title').textContent = saved.title;
      }
    } catch { /* Metadata is optional; native playback does not depend on this request. */ }
    finally { clearTimeout(timer); }
  }
  function updatePlaylistFromPlayer() {
    if (!state.playerReady || !state.activeId || state.playerId !== state.activeId || state.selected?.provider !== 'youtube') return;
    try {
      const ids = state.player.getPlaylist?.();
      if (Array.isArray(ids) && ids.length) state.playlistIds = ids;
      const data = state.player.getVideoData?.();
      if (data?.title) $('#playing-description').textContent = data.title;
      renderQueue();
    } catch { /* Some embed states have no playlist data yet. */ }
  }
  function renderQueue() {
    const box = $('#queue-list'); box.replaceChildren();
    if (state.selected?.provider === 'spotify') {
      $('#queue-count').textContent = 'Spotify';
      const panel = document.createElement('div'); panel.className = 'provider-info';
      const label = document.createElement('span'); label.className = 'provider-icon'; label.textContent = '♫';
      const title = document.createElement('h4'); title.textContent = 'Sua playlist no Spotify';
      const text = document.createElement('p'); text.textContent = 'A lista de músicas e os controles estão dentro do player oficial. Escolha uma faixa por lá para ouvir.';
      const hint = document.createElement('p'); hint.textContent = 'A reprodução completa depende da disponibilidade do Spotify e do suporte do navegador a áudio protegido. O player pode exibir prévias.';
      const link = document.createElement('a'); link.href = P.sourceUrl(state.selected); link.target = '_blank'; link.rel = 'noopener'; link.className = 'outline-button'; link.textContent = 'Abrir no Spotify';
      panel.append(label, title, text, hint, link); box.append(panel); return;
    }
    const ids = state.playlistIds.length ? state.playlistIds : state.items.map(x => x.id);
    $('#queue-count').textContent = ids.length + (ids.length === 1 ? ' faixa' : ' faixas');
    if (!ids.length) {
      const empty = document.createElement('div'); empty.className = 'queue-empty';
      const note = document.createElement('div'); note.className = 'queue-empty-icon'; note.textContent = '♫';
      const hint = document.createElement('p'); hint.textContent = state.activeId ? 'A fila aparece quando o YouTube disponibilizar as faixas. Você já pode usar o player e a lista de vídeos dentro dele.' : 'As faixas aparecem aqui quando você escolher uma playlist.';
      empty.append(note, hint); box.append(empty); return;
    }
    let activeIndex = -1;
    try { activeIndex = state.playerReady ? state.player.getPlaylistIndex() : -1; } catch {}
    state.queueLimit = Math.max(state.queueLimit, activeIndex + 20);
    const details = new Map(state.items.map(item => [item.id, item]));
    ids.slice(0, state.queueLimit).forEach((id, index) => {
      const detail = details.get(id) || {};
      const row = document.createElement('button'); row.type = 'button'; row.className = 'queue-track' + (index === activeIndex ? ' current' : '');
      row.setAttribute('aria-label', `Tocar faixa ${index + 1}: ${detail.title || 'Faixa ' + (index + 1)}`);
      const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String(index + 1).padStart(2, '0');
      let thumb;
      if (/^[\w-]{11}$/.test(id)) { thumb = document.createElement('img'); thumb.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; thumb.alt = ''; thumb.loading = 'lazy'; thumb.className = 'track-thumb'; }
      else { thumb = document.createElement('div'); thumb.className = 'track-thumb track-placeholder'; thumb.textContent = '♫'; }
      const description = document.createElement('div'); description.style.minWidth = '0';
      const title = document.createElement('span'); title.className = 'track-name'; title.textContent = detail.title || `Faixa ${index + 1}`;
      const channel = document.createElement('span'); channel.className = 'track-sub'; channel.textContent = detail.channel || (state.items.length ? 'YouTube' : 'Conecte o Google para ver o nome');
      description.append(title, channel); row.append(number, thumb, description);
      row.addEventListener('click', () => {
        if (state.playerReady && state.playerId === state.activeId && state.playlistIds.length) {
          state.player.playVideoAt(index);
        } else toast('Aguarde a lista terminar de carregar no player.');
      });
      box.append(row);
    });
    if (ids.length > state.queueLimit) {
      const more = document.createElement('button'); more.className = 'queue-more'; more.type = 'button';
      more.textContent = `Mostrar mais faixas (${ids.length - state.queueLimit})`;
      more.addEventListener('click', () => { state.queueLimit += 60; renderQueue(); }); box.append(more);
    }
  }
  function validToken() { return !!state.token && Date.now() < state.tokenExpires - 30000; }
  async function youtubeGet(path, params) {
    if (!validToken()) throw new Error('Sessão expirada. Conecte o Google novamente.');
    const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + state.token }, cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { state.token = null; updateAccountUI(); }
      throw new Error(data.error?.message || `Erro ${response.status} na API do YouTube.`);
    }
    return response.json();
  }
  async function loadItems(id, request) {
    try {
      const items = []; let pageToken = '';
      for (let page = 0; page < 20; page++) {
        const data = await youtubeGet('playlistItems', { part: 'snippet,contentDetails', playlistId: id, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
        for (const item of data.items || []) {
          const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
          if (videoId) items.push({ id: videoId, title: item.snippet?.title || 'Vídeo indisponível', channel: item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'YouTube' });
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
      if (request !== state.requestId) return;
      state.items = items; renderQueue();
    } catch (error) { if (request === state.requestId) toast('Não foi possível listar as faixas: ' + error.message); }
  }
  function updateAccountUI() {
    const connected = validToken();
    $('#connect-button').classList.toggle('connected', connected);
    $('#connect-label').textContent = state.syncing ? 'Sincronizando...' : connected ? 'Sincronizar' : 'Conectar Google';
    $('#connect-button').disabled = state.syncing;
    if ($('#settings-dialog').open) $('#disconnect-button').hidden = !state.token;
  }
  function connectGoogle() {
    if (!state.clientId) { settingsDialog(); toast('Configure o Client ID para conectar sua conta.'); return; }
    if (!window.google?.accounts?.oauth2) { toast('O login do Google ainda está carregando. Tente novamente em instantes.'); return; }
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: state.clientId, scope: SCOPE,
        callback: (result) => {
          if (result.error || !result.access_token) { toast('A conexão com o Google não foi concluída.'); return; }
          state.token = result.access_token;
          state.tokenExpires = Date.now() + (Number(result.expires_in) || 3600) * 1000;
          updateAccountUI(); syncPlaylists();
        },
        error_callback: () => toast('A janela de login não abriu ou foi fechada. Permita pop-ups e tente novamente.')
      });
      client.requestAccessToken();
    } catch { toast('Não foi possível iniciar o login. Confira o Client ID e a origem configurada.'); }
  }
  async function syncPlaylists() {
    if (!validToken()) { state.token = null; updateAccountUI(); connectGoogle(); return; }
    if (state.syncing) return;
    state.syncing = true; updateAccountUI();
    try {
      const lists = []; let pageToken = '';
      for (let page = 0; page < 20; page++) {
        const data = await youtubeGet('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '50', ...(pageToken ? { pageToken } : {}) });
        for (const item of data.items || []) {
          if (item.id) lists.push({ provider: 'youtube', id: item.id, title: item.snippet?.title || 'Playlist sem nome', synced: true });
        }
        pageToken = data.nextPageToken; if (!pageToken) break;
      }
      state.synced = lists; renderLibrary(); toast(`${lists.length} ${lists.length === 1 ? 'playlist sincronizada' : 'playlists sincronizadas'}.`);
    } catch (error) { toast('Falha ao sincronizar: ' + error.message); }
    finally { state.syncing = false; updateAccountUI(); }
  }
  function disconnectGoogle() {
    const token = state.token; state.token = null; state.tokenExpires = 0; state.synced = [];
    if (token && window.google?.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(token, () => {});
    if (state.activeId && !state.saved.some(x => P.key(x) === state.activeId)) resetPlayer();
    renderLibrary(); updateAccountUI(); $('#settings-dialog').close(); toast('Conta desconectada neste navegador.');
  }
  function setSection(section) {
    $$('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === section));
    $('#crumb-current').textContent = section === 'home' ? 'Início' : 'Biblioteca';
    (section === 'home' ? $('#inicio') : $('#library-section')).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function wireEvents() {
    for (const selector of ['#hero-add', '#add-button', '#empty-add', '#side-add', '#mobile-add']) $(selector).addEventListener('click', addPlaylistDialog);
    $$('[data-nav]').forEach(button => button.addEventListener('click', () => setSection(button.dataset.nav)));
    $('#settings-button').addEventListener('click', settingsDialog);
    $('#connect-button').addEventListener('click', () => validToken() ? syncPlaylists() : connectGoogle());
    $('#disconnect-button').addEventListener('click', disconnectGoogle);
    $$('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    $('#import-form').addEventListener('submit', event => {
      event.preventDefault();
      const parsed = P.parse($('#playlist-url').value);
      if (!parsed) { $('#import-error').textContent = 'Cole o link completo de uma playlist do YouTube ou Spotify. No Spotify, use open.spotify.com/playlist/...'; $('#import-error').hidden = false; return; }
      const customTitle = $('#playlist-name').value.trim();
      const title = customTitle || (parsed.provider === 'spotify' ? 'Playlist do Spotify' : `Minha playlist ${state.saved.length + 1}`);
      const id = P.key(parsed);
      const existing = allLists().find(x => P.key(x) === id);
      if (!existing) {
        state.saved.unshift({ ...parsed, title, autoTitle: !customTitle });
        if (!saveLists()) { state.saved.shift(); $('#import-error').textContent = 'O navegador não permitiu salvar esta playlist. Verifique o armazenamento local.'; $('#import-error').hidden = false; return; }
      }
      $('#import-dialog').close(); $('#import-form').reset(); $('#import-error').hidden = true;
      toast(existing ? 'Esta playlist já está na sua biblioteca.' : 'Playlist adicionada à sua biblioteca.');
      openPlaylist(id);
    });
    $('#settings-form').addEventListener('submit', event => {
      event.preventDefault(); const value = $('#client-id').value.trim();
      if (value && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)) {
        $('#settings-error').textContent = 'Digite um Client ID OAuth de Aplicativo da Web válido.'; $('#settings-error').hidden = false; return;
      }
      if (value && !writeStorage(STORAGE_CLIENT, value)) { $('#settings-error').textContent = 'O navegador não permitiu salvar a configuração.'; $('#settings-error').hidden = false; return; }
      if (!value) { try { localStorage.removeItem(STORAGE_CLIENT); } catch {} }
      if (value !== state.clientId && state.token) disconnectGoogle();
      state.clientId = value; $('#settings-dialog').close(); toast(value ? 'Configuração salva. Agora clique em Conectar Google.' : 'Configuração removida.');
    });
    $('#search').addEventListener('input', event => { state.search = event.target.value.trim().toLocaleLowerCase('pt-BR'); renderLibrary(); });
    document.addEventListener('keydown', event => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); }
    });
    $('#prev-button').addEventListener('click', () => { if (state.playerReady) state.player.previousVideo(); });
    $('#next-button').addEventListener('click', () => { if (state.playerReady) state.player.nextVideo(); });
    $('#retry-player').addEventListener('click', () => { if (state.activeId) openPlaylist(state.activeId); });
  }
  // Add a dedicated action rather than making a connected account button silently disconnect.
  const disconnect = document.createElement('button');
  disconnect.id = 'disconnect-button'; disconnect.type = 'button'; disconnect.className = 'disconnect-button';
  disconnect.textContent = 'Desconectar conta'; disconnect.hidden = true;
  $('#settings-form').append(disconnect);
  wireEvents(); renderLibrary(); updateAccountUI();
})();
