/* Pulso: static, dependency-free playlist library. YouTube and Google supply playback/auth. */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const STORAGE_LIST = 'pulso.playlists.v1';
  const STORAGE_CLIENT = 'pulso.oauthClient.v1';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
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

  function readStorage(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function writeStorage(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
  function readSaved() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_LIST) || '[]');
      return Array.isArray(data) ? data.filter(x => x && /^[A-Za-z0-9_-]{10,128}$/.test(x.id) && typeof x.title === 'string').slice(0, 300) : [];
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
    for (const list of state.saved) map.set(list.id, { ...list, saved: true });
    for (const list of state.synced) map.set(list.id, { ...map.get(list.id), ...list, synced: true });
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
      const card = document.createElement('article'); card.className = 'playlist-card' + (state.activeId === list.id ? ' selected' : '');
      const button = document.createElement('button'); button.className = 'card-open'; button.type = 'button'; button.setAttribute('aria-label', 'Ouvir ' + list.title); button.addEventListener('click', () => openPlaylist(list.id));
      const art = document.createElement('div'); art.className = 'card-art'; art.style.setProperty('--card-a', a); art.style.setProperty('--card-b', b);
      const letter = document.createElement('span'); letter.textContent = artLetter(list.title);
      const play = document.createElement('div'); play.className = 'card-play'; play.append(icon('play')); art.append(letter, play);
      const body = document.createElement('div'); body.className = 'card-body';
      const info = document.createElement('div'); info.className = 'card-info';
      const title = document.createElement('strong'); title.textContent = list.title;
      const subtitle = document.createElement('small'); subtitle.textContent = list.synced ? 'YouTube · sua conta' : 'YouTube · link salvo';
      info.append(title, subtitle); body.append(info); button.append(art, body); card.append(button);
      if (list.saved && !list.synced) {
        const remove = document.createElement('button'); remove.className = 'card-remove'; remove.type = 'button'; remove.title = 'Remover desta biblioteca'; remove.setAttribute('aria-label', 'Remover ' + list.title);
        remove.append(icon('trash')); remove.addEventListener('click', () => removePlaylist(list.id)); body.append(remove);
      }
      grid.append(card);
    }
    const empty = $('#empty-state'); empty.hidden = visible.length > 0;
    $('#empty-title').textContent = state.search ? 'Nenhuma playlist encontrada' : 'A sua biblioteca começa aqui';
    $('#empty-description').textContent = state.search ? 'Tente buscar por outro nome.' : 'Cole o link de uma playlist do YouTube e comece a ouvir.';
    $('#empty-add').hidden = !!state.search;
    renderShortcuts(lists);
  }
  function renderShortcuts(lists) {
    const box = $('#shortcut-list'); box.replaceChildren();
    for (const list of lists.slice(0, 12)) {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'shortcut' + (state.activeId === list.id ? ' active' : '');
      const dot = document.createElement('span'); dot.className = 'shortcut-dot'; dot.style.setProperty('--accent', colorsFor(list.id)[0]);
      const text = document.createElement('span'); text.textContent = list.title; row.append(dot, text);
      row.addEventListener('click', () => openPlaylist(list.id)); box.append(row);
    }
  }
  function removePlaylist(id) {
    const list = state.saved.find(x => x.id === id); if (!list) return;
    if (!window.confirm('Remover "' + list.title + '" deste navegador?')) return;
    state.saved = state.saved.filter(x => x.id !== id);
    if (!saveLists()) toast('Não foi possível salvar a alteração neste navegador.');
    if (state.activeId === id) resetPlayer();
    renderLibrary(); toast('Playlist removida.');
  }
  function extractPlaylistId(raw) {
    const value = raw.trim();
    if (/^[A-Za-z0-9_-]{10,128}$/.test(value)) return value;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname.toLowerCase())) return null;
      const id = url.searchParams.get('list');
      return id && /^[A-Za-z0-9_-]{10,128}$/.test(id) ? id : null;
    } catch { return null; }
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
  function resetPlayer() {
    state.requestId++; state.activeId = null; state.selected = null; state.items = []; state.playlistIds = []; state.queueLimit = 60;
    if (state.player?.stopVideo) { try { state.player.stopVideo(); } catch {} }
    $('#player-placeholder').hidden = false;
    $('#playing-title').textContent = 'Nada por aqui ainda'; $('#playing-description').textContent = 'Adicione sua primeira playlist e dê o play.';
    $('#listen-title').textContent = 'Seu player'; $('#listen-subtitle').textContent = 'Escolha uma playlist para começar.';
    $('#youtube-link').hidden = true; $('#prev-button').disabled = true; $('#next-button').disabled = true;
    renderQueue(); renderLibrary();
  }
  function selectPlaylist(id) {
    const list = allLists().find(x => x.id === id); if (!list) return null;
    state.activeId = id; state.selected = list; state.items = []; state.playlistIds = []; state.queueLimit = 60;
    $('#listen-title').textContent = list.title; $('#listen-subtitle').textContent = 'Pronto para ouvir no player do YouTube.';
    $('#playing-title').textContent = list.title; $('#playing-description').textContent = 'Playlist do YouTube';
    const cover = $('#playing-cover'); cover.textContent = artLetter(list.title);
    const [a, b] = colorsFor(list.id); cover.style.background = `linear-gradient(145deg, ${a}, ${b})`;
    const link = $('#youtube-link'); link.href = 'https://www.youtube.com/playlist?list=' + encodeURIComponent(id); link.hidden = false;
    $('#prev-button').disabled = false; $('#next-button').disabled = false;
    renderQueue(); renderLibrary();
    $('#listen-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return list;
  }
  async function openPlaylist(id) {
    const list = selectPlaylist(id); if (!list) return;
    const request = ++state.requestId;
    if (validToken()) loadItems(id, request);
    try {
      await ensurePlayer();
      if (request !== state.requestId) return;
      state.player.loadPlaylist({ listType: 'playlist', list: id, index: 0, startSeconds: 0 });
      state.playerId = id; $('#player-placeholder').hidden = true;
      setTimeout(() => { if (request === state.requestId) updatePlaylistFromPlayer(); }, 1600);
    } catch {
      if (request === state.requestId) toast('Não foi possível abrir o player. Verifique sua conexão ou abra no YouTube.');
    }
  }
  function ensureIframeAPI() {
    if (window.YT?.Player) return Promise.resolve();
    if (iframePromise) return iframePromise;
    iframePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { iframePromise = null; reject(new Error('timeout')); }, 15000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { clearTimeout(timer); script.remove(); iframePromise = null; reject(new Error('script')); };
      document.head.append(script);
    });
    return iframePromise;
  }
  async function ensurePlayer() {
    if (state.playerReady && state.player) return state.player;
    await ensureIframeAPI();
    if (state.player) {
      if (state.playerReady) return state.player;
      return new Promise((resolve, reject) => {
        const until = Date.now() + 10000;
        const wait = () => state.playerReady ? resolve(state.player) : Date.now() > until ? reject(new Error('player timeout')) : setTimeout(wait, 100);
        wait();
      });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('player timeout')), 12000);
      state.player = new YT.Player('youtube-player', {
        width: '100%', height: '100%', playerVars: { playsinline: 1, origin: location.origin },
        events: {
          onReady: () => { clearTimeout(timer); state.playerReady = true; resolve(state.player); },
          onStateChange: () => { updatePlaylistFromPlayer(); },
          onError: (event) => {
            if ([100, 101, 150].includes(event.data)) toast('Um vídeo está indisponível para incorporação. Tente a próxima faixa ou abra no YouTube.');
            else toast('O YouTube não conseguiu reproduzir esta faixa.');
          },
          onAutoplayBlocked: () => toast('O navegador bloqueou a reprodução automática. Aperte Play no player para continuar.')
        }
      });
    });
  }
  function updatePlaylistFromPlayer() {
    if (!state.playerReady || !state.activeId || state.playerId !== state.activeId) return;
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
    const ids = state.playlistIds.length ? state.playlistIds : state.items.map(x => x.id);
    $('#queue-count').textContent = ids.length + (ids.length === 1 ? ' faixa' : ' faixas');
    if (!ids.length) {
      const empty = document.createElement('div'); empty.className = 'queue-empty';
      const note = document.createElement('div'); note.className = 'queue-empty-icon'; note.textContent = '♫';
      const hint = document.createElement('p'); hint.textContent = state.activeId ? 'Carregando faixas... Você também pode usar os controles do player.' : 'As faixas aparecem aqui quando você escolher uma playlist.';
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
          if (item.id) lists.push({ id: item.id, title: item.snippet?.title || 'Playlist sem nome', synced: true });
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
    if (state.activeId && !state.saved.some(x => x.id === state.activeId)) resetPlayer();
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
      const id = extractPlaylistId($('#playlist-url').value);
      if (!id) { $('#import-error').textContent = 'Informe um link de playlist válido do YouTube (com list=...).'; $('#import-error').hidden = false; return; }
      const title = $('#playlist-name').value.trim() || `Minha playlist ${state.saved.length + 1}`;
      const existing = allLists().find(x => x.id === id);
      if (!existing) {
        state.saved.unshift({ id, title });
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
  }
  // Add a dedicated action rather than making a connected account button silently disconnect.
  const disconnect = document.createElement('button');
  disconnect.id = 'disconnect-button'; disconnect.type = 'button'; disconnect.className = 'disconnect-button';
  disconnect.textContent = 'Desconectar conta'; disconnect.hidden = true;
  $('#settings-form').append(disconnect);
  wireEvents(); renderLibrary(); updateAccountUI();
})();
