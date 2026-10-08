/* Official Spotify PKCE + Web Playback SDK. No client secret or backend. */
(() => {
  'use strict';
  const CLIENT = 'pulso.spotifyClient.v1', SESSION = 'pulso.spotifySession.v1', PKCE = 'pulso.spotifyPKCE.v1';
  const scopes = 'streaming user-read-private user-read-email user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative';
  let session = null, player = null, device = null, refreshPromise = null, sdkPromise = null, generation = 0, authGeneration = 0;
  try { session = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); } catch {}
  function clientId() { try { return localStorage.getItem(CLIENT) || ''; } catch { return ''; } }
  function configure(value) {
    if (value && !/^[a-fA-F0-9]{32}$/.test(value)) throw new Error('O Client ID do Spotify deve ter 32 caracteres. Não use o Client Secret.');
    if (value !== clientId()) logout();
    if (value) localStorage.setItem(CLIENT, value); else localStorage.removeItem(CLIENT);
  }
  function redirectUri() { return location.origin + location.pathname; }
  function hasSession() { return !!(session?.access_token && clientId()); }
  function storeSession(data) {
    session = { ...data, refresh_token: data.refresh_token || session?.refresh_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
    sessionStorage.setItem(SESSION, JSON.stringify(session));
  }
  function random() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join(''); }
  async function authorize(selectedKey) {
    if (!clientId()) throw new Error('Salve seu Client ID do Spotify primeiro.');
    if (location.protocol !== 'https:' || !crypto.subtle) throw new Error('Abra o site publicado no GitHub Pages com HTTPS para conectar o Spotify.');
    const verifier = random(), state = random(), redirect = redirectUri();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    sessionStorage.setItem(PKCE, JSON.stringify({ verifier, state, redirect, client: clientId(), selectedKey, created: Date.now() }));
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: redirect, state, scope: scopes, code_challenge_method: 'S256', code_challenge: challenge }).toString();
    location.assign(url.href);
  }
  async function exchange(values) {
    const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(data.error_description || 'Não foi possível autorizar o Spotify. Confira o Client ID e o endereço de retorno.');
    return data;
  }
  async function handleCallback() {
    const params = new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('error')) return null;
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(PKCE) || 'null'); } catch {}
    // Leave unrelated query parameters alone; only this app's pending login is handled.
    if (!pending) return null;
    history.replaceState(null, '', redirectUri() + location.hash);
    sessionStorage.removeItem(PKCE);
    if (pending.state !== params.get('state') || pending.client !== clientId() || Date.now() - pending.created > 600000) throw new Error('O login expirou ou não corresponde a esta aba. Conecte o Spotify novamente.');
    if (params.has('error')) throw new Error('A autorização do Spotify não foi concluída. Você pode continuar usando o player padrão.');
    const data = await exchange({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: pending.redirect, client_id: pending.client, code_verifier: pending.verifier });
    storeSession(data);
    return pending.selectedKey || null;
  }
  async function token() {
    if (!hasSession()) throw new Error('Conecte o Spotify para usar o modo completo.');
    if (Date.now() < session.expires - 60000) return session.access_token;
    if (!session.refresh_token) { logout(); throw new Error('A sessão expirou. Conecte o Spotify novamente.'); }
    const currentGeneration = authGeneration;
    if (!refreshPromise) refreshPromise = exchange({ grant_type: 'refresh_token', refresh_token: session.refresh_token, client_id: clientId() })
      .then(data => { if (currentGeneration !== authGeneration || !session) throw new Error('Conexão cancelada.'); storeSession(data); return session.access_token; })
      .catch(error => { if (currentGeneration === authGeneration) logout(); throw error; }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  async function request(path, { method = 'GET', body, signal } = {}, retried = false) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Endereço de API inválido.');
    const access = await token();
    const response = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + access, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal || AbortSignal.timeout(15000) });
    if (response.status === 401 && !retried) { session.expires = 0; return request(path, { method, body, signal }, true); }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const messages = { 401: 'A sessão expirou. Conecte o Spotify novamente.', 403: 'O Spotify recusou o acesso. Confira sua conta Premium e os usuários autorizados do app.', 404: 'O dispositivo ainda não está ativo. Aperte Play para iniciar sua playlist.', 429: 'Muitas solicitações ao Spotify. Aguarde um pouco e tente novamente.' };
      throw new Error(messages[response.status] || data.error?.message || 'Erro ' + response.status + ' no Spotify.');
    }
    if (response.status === 204) return null;
    return response.json();
  }
  function ensureSDK() {
    if (window.Spotify?.Player) return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://sdk.scdn.co/spotify-player.js'; script.async = true;
      const fail = () => { clearTimeout(timer); script.remove(); sdkPromise = null; reject(new Error('O player completo do Spotify não carregou. Use o player padrão ou tente novamente.')); };
      const timer = setTimeout(fail, 15000);
      window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(timer); resolve(); };
      script.onerror = fail; document.head.append(script);
    });
    return sdkPromise;
  }
  async function connect({ onState, onError }) {
    if (player && device) return player;
    const currentGeneration = generation;
    await token(); await ensureSDK();
    if (currentGeneration !== generation) throw new Error('Conexão cancelada.');
    if (player) { player.disconnect(); player = null; }
    player = new window.Spotify.Player({ name: 'Pulso — navegador', volume: 0.65, enableMediaSession: true, getOAuthToken: cb => { token().then(cb).catch(error => onError(error.message)); } });
    const instance = player;
    instance.addListener('player_state_changed', onState);
    instance.addListener('autoplay_failed', () => onError('Clique em Play para permitir o áudio neste navegador.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = message => {
        onError(message);
        if (!settled) { settled = true; clearTimeout(timer); instance.disconnect(); if (player === instance) { player = null; device = null; } reject(new Error(message)); }
      };
      const timer = setTimeout(() => fail('O Spotify não disponibilizou este dispositivo. Verifique Premium, áudio protegido e as permissões do aplicativo.'), 25000);
      instance.addListener('ready', ({ device_id }) => {
        if (currentGeneration !== generation) { instance.disconnect(); clearTimeout(timer); reject(new Error('Conexão cancelada.')); return; }
        device = device_id; settled = true; clearTimeout(timer); resolve(instance);
      });
      instance.addListener('not_ready', () => { device = null; onError('O dispositivo ficou indisponível. Volte ao player padrão ou conecte novamente.'); });
      for (const name of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) instance.addListener(name, ({ message }) => fail(name === 'account_error' ? 'O player completo exige Spotify Premium.' : message || 'Erro no player do Spotify.'));
      instance.connect().then(ok => { if (!ok) fail('Não foi possível conectar o player do Spotify.'); }).catch(error => fail(error.message));
    });
  }
  function deviceQuery(extra = {}) {
    if (!device) throw new Error('O player do Spotify ainda está conectando.');
    return new URLSearchParams({ device_id: device, ...extra }).toString();
  }
  async function playPlaylist(id, uri) {
    await player?.activateElement();
    return request('/me/player/play?' + deviceQuery(), { method: 'PUT', body: { context_uri: 'spotify:playlist:' + id, ...(uri ? { offset: { uri } } : {}) } });
  }
  async function addToQueue(uri) { return request('/me/player/queue?' + deviceQuery({ uri }), { method: 'POST' }); }
  async function repeat(mode) { return request('/me/player/repeat?' + deviceQuery({ state: mode }), { method: 'PUT' }); }
  async function shuffle(enabled) { return request('/me/player/shuffle?' + deviceQuery({ state: String(enabled) }), { method: 'PUT' }); }
  async function playlistItems(id, signal) {
    const items = [];
    for (let offset = 0; offset < 1000; offset += 50) {
      let data;
      try { data = await request('/playlists/' + id + '/items?limit=50&offset=' + offset, { signal }); }
      catch (error) { if (!offset) throw error; return items; }
      for (const row of data.items || []) {
        const track = row.item || row.track;
        if (track?.type === 'track' && /^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri || '')) items.push(track);
      }
      if (!data.next) break;
    }
    return items;
  }
  function stop() { const old = player; player = null; device = null; generation++; try { old?.disconnect(); } catch {} }
  function logout() { stop(); authGeneration++; session = null; sessionStorage.removeItem(SESSION); sessionStorage.removeItem(PKCE); }
  window.PulsoSpotify = { clientId, configure, redirectUri, hasSession, authorize, handleCallback, request, connect, playPlaylist, addToQueue, repeat, shuffle, playlistItems, stop, logout, get player() { return player; }, get device() { return device; } };
})();
