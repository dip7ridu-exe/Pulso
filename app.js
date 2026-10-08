/* Pulso 3.0: official players, priority queue and optional Spotify Premium. */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const STORAGE_LIST = 'pulso.playlists.v1';
  const STORAGE_CLIENT = 'pulso.oauthClient.v1';
  const STORAGE_KEY = 'pulso.youtubeKey.v1';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
  const P = window.PulsoPlaylist;
  const SP = window.PulsoSpotify;
  const PALETTES = [
    ['#8f577b', '#463361'], ['#655da7', '#272e63'], ['#bb735c', '#713951'],
    ['#437e88', '#345077'], ['#b57f96', '#594268'], ['#738f70', '#365d58']
  ];
  const state = {
    saved: readSaved(), synced: [], token: null, tokenExpires: 0,
    clientId: readStorage(STORAGE_CLIENT) || '', activeId: null,
    player: null, playerReady: false, playerId: null,
    items: [], playlistIds: [], queueLimit: 60, requestId: 0, search: '',
    syncing: false, selected: null, apiKey: readStorage(STORAGE_KEY) || '',
    queues: { youtube: [], spotify: [] }, blocked: new Set(), blockedAttempts: 0,
    currentMedia: null, ytResumeIndex: 0, spotifyController: null, premium: false,
    spotifyItems: [], spotifyQueue: [], sdkStarted: false, playing: false,
    duration: 0, position: 0, repeat: false, shuffle: false, lastEmbedURI: null, embedTransition: null,
    volume: Math.min(100, Math.max(0, Number(readStorage('pulso.volume.v1') ?? 65) || 0))
  };
  let toastTimer;
  let iframePromise;
  let playerTimer;
  let transportTimer, skipTimer, sleepTimer, queueFetchTimer, spotifyIframePromise;

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
    $('#youtube-api-key').value = state.apiKey;
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
    clearTimeout(skipTimer); clearTimeout(queueFetchTimer); clearInterval(transportTimer);
    try { state.spotifyController?.destroy(); } catch {}
    state.spotifyController = null; SP.stop();
    const oldPlayer = state.player;
    state.player = null; state.playerReady = false; state.playerId = null;
    try { oldPlayer?.destroy(); } catch {}
    $('#embed-host').replaceChildren();
    state.playing = false; state.position = 0; state.duration = 0; state.sdkStarted = false; state.lastEmbedURI = null; state.embedTransition = null;
    $('#premium-view').hidden = true; $('#youtube-recovery').hidden = true;
    syncControls(); updateProgress();
  }
  function resetPlayer() {
    state.requestId++; destroyPlayer();
    state.activeId = null; state.selected = null; state.items = []; state.playlistIds = []; state.queueLimit = 60;
    state.currentMedia = null; $('#spotify-options').hidden = true; $('#back-playlist').hidden = true;
    $('#player-frame').classList.remove('spotify-frame');
    $('#player-placeholder').hidden = false;
    $('#playing-title').textContent = 'Nada por aqui ainda'; $('#playing-description').textContent = 'Adicione sua primeira playlist e dê o play.';
    $('#listen-title').textContent = 'Seu player'; $('#listen-subtitle').textContent = 'Escolha uma playlist para começar.';
    $('#source-link').hidden = true; $('#source-badge').hidden = true;
    setPlayerStatus(''); renderQueue(); renderUpNext(); renderLibrary(); syncControls();
  }
  function selectPlaylist(id) {
    const list = allLists().find(x => P.key(x) === id); if (!list) return null;
    state.activeId = id; state.selected = list; state.items = []; state.playlistIds = []; state.queueLimit = 60;
    state.currentMedia = null; state.blocked.clear(); state.blockedAttempts = 0; state.spotifyItems = []; state.spotifyQueue = [];
    state.repeat = false; state.shuffle = false;
    $('#spotify-options').hidden = list.provider !== 'spotify'; $('#back-playlist').hidden = true;
    const providerName = list.provider === 'spotify' ? 'Spotify' : 'YouTube';
    $('#listen-title').textContent = list.title; $('#listen-subtitle').textContent = 'Aperte Play no player do ' + providerName + ' para ouvir.';
    $('#playing-title').textContent = list.title; $('#playing-description').textContent = 'Playlist do ' + providerName;
    const cover = $('#playing-cover'); cover.textContent = artLetter(list.title);
    const [a, b] = colorsFor(list.id); cover.style.background = `linear-gradient(145deg, ${a}, ${b})`;
    const link = $('#source-link'); link.href = P.sourceUrl(list); link.hidden = false;
    $('#source-link-label').textContent = 'Abrir no ' + providerName;
    const badge = $('#source-badge'); badge.textContent = providerName; badge.hidden = false; badge.dataset.provider = list.provider;
    renderQueue(); renderUpNext(); renderLibrary();
    $('#listen-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return list;
  }
  function openPlaylist(id) {
    const list = selectPlaylist(id); if (!list) return;
    const request = ++state.requestId;
    destroyPlayer();
    if (state.premium && !SP.hasSession()) state.premium = false;
    syncControls();
    $('#player-frame').classList.toggle('spotify-frame', list.provider === 'spotify');
    $('#player-placeholder').hidden = true;
    if (list.provider === 'spotify' && state.premium && SP.hasSession()) {
      $('#spotify-mode').value = 'premium'; startPremium(list, request); return;
    }
    $('#spotify-mode').value = 'embed';
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
      attachSpotifyControls(frame, list, request);
    } else {
      setPlayerStatus(location.protocol === 'file:' ?
        'Abra o endereço publicado no GitHub Pages. O YouTube pode recusar a reprodução ao abrir este arquivo diretamente no computador.' :
        'Aperte Play dentro do player. Não é preciso conectar o Google para tocar uma playlist pública.', location.protocol === 'file:' ? 'warning' : 'info');
      if (validToken() || state.apiKey) loadItems(list.id, request);
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
          state.player.setVolume?.(state.volume);
          syncControls(); transportTimer = setInterval(pollYoutube, 1000);
          updatePlaylistFromPlayer();
          recoverYoutubeList();
        },
        onStateChange: (event) => {
          if (request !== state.requestId) return;
          state.playing = event.data === 1;
          if (event.data === 1) { clearTimeout(skipTimer); state.blockedAttempts = 0; $('#youtube-recovery').hidden = true; setPlayerStatus('Reproduzindo no YouTube.'); }
          if (event.data === 0) {
            if (state.repeat) state.player.playVideo();
            else if (queue().length || state.currentMedia) playNext();
          }
          syncControls(); pollYoutube();
          updatePlaylistFromPlayer();
        },
        onError: (event) => {
          if (request !== state.requestId) return;
          handleYoutubeError(event.data, request);
        },
        onAutoplayBlocked: () => { if (request === state.requestId) setPlayerStatus('Aperte Play dentro do player para autorizar a reprodução.'); }
      }});
    } catch {
      if (request === state.requestId) {
        $('#prev-button').disabled = true; $('#next-button').disabled = true;
        setPlayerStatus('Use os controles dentro do player. Os controles adicionais estão indisponíveis nesta conexão.', 'warning');
        renderQueue();
        syncControls();
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
      if (!state.currentMedia && Array.isArray(ids) && ids.length) state.playlistIds = ids;
      const data = state.player.getVideoData?.();
      if (data?.title) $('#playing-description').textContent = data.title;
      if (data?.video_id) $('#source-link').href = 'https://www.youtube.com/watch?v=' + data.video_id;
      renderQueue();
    } catch { /* Some embed states have no playlist data yet. */ }
  }
  function queue() { return state.queues[state.selected?.provider || 'youtube']; }
  function action(work) { Promise.resolve().then(work).catch(error => toast(error.message || 'Não foi possível concluir esta ação.')); }
  function formatTime(seconds) { const value = Math.max(0, Math.floor(Number(seconds) || 0)); return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0'); }
  function updateProgress() {
    $('#elapsed').textContent = formatTime(state.position); $('#duration').textContent = formatTime(state.duration);
    if (document.activeElement !== $('#progress')) $('#progress').value = state.duration ? state.position / state.duration * 100 : 0;
  }
  function syncControls() {
    const yt = state.selected?.provider === 'youtube' && state.playerReady;
    const premium = state.selected?.provider === 'spotify' && state.premium && !!SP.device;
    const embed = state.selected?.provider === 'spotify' && !state.premium && !!state.spotifyController;
    $('#play-button').disabled = !(yt || premium || embed);
    $('#prev-button').disabled = !(yt || premium || embed);
    $('#next-button').disabled = !(yt || premium || (embed && queue().length));
    $('#repeat-button').disabled = !(yt || premium);
    $('#shuffle-button').disabled = !(premium || (yt && state.playlistIds.length > 1 && !state.currentMedia));
    $('#progress').disabled = !(yt || premium) || !state.duration;
    $('#volume').disabled = !(yt || premium); $('#mute-button').disabled = !(yt || premium);
    $('#volume').value = state.volume; $('#volume-value').textContent = state.volume + '%';
    $('#mute-button').setAttribute('aria-label', state.volume ? 'Silenciar' : 'Restaurar volume');
    $('#mute-button').classList.toggle('active', state.volume === 0);
    $('#add-track').disabled = !state.selected; $('#sleep-timer').disabled = !(yt || premium || embed);
    $('#play-symbol').setAttribute('href', state.playing ? '#i-pause' : '#i-play');
    $('#play-button').setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproduzir');
    for (const feature of ['repeat', 'shuffle']) {
      $('#' + feature + '-button').classList.toggle('active', state[feature]);
      $('#' + feature + '-button').setAttribute('aria-pressed', String(state[feature]));
    }
    $('#control-note').textContent = !state.selected ? 'Escolha uma playlist para ativar os controles.' :
      state.selected.provider === 'spotify' && !state.premium ? 'Volume e avanço livre: selecione Controle completo · Premium.' :
      yt || premium ? 'Espaço: play/pausa · ← →: 10 segundos · M: silenciar' : 'Carregando controles. O player oficial também pode ser usado.';
  }
  function pollYoutube() {
    if (!state.playerReady || state.selected?.provider !== 'youtube') return;
    try { state.position = state.player.getCurrentTime?.() || 0; state.duration = state.player.getDuration?.() || 0; updateProgress(); $('#progress').disabled = !state.duration; } catch {}
  }
  function togglePlay() {
    if ($('#play-button').disabled) return;
    if (state.selected.provider === 'youtube') { if (state.playing) state.player.pauseVideo(); else state.player.playVideo(); }
    else if (state.premium) {
      action(async () => { if (!state.sdkStarted) { await SP.playPlaylist(state.selected.id); state.sdkStarted = true; } else { await SP.player.activateElement(); await SP.player.togglePlay(); } });
    } else state.spotifyController.togglePlay();
  }
  function pauseCurrent() {
    if (state.selected?.provider === 'youtube') state.player?.pauseVideo();
    else if (state.premium) action(() => SP.player?.pause());
    else state.spotifyController?.pause();
  }
  function setVolume(value) {
    if ($('#volume').disabled) return;
    state.volume = Math.round(Math.min(100, Math.max(0, Number(value) || 0)));
    writeStorage('pulso.volume.v1', String(state.volume));
    if (state.selected.provider === 'youtube') { state.player.unMute?.(); state.player.setVolume(state.volume); }
    else action(() => SP.player.setVolume(state.volume / 100));
    syncControls();
  }
  function seekTo(seconds) {
    if ($('#progress').disabled) return;
    const target = Math.max(0, Math.min(state.duration, seconds));
    if (state.selected.provider === 'youtube') state.player.seekTo(target, true);
    else action(() => SP.player.seek(Math.round(target * 1000)));
    state.position = target; updateProgress();
  }
  function renderUpNext() {
    const box = $('#upnext-list'); box.replaceChildren();
    if (state.selected?.provider === 'spotify' && state.premium) {
      $('#clear-queue').hidden = true;
      if (!state.spotifyQueue.length) return;
      const label = document.createElement('div'); label.className = 'queue-label'; label.textContent = 'Fila do Spotify'; box.append(label);
      for (const track of state.spotifyQueue.slice(0, 20)) {
        const row = document.createElement('a'); row.className = 'upnext-track'; row.href = track.external_urls?.spotify || 'https://open.spotify.com/track/' + track.id; row.target = '_blank'; row.rel = 'noopener';
        const title = document.createElement('strong'); title.textContent = track.name || 'Música';
        const sub = document.createElement('small'); sub.textContent = (track.artists || []).map(a => a.name).join(', ') || 'Spotify'; row.append(title, sub); box.append(row);
      }
      return;
    }
    const tracks = queue(); $('#clear-queue').hidden = !tracks.length;
    if (!tracks.length) return;
    const label = document.createElement('div'); label.className = 'queue-label'; label.textContent = 'Suas próximas músicas'; box.append(label);
    tracks.forEach((track, index) => {
      const row = document.createElement('div'); row.className = 'upnext-track';
      const play = document.createElement('button'); play.className = 'upnext-play'; play.type = 'button'; play.textContent = (index + 1) + '. ' + track.title; play.title = 'Tocar agora';
      play.addEventListener('click', () => { if (index) { tracks.splice(index, 1); tracks.unshift(track); } playNext(); });
      const first = document.createElement('button'); first.type = 'button'; first.className = 'queue-small'; first.textContent = '↑'; first.title = 'Mover para o início'; first.setAttribute('aria-label', 'Tocar ' + track.title + ' em seguida'); first.disabled = index === 0;
      first.addEventListener('click', () => { tracks.splice(index, 1); tracks.unshift(track); renderUpNext(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'queue-small'; remove.append(icon('close')); remove.title = 'Remover da fila'; remove.setAttribute('aria-label', 'Remover ' + track.title + ' da fila');
      remove.addEventListener('click', () => { tracks.splice(index, 1); renderUpNext(); syncControls(); }); row.append(play, first, remove); box.append(row);
    });
  }
  function addQueuedTrack(track) {
    if (state.selected?.provider !== track.provider) { toast('Escolha uma playlist da mesma plataforma desta música.'); return; }
    if (track.provider === 'spotify' && state.premium) {
      action(async () => { await SP.addToQueue(track.uri); toast('Música adicionada à fila do Spotify.'); refreshSpotifyQueue(); }); return;
    }
    if (queue().length >= 100) { toast('Sua fila já tem 100 músicas. Remova algumas antes de adicionar.'); return; }
    queue().push(track); renderUpNext(); syncControls(); toast('Música adicionada para tocar em seguida.');
  }
  function youtubePlaylistIndex() { try { return Math.max(0, state.player.getPlaylistIndex()); } catch { return 0; } }
  function restoreYoutubePlaylist() {
    state.currentMedia = null; $('#back-playlist').hidden = true;
    const ids = state.playlistIds.length ? state.playlistIds : state.items.map(item => item.id);
    if (ids.length) state.player.loadPlaylist({ playlist: ids, index: Math.min(state.ytResumeIndex + 1, ids.length - 1) });
    else state.player.loadPlaylist({ list: state.selected.id, listType: 'playlist', index: state.ytResumeIndex + 1 });
    renderQueue(); syncControls();
  }
  function playNext() {
    if (!state.selected) return;
    if (state.selected.provider === 'spotify' && state.premium) { action(() => SP.player?.nextTrack()); return; }
    const track = queue()[0];
    if (track) {
      if (state.selected.provider === 'youtube' && !state.playerReady || state.selected.provider === 'spotify' && !state.spotifyController) { toast('Aguarde os controles carregarem. Você pode usar o player oficial.'); return; }
      queue().shift();
      if (track.provider === 'youtube') {
        if (!state.currentMedia) state.ytResumeIndex = youtubePlaylistIndex();
        state.currentMedia = track; state.player.loadVideoById(track.id);
      } else {
        state.currentMedia = track; state.lastEmbedURI = null; state.embedTransition = track.uri;
        const controller = state.spotifyController;
        (controller.loadEntity || controller.loadUri).call(controller, track.uri);
        controller.play();
      }
      $('#playing-description').textContent = track.title; $('#source-link').href = P.trackUrl(track); $('#back-playlist').hidden = false;
      renderUpNext(); syncControls(); return;
    }
    if (state.selected.provider === 'youtube' && state.playerReady) { if (state.currentMedia) restoreYoutubePlaylist(); else state.player.nextVideo(); }
    else if (state.currentMedia && state.spotifyController) {
      state.currentMedia = null; state.lastEmbedURI = null;
      (state.spotifyController.loadEntity || state.spotifyController.loadUri).call(state.spotifyController, 'spotify:playlist:' + state.selected.id);
      state.spotifyController.play(); $('#back-playlist').hidden = true; $('#source-link').href = P.sourceUrl(state.selected);
      setPlayerStatus('Fila concluída. Voltando ao início da playlist; aperte Play se o navegador solicitar.');
    }
  }
  function previousTrack() {
    if (state.selected?.provider === 'youtube' && state.playerReady) { if (state.currentMedia) state.player.seekTo(0, true); else state.player.previousVideo(); }
    else if (state.premium) action(() => SP.player?.previousTrack());
    else state.spotifyController?.restart();
  }
  function recoverYoutubeList() {
    if (!state.playerReady || state.selected?.provider !== 'youtube' || state.currentMedia || !state.items.length) return;
    let nativeIds = [];
    try { nativeIds = state.player.getPlaylist() || []; } catch {}
    if (!nativeIds.length) {
      state.playlistIds = state.items.map(x => x.id);
      state.player.cuePlaylist({ playlist: state.playlistIds, index: 0 });
      setPlayerStatus('Lista de faixas carregada. Aperte Play para ouvir; as músicas bloqueadas serão puladas.');
      $('#youtube-recovery').hidden = true; renderQueue(); syncControls();
    }
  }
  function handleYoutubeError(code, request) {
    state.playing = false; syncControls();
    const messages = {
      2: 'O YouTube recusou o link ou ID. Confira o link da playlist.',
      5: 'O navegador não conseguiu reproduzir este vídeo. Tente novamente ou abra no YouTube.',
      100: 'Esta faixa foi removida ou é privada.',
      101: 'O dono desta faixa bloqueou a reprodução fora do YouTube.',
      150: 'O dono desta faixa bloqueou a reprodução fora do YouTube.',
      153: 'O YouTube não recebeu a identificação do site. Use o endereço HTTPS do GitHub Pages e verifique a proteção de privacidade do navegador.'
    };
    const message = (messages[code] || 'O YouTube não conseguiu abrir esta playlist.') + ' (Erro ' + code + ')';
    if (![100, 101, 150].includes(code)) { setPlayerStatus(message, 'error'); return; }
    const ids = state.playlistIds.length ? state.playlistIds : state.items.map(x => x.id);
    let videoId;
    try { videoId = state.currentMedia?.id || state.player.getVideoData()?.video_id || ids[youtubePlaylistIndex()]; } catch {}
    if (videoId) state.blocked.add(videoId);
    state.blockedAttempts++; renderQueue();
    const available = ids.filter(id => !state.blocked.has(id));
    const limit = ids.length ? Math.min(ids.length, 20) : 2;
    if (queue().length && state.blockedAttempts < 20 || available.length && state.blockedAttempts < limit || !ids.length && state.blockedAttempts < limit) {
      setPlayerStatus(message + ' Pulando para a próxima faixa…', 'warning');
      clearTimeout(skipTimer); skipTimer = setTimeout(() => { if (request === state.requestId) playNext(); }, 650);
      return;
    }
    setPlayerStatus(message, 'error'); $('#youtube-recovery').hidden = false;
    $('#recovery-message').textContent = ids.length ? 'As faixas tentadas estão indisponíveis neste site. Abra no YouTube ou adicione uma música que permita reprodução em outros sites.' :
      'O player também não entregou a lista de músicas. Carregue as faixas com o Google ou uma chave de API nas configurações para tentar as próximas. Você pode abrir a playlist no YouTube.';
  }
  function renderQueue() {
    const box = $('#queue-list'); box.replaceChildren();
    if (state.selected?.provider === 'spotify') {
      $('#queue-count').textContent = state.premium ? state.spotifyQueue.length + ' na fila' : queue().length + ' a seguir';
      if (state.premium && state.spotifyItems.length) {
        const label = document.createElement('div'); label.className = 'queue-label'; label.textContent = 'Faixas da playlist'; box.append(label);
        for (const track of state.spotifyItems.slice(0, state.queueLimit)) {
          const row = document.createElement('div'); row.className = 'queue-track queue-track-row';
          const play = document.createElement('button'); play.type = 'button'; play.className = 'track-select';
          const title = document.createElement('span'); title.className = 'track-name'; title.textContent = track.name;
          const sub = document.createElement('span'); sub.className = 'track-sub'; sub.textContent = (track.artists || []).map(a => a.name).join(', '); play.append(title, sub);
          play.addEventListener('click', () => action(async () => { await SP.playPlaylist(state.selected.id, track.uri); state.sdkStarted = true; }));
          const add = document.createElement('button'); add.type = 'button'; add.className = 'queue-small'; add.append(icon('plus')); add.title = 'Adicionar à fila'; add.setAttribute('aria-label', 'Adicionar ' + track.name + ' à fila'); add.addEventListener('click', () => addQueuedTrack({ provider: 'spotify', type: 'track', id: track.id, uri: track.uri, title: track.name }));
          row.append(play, add); box.append(row);
        }
        if (state.spotifyItems.length > state.queueLimit) appendMore(box, state.spotifyItems.length);
        return;
      }
      const panel = document.createElement('div'); panel.className = 'provider-info';
      const title = document.createElement('h4'); title.textContent = state.premium ? 'Sua fila, seu ritmo' : 'Sua playlist no Spotify';
      const text = document.createElement('p'); text.textContent = state.premium ? 'Aperte Play para iniciar. Cole links de músicas em Adicionar música para incluir na fila oficial do Spotify. A lista completa depende das permissões da playlist.' : 'Escolha as faixas no player oficial ou adicione links de músicas à sua fila. O Pulso troca para a próxima quando recebe o evento de fim; você também pode usar o botão Próxima.';
      const hint = document.createElement('p'); hint.textContent = state.premium ? 'A fila adicionada segue a ordem do Spotify. O acesso às faixas da playlist pode ser limitado às suas próprias playlists.' : 'O player padrão pode tocar prévias. O volume fica no navegador/sistema; o modo Premium libera o controle dentro do Pulso.';
      panel.append(title, text, hint); box.append(panel); return;
    }
    const ids = state.playlistIds.length ? state.playlistIds : state.items.map(x => x.id);
    $('#queue-count').textContent = ids.length + (ids.length === 1 ? ' faixa' : ' faixas');
    if (!ids.length) {
      const empty = document.createElement('div'); empty.className = 'queue-empty';
      const note = document.createElement('div'); note.className = 'queue-empty-icon'; note.textContent = '♫';
      const hint = document.createElement('p'); hint.textContent = state.activeId ? 'A lista aparece quando o YouTube liberar as faixas. Se não carregar, use Carregar lista de faixas ou adicione links de músicas.' : 'Escolha uma playlist para montar sua fila.';
      empty.append(note, hint); box.append(empty); return;
    }
    const activeIndex = state.currentMedia ? -1 : youtubePlaylistIndex();
    state.queueLimit = Math.max(state.queueLimit, activeIndex + 20);
    const details = new Map(state.items.map(item => [item.id, item]));
    ids.slice(0, state.queueLimit).forEach((id, index) => {
      const detail = details.get(id) || {};
      const row = document.createElement('div'); row.className = 'queue-track queue-track-row' + (index === activeIndex ? ' current' : '') + (state.blocked.has(id) ? ' blocked' : '');
      const play = document.createElement('button'); play.type = 'button'; play.className = 'track-select with-thumb'; play.setAttribute('aria-label', 'Tocar ' + (detail.title || 'Faixa ' + (index + 1)));
      const thumb = document.createElement('img'); thumb.src = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; thumb.alt = ''; thumb.loading = 'lazy'; thumb.className = 'track-thumb';
      const description = document.createElement('div'); description.style.minWidth = '0';
      const title = document.createElement('span'); title.className = 'track-name'; title.textContent = detail.title || 'Faixa ' + (index + 1);
      const channel = document.createElement('span'); channel.className = 'track-sub'; channel.textContent = state.blocked.has(id) ? 'Bloqueada para este site' : detail.channel || 'YouTube';
      description.append(title, channel); play.append(thumb, description);
      play.addEventListener('click', () => {
        if (!state.playerReady) { toast('Aguarde o player carregar.'); return; }
        state.currentMedia = null; $('#back-playlist').hidden = true;
        const nativeIds = state.player.getPlaylist?.() || [];
        if (nativeIds.length === ids.length && nativeIds.every((id, at) => id === ids[at])) state.player.playVideoAt(index); else state.player.loadPlaylist({ playlist: ids, index });
      });
      const add = document.createElement('button'); add.type = 'button'; add.className = 'queue-small'; add.append(icon('plus')); add.title = 'Tocar em seguida'; add.setAttribute('aria-label', 'Adicionar ' + title.textContent + ' à fila');
      add.addEventListener('click', () => addQueuedTrack({ provider: 'youtube', type: 'video', id, title: title.textContent }));
      row.append(play, add); box.append(row);
    });
    if (ids.length > state.queueLimit) appendMore(box, ids.length);
  }
  function appendMore(box, count) {
    const more = document.createElement('button'); more.className = 'queue-more'; more.type = 'button'; more.textContent = 'Mostrar mais faixas (' + (count - state.queueLimit) + ')';
    more.addEventListener('click', () => { state.queueLimit += 60; renderQueue(); }); box.append(more);
  }
  function ensureSpotifyIframeAPI() {
    if (window.PulsoSpotifyIframeAPI) return Promise.resolve(window.PulsoSpotifyIframeAPI);
    if (spotifyIframePromise) return spotifyIframePromise;
    spotifyIframePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://open.spotify.com/embed/iframe-api/v1'; script.async = true;
      const fail = () => { clearTimeout(timer); spotifyIframePromise = null; script.remove(); reject(new Error('Controles adicionais indisponíveis.')); };
      const timer = setTimeout(fail, 12000);
      window.onSpotifyIframeApiReady = api => { clearTimeout(timer); window.PulsoSpotifyIframeAPI = api; resolve(api); };
      script.onerror = fail; document.head.append(script);
    }); return spotifyIframePromise;
  }
  async function attachSpotifyControls(frame, list, request) {
    try {
      const api = await ensureSpotifyIframeAPI();
      if (request !== state.requestId || !frame.isConnected) return;
      api.createController(frame, { uri: 'spotify:playlist:' + list.id, width: $('#embed-host').clientWidth || 600, height: 450 }, controller => {
        if (request !== state.requestId) { controller.destroy(); return; }
        // createController has its own iframe. Preserve encrypted-media permissions.
        const created = $('#embed-host').querySelector('iframe');
        if (created) { created.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'; created.referrerPolicy = 'strict-origin-when-cross-origin'; created.title = 'Playlist Spotify: ' + list.title; }
        const ready = () => { if (request !== state.requestId) return; state.spotifyController = controller; syncControls(); };
        controller.addListener('ready', ready); ready();
        controller.addListener('playback_started', event => {
          if (request !== state.requestId) return;
          const uri = event.data?.playingURI;
          if (state.embedTransition && uri !== state.embedTransition) return;
          state.embedTransition = null;
          const changed = state.lastEmbedURI && uri && state.lastEmbedURI !== uri;
          state.lastEmbedURI = uri; state.playing = true; syncControls();
          if (changed && queue().length) playNext();
        });
        controller.addListener('playback_update', event => {
          if (request !== state.requestId) return;
          const data = event.data || {};
          if (state.embedTransition) {
            if (data.playingURI !== state.embedTransition || data.isPaused) return;
            state.embedTransition = null;
          }
          state.playing = !data.isPaused && !data.isBuffering;
          state.position = (data.position || 0) / 1000; state.duration = (data.duration || 0) / 1000;
          updateProgress(); syncControls();
          if (data.isPaused && !data.isBuffering && data.duration > 0 && data.position >= data.duration - 300 && (queue().length || state.currentMedia)) playNext();
        });
      });
    } catch {
      if (request !== state.requestId) return;
      if (!$('#embed-host').querySelector('iframe')) {
        frame.src = P.embedUrl(list, location.origin); $('#embed-host').replaceChildren(frame);
      }
      setPlayerStatus('O player padrão está disponível. Use os controles dentro dele; os controles adicionais não carregaram nesta conexão.', 'warning'); syncControls();
    }
  }
  function spotifySettings() {
    $('#spotify-client').value = SP.clientId(); $('#spotify-redirect').textContent = SP.redirectUri();
    $('#spotify-error').hidden = true; $('#spotify-disconnect').hidden = !SP.hasSession(); openDialog($('#spotify-dialog'), '#spotify-client');
  }
  async function startPremium(list, request) {
    $('#premium-view').hidden = false; $('#premium-title').textContent = list.title;
    $('#premium-artist').textContent = 'Preparando o player…'; $('#premium-art').textContent = '♫';
    delete $('#premium-art').dataset.url;
    $('#premium-track-link').href = P.sourceUrl(list);
    setPlayerStatus('Conectando o player completo do Spotify…');
    try {
      await SP.connect({ onState: data => {
        if (state.selected?.provider !== 'spotify' || !state.premium || request !== state.requestId || !data) return;
        const track = data.track_window?.current_track;
        state.playing = !data.paused; state.sdkStarted = true; state.position = data.position / 1000; state.duration = data.duration / 1000;
        state.repeat = data.repeat_mode !== 0; state.shuffle = !!data.shuffle;
        if (track) {
          $('#premium-title').textContent = track.name; $('#premium-artist').textContent = (track.artists || []).map(a => a.name).join(', '); $('#playing-description').textContent = track.name;
          $('#premium-track-link').href = 'https://open.spotify.com/track/' + track.id; $('#source-link').href = $('#premium-track-link').href;
          const art = $('#premium-art'), url = track.album?.images?.[0]?.url;
          if (url && art.dataset.url !== url) { const img = document.createElement('img'); img.src = url; img.alt = 'Capa de ' + (track.album.name || track.name); art.replaceChildren(img); art.dataset.url = url; }
        }
        syncControls(); updateProgress();
        if (state.playing) setPlayerStatus('Reproduzindo no Spotify.');
        clearTimeout(queueFetchTimer); queueFetchTimer = setTimeout(refreshSpotifyQueue, 1000);
      }, onError: message => { if (request === state.requestId) setPlayerStatus(message + ' Você pode voltar ao Player padrão.', 'error'); } });
      if (request !== state.requestId) return;
      await SP.player.setVolume(state.volume / 100); syncControls();
      $('#premium-artist').textContent = 'Aperte Play para começar'; setPlayerStatus('Spotify conectado. Aperte Play para iniciar sua playlist.');
      transportTimer = setInterval(() => { if (state.playing && state.position < state.duration) { state.position++; updateProgress(); } }, 1000);
      SP.playlistItems(list.id).then(items => { if (request === state.requestId) { state.spotifyItems = items; renderQueue(); } }).catch(() => { /* Other users' playlists can still play as a context. */ });
      renderQueue(); renderUpNext();
    } catch (error) { if (request === state.requestId) { setPlayerStatus(error.message + ' Selecione Player padrão para continuar.', 'error'); syncControls(); } }
  }
  async function refreshSpotifyQueue() {
    if (state.selected?.provider !== 'spotify' || !state.premium || !SP.device) return;
    const request = state.requestId;
    try { const data = await SP.request('/me/player/queue'); if (request === state.requestId) { state.spotifyQueue = data.queue || []; renderQueue(); renderUpNext(); } } catch {}
  }
  function validToken() { return !!state.token && Date.now() < state.tokenExpires - 30000; }
  async function youtubeGet(path, params) {
    if (!validToken() && !state.apiKey) throw new Error('Conecte o Google ou configure uma chave da YouTube Data API.');
    const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (!validToken()) url.searchParams.set('key', state.apiKey);
    const response = await fetch(url, { headers: validToken() ? { Authorization: 'Bearer ' + state.token } : {}, cache: 'no-store', signal: AbortSignal.timeout(15000) });
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
      state.items = items; renderQueue(); recoverYoutubeList(); syncControls();
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
          if (state.selected?.provider === 'youtube') loadItems(state.selected.id, state.requestId);
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
      const apiKey = $('#youtube-api-key').value.trim();
      if (value && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)) {
        $('#settings-error').textContent = 'Digite um Client ID OAuth de Aplicativo da Web válido.'; $('#settings-error').hidden = false; return;
      }
      if (apiKey && !/^AIza[\w-]{20,100}$/.test(apiKey)) { $('#settings-error').textContent = 'Confira a chave da YouTube Data API (ela começa com AIza).'; $('#settings-error').hidden = false; return; }
      if (value && !writeStorage(STORAGE_CLIENT, value)) { $('#settings-error').textContent = 'O navegador não permitiu salvar a configuração.'; $('#settings-error').hidden = false; return; }
      if (!value) { try { localStorage.removeItem(STORAGE_CLIENT); } catch {} }
      if (value !== state.clientId && state.token) disconnectGoogle();
      if (!writeStorage(STORAGE_KEY, apiKey)) { toast('O navegador não permitiu salvar a chave.'); return; }
      state.apiKey = apiKey;
      state.clientId = value; $('#settings-dialog').close(); toast('Configuração salva.');
      if (state.selected?.provider === 'youtube' && (apiKey || validToken())) loadItems(state.selected.id, state.requestId);
    });
    $('#search').addEventListener('input', event => { state.search = event.target.value.trim().toLocaleLowerCase('pt-BR'); renderLibrary(); });
    document.addEventListener('keydown', event => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable || document.querySelector('dialog[open]')) return;
      if (event.code === 'Space' && !$('#play-button').disabled) { event.preventDefault(); togglePlay(); }
      if (event.key === 'ArrowRight' && !$('#progress').disabled) { event.preventDefault(); seekTo(state.position + 10); }
      if (event.key === 'ArrowLeft' && !$('#progress').disabled) { event.preventDefault(); seekTo(state.position - 10); }
      if (event.key.toLowerCase() === 'm' && !$('#mute-button').disabled) { event.preventDefault(); $('#mute-button').click(); }
    });
    $('#prev-button').addEventListener('click', previousTrack);
    $('#next-button').addEventListener('click', playNext);
    $('#play-button').addEventListener('click', togglePlay);
    $('#volume').addEventListener('input', event => setVolume(event.target.value));
    let lastVolume = state.volume || 65;
    $('#mute-button').addEventListener('click', () => { if (state.volume) { lastVolume = state.volume; setVolume(0); } else setVolume(lastVolume); });
    $('#progress').addEventListener('change', event => seekTo(Number(event.target.value) / 100 * state.duration));
    $('#repeat-button').addEventListener('click', () => {
      const next = !state.repeat;
      if (state.selected?.provider === 'spotify' && state.premium) action(async () => { await SP.repeat(next ? 'track' : 'off'); state.repeat = next; syncControls(); });
      else { state.repeat = next; syncControls(); }
    });
    $('#shuffle-button').addEventListener('click', () => {
      const next = !state.shuffle;
      if (state.selected?.provider === 'spotify' && state.premium) action(async () => { await SP.shuffle(next); state.shuffle = next; syncControls(); });
      else if (state.playerReady) { state.player.setShuffle(next); state.shuffle = next; updatePlaylistFromPlayer(); syncControls(); }
    });
    $('#sleep-timer').addEventListener('change', event => {
      clearTimeout(sleepTimer); const minutes = Number(event.target.value);
      if (minutes) { sleepTimer = setTimeout(() => { pauseCurrent(); $('#sleep-timer').value = '0'; toast('Temporizador concluído. Música pausada.'); }, minutes * 60000); toast('A música será pausada em ' + minutes + ' minutos.'); }
      else toast('Temporizador desativado.');
    });
    $('#add-track').addEventListener('click', () => {
      if (!state.selected) return;
      $('#track-error').hidden = true;
      $('#track-help').textContent = state.selected.provider === 'spotify' ? state.premium ? 'Cole o link de uma música para adicionar à fila oficial do Spotify.' : 'Cole um link open.spotify.com/track/… para tocar após a música atual. Ao terminar a fila, o player volta ao início da playlist.' : 'Cole o link de um vídeo do YouTube. Ao terminar a fila, o player volta à sua playlist.';
      $('#track-url').placeholder = state.selected.provider === 'spotify' ? 'https://open.spotify.com/track/…' : 'https://www.youtube.com/watch?v=…';
      openDialog($('#track-dialog'), '#track-url');
    });
    $('#track-form').addEventListener('submit', event => {
      event.preventDefault(); const track = P.parseTrack($('#track-url').value);
      if (!track || track.provider !== state.selected?.provider) { $('#track-error').textContent = 'Cole o link de uma música da mesma plataforma da playlist selecionada.'; $('#track-error').hidden = false; return; }
      track.title = $('#track-name').value.trim() || (track.provider === 'spotify' ? 'Música do Spotify' : 'Vídeo do YouTube');
      addQueuedTrack(track); $('#track-dialog').close(); $('#track-url').value = ''; $('#track-name').value = '';
    });
    $('#clear-queue').addEventListener('click', () => { queue().splice(0); renderUpNext(); syncControls(); });
    $('#back-playlist').addEventListener('click', () => {
      if (state.selected?.provider === 'youtube' && state.playerReady) { state.ytResumeIndex = -1; restoreYoutubePlaylist(); }
      else if (state.activeId) openPlaylist(state.activeId);
    });
    $('#skip-blocked').addEventListener('click', () => { state.blockedAttempts = 0; $('#youtube-recovery').hidden = true; playNext(); });
    $('#load-youtube-tracks').addEventListener('click', () => { if (validToken() || state.apiKey) loadItems(state.selected.id, state.requestId); else settingsDialog(); });
    $('#spotify-setup').addEventListener('click', spotifySettings);
    $('#spotify-mode').addEventListener('change', event => {
      if (event.target.value === 'premium' && !SP.hasSession()) { event.target.value = 'embed'; spotifySettings(); return; }
      state.premium = event.target.value === 'premium'; if (state.activeId) openPlaylist(state.activeId);
    });
    $('#spotify-form').addEventListener('submit', event => {
      event.preventDefault(); action(async () => {
        try { SP.configure($('#spotify-client').value.trim()); await SP.authorize(state.activeId); }
        catch (error) { $('#spotify-error').textContent = error.message; $('#spotify-error').hidden = false; }
      });
    });
    $('#spotify-disconnect').addEventListener('click', () => { SP.logout(); state.premium = false; $('#spotify-dialog').close(); if (state.selected?.provider === 'spotify') openPlaylist(state.activeId); toast('Spotify desconectado nesta aba.'); });
    $('#retry-player').addEventListener('click', () => { if (state.activeId) openPlaylist(state.activeId); });
  }
  // Add a dedicated action rather than making a connected account button silently disconnect.
  const disconnect = document.createElement('button');
  disconnect.id = 'disconnect-button'; disconnect.type = 'button'; disconnect.className = 'disconnect-button';
  disconnect.textContent = 'Desconectar conta'; disconnect.hidden = true;
  $('#settings-form').append(disconnect);
  wireEvents(); renderLibrary(); renderUpNext(); updateAccountUI(); syncControls();
  SP.handleCallback().then(key => {
    if (key && allLists().some(list => P.key(list) === key)) { state.premium = true; openPlaylist(key); }
    else if (SP.hasSession()) toast('Spotify conectado. Selecione Controle completo · Premium na sua playlist.');
  }).catch(error => toast(error.message));
  window.addEventListener('pagehide', () => { try { state.spotifyController?.pause(); } catch {} SP.stop(); });
})();
