/* URL handling shared by the interface and its regression checks. */
(function (root) {
  'use strict';
  const validId = (provider, id) => typeof id === 'string' &&
    (provider === 'spotify' ? /^[A-Za-z0-9]{22}$/.test(id) : /^[A-Za-z0-9_-]{10,128}$/.test(id));
  function parse(raw) {
    let value = String(raw || '').trim();
    const uri = /^spotify:playlist:([A-Za-z0-9]{22})$/.exec(value);
    if (uri) return { provider: 'spotify', id: uri[1] };
    if (/^[A-Za-z0-9_-]{10,128}$/.test(value)) return { provider: 'youtube', id: value };
    if (/^(?:www\.|m\.|music\.)?youtube\.com\//i.test(value) || /^(?:youtu\.be|open\.spotify\.com)\//i.test(value)) value = 'https://' + value;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      if (url.hostname === 'open.spotify.com') {
        const match = /^\/(?:intl-[a-zA-Z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
        return match ? { provider: 'spotify', id: match[1] } : null;
      }
      if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)) {
        const id = url.searchParams.get('list');
        return validId('youtube', id) ? { provider: 'youtube', id } : null;
      }
    } catch { /* Invalid URL. */ }
    return null;
  }
  function normalize(entry) {
    if (!entry || typeof entry.title !== 'string') return null;
    const provider = entry.provider || 'youtube';
    if (!['youtube', 'spotify'].includes(provider) || !validId(provider, entry.id)) return null;
    return { ...entry, provider, title: entry.title.slice(0, 200) };
  }
  function key(entry) { return entry.provider + ':' + entry.id; }
  function sourceUrl(entry) {
    return entry.provider === 'spotify' ? 'https://open.spotify.com/playlist/' + entry.id :
      'https://www.youtube.com/playlist?list=' + encodeURIComponent(entry.id);
  }
  function embedUrl(entry, origin = '') {
    if (entry.provider === 'spotify') return 'https://open.spotify.com/embed/playlist/' + entry.id + '?utm_source=generator&theme=0';
    const url = new URL('https://www.youtube.com/embed/videoseries');
    url.searchParams.set('list', entry.id);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('autoplay', '0');
    if (/^https?:\/\//.test(origin)) url.searchParams.set('origin', origin);
    return url.href;
  }
  const api = { parse, normalize, key, sourceUrl, embedUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PulsoPlaylist = api;
})(typeof window !== 'undefined' ? window : globalThis);
