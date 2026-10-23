/* Native word/syllable timings from BiniLyrics/lrc.red. No timings are inferred here. */
'use strict';

const WordTiming = (() => {
  const API = 'https://lyrics-api.binimum.org/';
  const TTM = 'http://www.w3.org/ns/ttml#metadata';
  const cache = new Map();
  const normalize = (s) => String(s || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  function recordingIdentity(track) {
    let artist = String(track.artistName || '').trim().replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    let title = String(track.trackName || '').trim();
    // Some LRCLIB submissions put "Artist - Song" in the artist field, or
    // repeat the artist in the title. Remove only an exact duplicated field.
    const artistParts = artist.split(/\s[-–—]\s/);
    if (artistParts.length > 1 && normalize(artistParts.slice(1).join(' - ')) === normalize(title)) artist = artistParts[0];
    const titleParts = title.split(/\s[-–—]\s/);
    if (titleParts.length > 1 && normalize(titleParts[0]) === normalize(artist)) title = titleParts.slice(1).join(' - ');
    return { ...track, trackName: title, artistName: artist };
  }

  async function request(url, signal, format = 'json') {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const ctl = new AbortController();
    const abort = () => ctl.abort();
    if (signal) signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 6000);
    try {
      const response = await fetch(url, { signal: ctl.signal });
      if (!response.ok) throw new Error(`Word timing service returned ${response.status}`);
      return await response[format]();
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abort);
    }
  }

  function time(value) {
    if (value == null || !value.trim()) return null;
    const s = value.trim();
    if (/^\d+(?:\.\d+)?ms$/.test(s)) return parseFloat(s) / 1000;
    if (/^\d+(?:\.\d+)?s?$/.test(s)) return parseFloat(s);
    const parts = s.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p))) return null;
    if (parts.slice(1).some((p) => Number(p) >= 60)) return null;
    return parts.reduce((n, p) => n * 60 + Number(p), 0);
  }

  function allowedUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['lrc.red', 'lyrics.binimum.org'].includes(url.hostname);
    } catch { return false; }
  }

  function matchingCandidates(track, records) {
    if (!normalize(track.trackName) || !normalize(track.artistName)) return [];
    return records.filter((r) => {
      if (!r || typeof r !== 'object') return false;
      if (r.timing_type !== 'word' || normalize(r.track_name) !== normalize(track.trackName) || normalize(r.artist_name) !== normalize(track.artistName)) return false;
      if (track.duration > 0 && (!Number.isFinite(Number(r.duration)) || Math.abs(Number(r.duration) - track.duration) > 5)) return false;
      return allowedUrl(r.lyricsUrl);
    }).sort((a, b) => {
      const score = (r) => (track.duration > 0 ? Math.abs(Number(r.duration) - track.duration) : 0)
        + (normalize(r.album_name) === normalize(track.albumName) ? 0 : 1);
      return score(a) - score(b);
    });
  }

  function parseTTML(src) {
    const doc = new DOMParser().parseFromString(src, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'tt') return [];
    const body = doc.getElementsByTagNameNS('*', 'body')[0];
    if (!body) return [];
    const lines = [];
    const ignored = (node) => ['x-bg', 'x-translation', 'x-roman'].includes(node.getAttributeNS(TTM, 'role') || node.getAttribute('ttm:role'));
    const text = (node) => {
      if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ');
      if (node.nodeType !== 1 || ignored(node)) return '';
      return [...node.childNodes].map(text).join('');
    };
    for (const p of body.getElementsByTagNameNS('*', 'p')) {
      if (ignored(p)) continue;
      const words = [];
      let prefix = '';
      let invalid = false;
      function visit(node) {
        if (node.nodeType === 3) {
          const value = text(node);
          if (/[^\s\p{P}]/u.test(value)) invalid = true;
          else if (words.length) words[words.length - 1].text += value;
          else prefix += value;
          return;
        }
        if (node.nodeType !== 1 || ignored(node)) return;
        const start = time(node.getAttribute('begin'));
        const end = time(node.getAttribute('end'));
        const nested = [...node.getElementsByTagNameNS('*', 'span')].some((s) => !ignored(s) && s.hasAttribute('begin'));
        if (node.localName === 'span' && !nested && (start != null || end != null)) {
          const value = text(node);
          if (!value.trim()) return;
          if (start == null || end == null || end <= start || (words.length && start < words[words.length - 1].start)) { invalid = true; return; }
          words.push({ text: (words.length ? '' : prefix) + value, start, end });
        } else [...node.childNodes].forEach(visit);
      }
      [...p.childNodes].forEach(visit);
      // A mixed or line-only file must not silently lose untimed vocal lines.
      if (invalid || (!words.length && text(p).trim())) return [];
      if (!words.length) continue;
      words[0].text = words[0].text.trimStart();
      words[words.length - 1].text = words[words.length - 1].text.trimEnd();
      const start = Math.min(time(p.getAttribute('begin')) ?? words[0].start, words[0].start);
      const end = Math.max(time(p.getAttribute('end')) ?? 0, ...words.map((w) => w.end));
      lines.push({ start, end, text: words.map((w) => w.text).join(''), words, wordSync: true, gap: false });
    }
    return lines.sort((a, b) => a.start - b.start);
  }

  async function lookup(track, { signal } = {}) {
    track = recordingIdentity(track);
    const key = JSON.stringify([track.trackName, track.artistName, track.albumName, track.duration]);
    if (cache.has(key)) return cache.get(key);
    const params = new URLSearchParams({ track: track.trackName, artist: track.artistName });
    if (track.duration > 0) params.set('duration', String(Math.round(track.duration)));
    let lastError = null;
    for (const source of ['BiniLyrics', 'lrc.red']) {
      try {
        let records;
        if (source === 'BiniLyrics') {
          const data = await request(`${API}?${params}`, signal);
          records = Array.isArray(data.results) ? data.results : [];
        } else {
          const data = await request(`https://lrc.red/match.json?${params}`, signal);
          records = (Array.isArray(data.hits) ? data.hits : [])
            .filter((r) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(r.isrc || ''))
            .map((r) => ({ track_name: r.title, artist_name: r.artist, album_name: r.album, duration: r.duration,
              timing_type: 'word', lyricsUrl: `https://lrc.red/s/${r.isrc}.song.json` }));
        }
        for (const record of matchingCandidates(track, records).slice(0, 3)) {
          try {
            let src;
            if (source === 'lrc.red') {
              const song = await request(record.lyricsUrl, signal);
              if (song.byModel === true || song.lyrics?.sync !== 'word') continue;
              // Validate the file's identity too, rather than only the search hit.
              const identity = { ...record, track_name: song.title, artist_name: song.artist, duration: song.duration };
              if (!matchingCandidates(track, [identity]).length) continue;
              src = song.source;
            } else src = await request(record.lyricsUrl, signal, 'text');
            if (typeof src !== 'string' || src.length > 2 * 1024 * 1024) continue;
            const lines = parseTTML(src);
            if (!lines.length || (record.duration > 0 && lines[lines.length - 1].end > Number(record.duration) + 2)) continue;
            const result = { lines, record, source };
            cache.set(key, result);
            return result;
          } catch (e) {
            if (signal && signal.aborted) throw e;
            lastError = e;
          }
        }
      } catch (e) {
        if (signal && signal.aborted) throw e;
        lastError = e;
      }
    }
    if (lastError) throw lastError;
    return null;
  }

  // Free-text search for word-timed recordings, so they can be offered directly.
  async function search(q, { signal } = {}) {
    const data = await request(`${API}?${new URLSearchParams({ q })}`, signal);
    const seen = new Set();
    return (Array.isArray(data.results) ? data.results : []).filter((r) => {
      if (!r || r.timing_type !== 'word' || !r.track_name || !r.artist_name || !allowedUrl(r.lyricsUrl)) return false;
      const key = r.id || r.lyricsUrl;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Load the word-timed lyrics for a record returned by search().
  async function load(record, { signal } = {}) {
    if (!allowedUrl(record.lyricsUrl)) throw new Error('Unexpected lyrics address');
    const key = `url:${record.lyricsUrl}`;
    if (cache.has(key)) return cache.get(key);
    const src = await request(record.lyricsUrl, signal, 'text');
    if (typeof src !== 'string' || src.length > 2 * 1024 * 1024) throw new Error('Lyrics file is too large');
    const lines = parseTTML(src);
    if (!lines.length) throw new Error('No word timings in this lyrics file');
    if (record.duration > 0 && lines[lines.length - 1].end > Number(record.duration) + 2) throw new Error('Lyrics run past the end of the recording');
    const result = { lines, record, source: new URL(record.lyricsUrl).hostname === 'lrc.red' ? 'lrc.red' : 'BiniLyrics' };
    cache.set(key, result);
    return result;
  }

  return { recordingIdentity, matchingCandidates, parseTTML, lookup, search, load };
})();

if (typeof module !== 'undefined') module.exports = WordTiming;
