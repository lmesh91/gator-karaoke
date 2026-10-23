/* Gator Karaoke Club — synced lyrics from LRCLIB (https://lrclib.net) */
'use strict';

const API = 'https://lrclib.net/api';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

/* ======================================================================
   LRC parsing — handles plain LRC, multi-timestamp lines, [offset:],
   and "enhanced" LRC with <mm:ss.xx> word timings.
   ====================================================================== */
const TIME_TAG = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/;
function tagTime(tag) {
  const m = tag.trim().match(TIME_TAG);
  if (!m) return null;
  const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac;
}

function parseBody(body) {
  // Returns { text, chunks: [{text, t}], endTag } — chunks only when word-timed.
  const re = /<(\d+:\d{1,2}(?:[.:]\d{1,3})?)>/g;
  if (!re.test(body)) return { text: body.trim(), chunks: null, endTag: null };
  re.lastIndex = 0;
  const chunks = [];
  let last = 0, lastT = null, m;
  const lead = body.slice(0, body.search(re));
  re.lastIndex = 0;
  while ((m = re.exec(body))) {
    const seg = body.slice(last, m.index);
    if (lastT != null && seg) chunks.push({ text: seg, t: lastT });
    lastT = tagTime(m[1]);
    last = re.lastIndex;
  }
  const tail = body.slice(last);
  let endTag = null;
  if (tail.trim()) chunks.push({ text: tail, t: lastT });
  else endTag = lastT;
  if (lead.trim() && chunks.length) chunks[0].text = lead + chunks[0].text;
  const text = chunks.map((c) => c.text).join('').trim();
  return { text, chunks: chunks.length ? chunks : null, endTag };
}

function parseLRC(src, duration = 0) {
  let offset = 0;
  const raw = [];
  for (const rawLine of src.split(/\r?\n/)) {
    const tags = [];
    let rest = rawLine, m;
    while ((m = rest.match(/^\s*\[([^\]]*)\]/))) { tags.push(m[1]); rest = rest.slice(m[0].length); }
    for (const tag of tags) {
      const om = tag.match(/^offset:\s*([+-]?\d+)/i);
      if (om) { offset = parseInt(om[1], 10) / 1000; continue; }
      const t = tagTime(tag);
      if (t != null) raw.push({ start: t, body: rest });
    }
  }
  raw.sort((a, b) => a.start - b.start);

  const lines = raw.map((r) => {
    const p = parseBody(r.body);
    return { start: Math.max(0, r.start - offset), text: p.text, chunks: p.chunks, endTag: p.endTag != null ? p.endTag - offset : null };
  });

  // Word tags define syllable/word durations; otherwise estimate the pacing
  // and give any remaining line time to a held final word.
  lines.forEach((L, i) => {
    const next = lines[i + 1] ? lines[i + 1].start : duration > L.start ? duration : L.start + 8;
    L.gap = !L.text;
    if (L.gap) { L.end = L.start; L.words = [{ text: '♪', start: L.start, end: L.start }]; return; }

    if (L.chunks) {
      const ws = L.chunks.map((c) => ({ text: c.text, start: Math.max(0, c.t - offset) }));
      const lastStart = ws[ws.length - 1].start;
      const fallbackEnd = Math.max(lastStart, next - 0.05);
      L.end = L.endTag != null ? Math.min(L.endTag, next) : fallbackEnd;
      ws.forEach((w, j) => { w.end = j < ws.length - 1 ? ws[j + 1].start : Math.max(L.end, w.start + 0.05); });
      ws[0].text = ws[0].text.replace(/^\s+/, '');
      L.words = ws;
      L.wordSync = true;
      return;
    }

    const chars = L.text.replace(/\s+/g, '').length;
    const est = 0.4 + chars * 0.075;
    const span = next - L.start;
    const dur = Math.max(0, span - 0.15);
    const pacedDur = Math.min(dur, est * 1.25);
    L.end = L.start + dur;
    const parts = L.text.split(/(?<=\s)(?=\S)/);
    const weights = parts.map((w) => w.trim().length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = L.start;
    L.words = parts.map((w, j) => {
      const d = j === parts.length - 1 ? L.end - t : pacedDur * weights[j] / total;
      const word = { text: w, start: t, end: t + d };
      t += d;
      return word;
    });
  });

  // Drop consecutive gap markers and trailing gaps; they add nothing.
  return lines.filter((L, i) => !(L.gap && (i === lines.length - 1 || (lines[i - 1] && lines[i - 1].gap))));
}

/* ======================================================================
   Media sources: local audio file, YouTube embed, or a free-running clock
   for audio playing on another device.
   ====================================================================== */
const audio = $('#audio');
let yt = null, ytReadyPromise = null, ytVideoId = null, ytLast = { raw: -1, at: 0 };
let ytMode = store.get('gkc.ytMode', 'bg');

const media = {
  kind: 'clock',
  name: 'Stage clock',
  clock: { base: 0, startedAt: null },

  time() {
    if (this.kind === 'file') return audio.currentTime || 0;
    if (this.kind === 'yt') {
      if (!yt || !yt.getCurrentTime) return 0;
      const raw = yt.getCurrentTime() || 0, now = performance.now();
      if (raw !== ytLast.raw) ytLast = { raw, at: now };
      return this.playing() ? raw + Math.min(1, (now - ytLast.at) / 1000) : raw;
    }
    const c = this.clock;
    return c.startedAt == null ? c.base : c.base + (performance.now() - c.startedAt) / 1000;
  },
  duration() {
    if (this.kind === 'file') return isFinite(audio.duration) ? audio.duration : 0;
    if (this.kind === 'yt') return (yt && yt.getDuration && yt.getDuration()) || 0;
    return state.track ? state.track.duration || 0 : 0;
  },
  playing() {
    if (this.kind === 'file') return !audio.paused && !audio.ended;
    if (this.kind === 'yt') return !!(yt && yt.getPlayerState && yt.getPlayerState() === 1);
    return this.clock.startedAt != null;
  },
  play() {
    if (this.kind === 'file') { if (audio.src) audio.play().catch(() => {}); return; }
    if (this.kind === 'yt') { yt && yt.playVideo && yt.playVideo(); return; }
    if (this.clock.startedAt == null) this.clock.startedAt = performance.now();
  },
  pause() {
    if (this.kind === 'file') { audio.pause(); return; }
    if (this.kind === 'yt') { yt && yt.pauseVideo && yt.pauseVideo(); return; }
    if (this.clock.startedAt != null) { this.clock.base = this.time(); this.clock.startedAt = null; }
  },
  toggle() { this.playing() ? this.pause() : this.play(); },
  seek(t) {
    t = Math.max(0, t);
    if (this.kind === 'file') { if (audio.src) audio.currentTime = t; return; }
    if (this.kind === 'yt') { yt && yt.seekTo && yt.seekTo(t, true); ytLast = { raw: -1, at: 0 }; return; }
    this.clock.base = t;
    if (this.clock.startedAt != null) this.clock.startedAt = performance.now();
  },
  use(kind, name) {
    if (this.kind !== kind) this.pause();
    this.kind = kind;
    this.name = name;
    $('#sourceName').textContent = name;
    $('#ytWrap').hidden = kind !== 'yt';
    checkDuration();
  },
};

/* ---------- local files ---------- */
let objectUrl = null;
async function loadFile(file) {
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  media.use('file', file.name);
  selectTab('file');

  const tags = await readId3(file).catch(() => null);
  let query;
  if (tags && tags.title) query = [tags.artist, tags.title].filter(Boolean).join(' ');
  else query = cleanTitle(file.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\d{1,3}[\s.\-_]+/, '').replace(/_/g, ' '));

  const dur = await new Promise((res) => {
    if (isFinite(audio.duration) && audio.duration) return res(audio.duration);
    audio.addEventListener('loadedmetadata', () => res(audio.duration), { once: true });
    setTimeout(() => res(0), 4000);
  });
  autoFind(query, dur, tags);
}

// Minimal ID3v2.3/2.4 reader for title + artist.
async function readId3(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const ver = head[3];
  const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
  const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 512 * 1024)).arrayBuffer());
  const out = {};
  let i = 0;
  if (head[5] & 0x40) { // extended header
    const ext = ver === 4 ? (buf[0] << 21) | (buf[1] << 14) | (buf[2] << 7) | buf[3] : ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) + 4;
    i = ext;
  }
  while (i + 10 < buf.length) {
    const id = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsize = ver === 4
      ? (buf[i + 4] << 21) | (buf[i + 5] << 14) | (buf[i + 6] << 7) | buf[i + 7]
      : (buf[i + 4] << 24) | (buf[i + 5] << 16) | (buf[i + 6] << 8) | buf[i + 7];
    const body = buf.subarray(i + 10, i + 10 + fsize);
    if (id === 'TIT2' || id === 'TPE1') {
      const enc = body[0];
      const label = enc === 0 ? 'latin1' : enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : 'utf-8';
      const txt = new TextDecoder(label).decode(body.subarray(1)).replace(/\0+$/g, '').split('\0')[0].trim();
      out[id === 'TIT2' ? 'title' : 'artist'] = txt;
    }
    if (out.title && out.artist) break;
    i += 10 + fsize;
  }
  return out.title ? out : null;
}

/* ---------- YouTube ---------- */
function ytId(s) {
  s = s.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function loadYTApi() {
  if (ytReadyPromise) return ytReadyPromise;
  ytReadyPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  });
  return ytReadyPromise;
}

let ytSearched = null;
async function loadYouTube(id, { searchLyrics = true } = {}) {
  ytVideoId = id;
  ytSearched = searchLyrics ? null : id;
  media.use('yt', 'YouTube');
  selectTab('yt');
  applyYtMode();
  const YT = await loadYTApi();
  if (!yt) {
    await new Promise((resolve) => {
      yt = new YT.Player('ytPlayer', {
        videoId: id,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
        events: {
          onReady: resolve,
          onStateChange: onYtState,
          onError: (e) => {
            const blocked = e.data === 101 || e.data === 150;
            setWarn(blocked ? 'This video doesn’t allow embedding. Try a different upload (e.g. the “Topic” or lyric-video version).' : 'YouTube couldn’t play that video.');
          },
        },
      });
    });
  } else {
    yt.cueVideoById(id);
  }
  onYtState();
}

function onYtState() {
  if (yt && yt.getDuration) checkDuration();
  if (!yt || !yt.getVideoData || ytSearched === ytVideoId) return;
  const data = yt.getVideoData() || {};
  const dur = yt.getDuration ? yt.getDuration() : 0;
  if (!data.title) return; // metadata not in yet; we'll be called again on the next state change
  ytSearched = ytVideoId;
  media.name = `YouTube · ${data.title}`;
  $('#sourceName').textContent = media.name;
  let q = cleanTitle(data.title);
  const author = (data.author || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  if (!/\s[-–—]\s/.test(data.title) && author && !q.toLowerCase().includes(author.toLowerCase())) q = `${author} ${q}`;
  autoFind(q.replace(/\s[-–—]\s/, ' '), dur);
}

function applyYtMode() {
  const wrap = $('#ytWrap');
  wrap.className = `yt-wrap ${ytMode}`;
  $$('#ytMode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ytMode)));
}

function cleanTitle(t) {
  return t
    .replace(/[([{【][^)\]}】]*(official|video|audio|lyric|lyrics|visuali[sz]er|hd|hq|4k|remaster(ed)?|mv|m\/v|live|explicit|clean)[^)\]}】]*[)\]}】]/gi, ' ')
    .replace(/\b(official (music )?video|official audio|lyric video|with lyrics|lyrics?)\b/gi, ' ')
    .replace(/\s(ft|feat)\.?\s.*$/i, ' ')
    .replace(/[|•].*$/, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ======================================================================
   Lyrics search (LRCLIB)
   ====================================================================== */
const state = { track: null, lines: [], offset: 0, results: [], focus: -2, active: -2 };
let searchCtl = null;

async function search(q) {
  if (searchCtl) searchCtl.abort();
  searchCtl = new AbortController();
  const { signal } = searchCtl;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/search?q=${encodeURIComponent(q)}`, { signal });
    if (res.ok) return res.json();
    // LRCLIB occasionally sheds load with 429/5xx; back off and retry a couple of times.
    if (attempt >= 2 || !(res.status === 429 || res.status >= 500)) throw new Error(`LRCLIB returned ${res.status}`);
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  }
}

async function runSearch(q, { quiet = false } = {}) {
  const status = $('#searchStatus');
  q = q.trim();
  if (!q) return [];
  status.className = 'status';
  status.textContent = 'Searching the swamp…';
  try {
    const list = await search(q);
    state.results = list;
    renderResults();
    if (!quiet) status.textContent = list.length ? '' : 'No matches. Try just the song title, or the artist + title.';
    return list;
  } catch (e) {
    if (e.name === 'AbortError') return [];
    status.className = 'status err';
    status.textContent = `Couldn’t reach the lyrics database (${e.message}).`;
    return [];
  }
}

function renderResults() {
  const ul = $('#results');
  const onlySynced = $('#syncedOnly').checked;
  const list = state.results.filter((r) => !r.instrumental && (!onlySynced || r.syncedLyrics));
  ul.replaceChildren(...list.slice(0, 30).map((r) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'result' + (state.track && state.track.id === r.id ? ' on' : '');
    const title = el('span', 'r-title', r.trackName);
    const meta = el('span', 'r-meta', [r.artistName, r.albumName].filter(Boolean).join(' · '));
    const side = el('span', 'r-side');
    const badge = r.syncedLyrics
      ? el('span', `badge ${/<\d+:\d+/.test(r.syncedLyrics) ? 'word' : 'sync'}`, /<\d+:\d+/.test(r.syncedLyrics) ? 'word sync' : 'synced')
      : el('span', 'badge plain', 'plain');
    side.append(badge, el('span', '', fmt(r.duration)));
    b.append(title, side, meta);
    b.addEventListener('click', () => loadTrack(r));
    li.append(b);
    return li;
  }));
  if (state.results.length && !list.length) {
    $('#searchStatus').textContent = 'Only unsynced lyrics found. Untick “Synced lyrics only” to read along without timing.';
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Search, then auto-load the synced result whose length best matches the audio.
async function autoFind(q, duration, tags) {
  $('#q').value = q;
  let list = await runSearch(q, { quiet: true });
  if (!list.length && tags && tags.title) { $('#q').value = tags.title; list = await runSearch(tags.title, { quiet: true }); }
  const synced = list.filter((r) => r.syncedLyrics && !r.instrumental);
  const status = $('#searchStatus');
  if (!synced.length) {
    status.textContent = list.length ? 'Found the song but no synced lyrics. Pick one below to read along.' : 'No automatic match. Search for it yourself above.';
    return;
  }
  const scored = synced.map((r, i) => ({ r, score: (duration ? Math.abs(r.duration - duration) : 0) + i * 0.4 }));
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  const diff = duration ? Math.abs(best.r.duration - duration) : 0;
  if (!duration || diff <= 8) {
    loadTrack(best.r);
    status.textContent = `Auto-matched “${best.r.trackName}”. Wrong one? Pick another below.`;
  } else {
    status.textContent = 'No result matched your audio’s length closely. Pick the best one below.';
  }
}

/* ======================================================================
   Stage rendering
   ====================================================================== */
const lyricsEl = $('#lyrics');
const viewport = $('#viewport');
const countdown = $('#countdown');

function loadTrack(r) {
  state.track = r;
  state.offset = store.get(`gkc.off.${r.id}`, 0);
  state.lines = r.syncedLyrics ? parseLRC(r.syncedLyrics, r.duration) : [];
  state.active = state.focus = -2;
  $('#trackTitle').textContent = r.trackName;
  $('#trackArtist').textContent = [r.artistName, r.albumName].filter(Boolean).join(' · ');
  $('#welcome').hidden = true;
  const plain = $('#plain');
  plain.hidden = !!state.lines.length;
  plain.textContent = state.lines.length ? '' : (r.plainLyrics || 'No lyrics text for this one.');
  renderLines();
  renderOffset();
  renderResults();
  checkDuration();
  document.title = `${r.trackName} · Gator Karaoke Club`;
}

function renderLines() {
  const frag = document.createDocumentFragment();
  state.lines.forEach((L, i) => {
    const d = el('div', 'line' + (L.gap ? ' gap' : ''));
    L.el = d;
    L.wordEls = L.words.map((w) => { const s = el('span', 'w', w.text); d.append(s); return s; });
    L.lastP = null;
    d.addEventListener('click', () => {
      media.seek(L.start - state.offset - 0.6);
      if (!media.playing()) media.play();
    });
    frag.append(d);
  });
  lyricsEl.replaceChildren(frag);
  lyricsEl.style.transform = 'translateY(0)';
  countdown.hidden = true;
}

function findActive(t) {
  const L = state.lines;
  let lo = 0, hi = L.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (L[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function centerOn(idx) {
  const L = state.lines[idx] || state.lines[0];
  if (!L) return;
  const y = viewport.clientHeight * 0.45 - (L.el.offsetTop + L.el.offsetHeight / 2);
  lyricsEl.style.transform = `translateY(${y}px)`;
  return y;
}

function frame() {
  const mt = media.time();
  const t = mt + state.offset;
  const lines = state.lines;

  if (lines.length) {
    const a = findActive(t);
    const cur = lines[a];
    const next = lines[a + 1];
    // In a long instrumental stretch, focus the upcoming line so singers can read ahead.
    const inGap = !cur || cur.gap || (next && t > cur.end + 1.2 && next.start - cur.end > 3.5);
    const focus = inGap && next ? a + 1 : Math.max(a, 0);

    if (a !== state.active || focus !== state.focus) {
      const prevActive = state.active;
      state.active = a; state.focus = focus;
      lines.forEach((L, i) => {
        L.el.classList.toggle('sung', i < a || (i === a && !inGap));
        L.el.classList.toggle('focus', i === focus);
        L.el.classList.toggle('near', Math.abs(i - focus) === 1);
      });
      if (prevActive >= 0 && lines[prevActive] && prevActive !== a) clearWords(lines[prevActive]);
      centerOn(focus);
    }

    if (cur && !cur.gap && t <= cur.end + 0.1) {
      cur.el.classList.remove('sung');
      cur.wordEls.forEach((s, j) => {
        const w = cur.words[j];
        const p = w.end <= w.start ? (t >= w.start ? 1 : 0) : Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start)));
        const v = p.toFixed(3);
        if (s._p !== v) { s.style.setProperty('--p', v); s._p = v; }
      });
    } else if (cur && !cur.gap && !cur.el.classList.contains('sung')) {
      clearWords(cur);
      cur.el.classList.add('sung');
    }

    // Countdown dots before a line that follows silence.
    const up = lines[focus];
    const gapStart = a < 0 ? 0 : (cur.gap ? cur.start : cur.end);
    const remaining = up ? up.start - t : 0;
    if (up && !up.gap && focus > a && up.start - gapStart >= 3.5 && remaining > 0 && remaining <= 4) {
      countdown.hidden = false;
      countdown.style.top = `${up.el.offsetTop + lyricsY() - 30}px`;
      const lit = Math.ceil(remaining - 1);
      [...countdown.children].forEach((d, i) => d.classList.toggle('out', i >= lit));
    } else countdown.hidden = true;
  }

  // Transport
  const dur = media.duration() || (state.track && state.track.duration) || 0;
  const seek = $('#seek');
  if (!seek.matches(':active')) { seek.max = dur || 100; seek.value = Math.min(mt, dur || 100); }
  $('#curTime').textContent = fmt(mt);
  $('#durTime').textContent = fmt(dur);
  $('#playBtn').classList.toggle('on', media.playing());

  requestAnimationFrame(frame);
}

function lyricsY() {
  const m = lyricsEl.style.transform.match(/translateY\((-?[\d.]+)px\)/);
  return m ? parseFloat(m[1]) : 0;
}

function clearWords(L) {
  L.wordEls.forEach((s) => { s.style.removeProperty('--p'); s._p = null; });
}

/* ---------- sync controls ---------- */
function setOffset(v) {
  state.offset = Math.round(v * 100) / 100;
  if (state.track) store.set(`gkc.off.${state.track.id}`, state.offset);
  state.active = state.focus = -2;
  state.lines.forEach(clearWords);
  renderOffset();
}
function renderOffset() {
  const o = state.offset;
  $('#offVal').textContent = Math.abs(o) < 0.05 ? '±0.0s' : `${o > 0 ? '+' : '−'}${Math.abs(o).toFixed(1)}s`;
  $('#offVal').title = o > 0 ? 'Lyrics are shown earlier' : o < 0 ? 'Lyrics are shown later' : 'No sync adjustment';
}
function tapSync() {
  if (!state.lines.length) return;
  // The line in focus (or the next one, if focus is already being sung) starts *now*.
  const mt = media.time();
  const t = mt + state.offset;
  let target = state.lines[state.focus];
  if (!target || (state.focus === state.active && t - target.start > 0.4)) target = state.lines[state.active + 1];
  while (target && target.gap) target = state.lines[state.lines.indexOf(target) + 1];
  if (!target) return;
  setOffset(target.start - mt);
  const b = $('#tapBtn');
  b.classList.add('flash');
  setTimeout(() => b.classList.remove('flash'), 200);
}

function setWarn(msg) {
  const w = $('#warn');
  w.hidden = !msg;
  w.textContent = msg || '';
}
function checkDuration() {
  const d = media.kind === 'clock' ? 0 : media.duration();
  if (!state.track || !d) { setWarn(''); return; }
  const diff = state.track.duration - d;
  if (Math.abs(diff) > 4) {
    setWarn(`Heads up: these lyrics are ${Math.round(Math.abs(diff))}s ${diff > 0 ? 'longer' : 'shorter'} than your audio, so it may be a different version. Try another result, or fix it with Tap sync.`);
  } else setWarn('');
}

/* ======================================================================
   Singer queue
   ====================================================================== */
let queue = store.get('gkc.queue', []);
function renderQueue() {
  const ol = $('#queue');
  ol.replaceChildren(...queue.map((q, i) => {
    const li = document.createElement('li');
    const mid = el('div');
    mid.append(el('div', 'q-name', q.singer), el('div', 'q-song', `${q.track} · ${q.artist}${q.yt ? ' · ▶ YouTube' : ''}`));
    const x = el('button', 'q-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', `Remove ${q.singer}`);
    x.addEventListener('click', () => { queue.splice(i, 1); saveQueue(); });
    li.append(mid, x);
    return li;
  }));
  if (!queue.length) ol.replaceChildren(el('p', 'queue-empty', 'Nobody’s queued yet. Load a song, type a name, add it.'));
  $('#nextUp').disabled = !queue.length;
}
function saveQueue() { store.set('gkc.queue', queue); renderQueue(); }

async function nextSinger() {
  const q = queue.shift();
  saveQueue();
  if (!q) return;
  $('#nowWrap').hidden = false;
  $('#nowSinger').textContent = q.singer;
  try {
    const r = await fetch(`${API}/get/${q.trackId}`).then((res) => res.json());
    loadTrack(r);
  } catch {
    setWarn('Couldn’t fetch the lyrics for that queued song.');
  }
  if (q.yt) loadYouTube(q.yt, { searchLyrics: false });
  else if (media.kind === 'file') { media.pause(); media.use('clock', 'Stage clock'); media.seek(0); setWarn('Drop in the audio file for this song, or play it from another device.'); }
  else media.seek(0);
}

/* ======================================================================
   Wiring
   ====================================================================== */
function selectTab(name) {
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  $$('.tabpanel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

$('#fileInput').addEventListener('change', (e) => loadFile(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
// Let a file be dropped anywhere on the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f && !drop.contains(e.target)) loadFile(f);
});
audio.addEventListener('loadedmetadata', checkDuration);

$('#ytForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = ytId($('#ytUrl').value);
  if (!id) { setWarn('That doesn’t look like a YouTube link.'); return; }
  loadYouTube(id);
});
$$('#ytMode button').forEach((b) => b.addEventListener('click', () => { ytMode = b.dataset.mode; store.set('gkc.ytMode', ytMode); applyYtMode(); }));
applyYtMode();

$('#useClock').addEventListener('click', () => { media.use('clock', 'Stage clock'); media.seek(0); });

let debounce;
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(debounce); runSearch($('#q').value); });
$('#q').addEventListener('input', () => {
  clearTimeout(debounce);
  const v = $('#q').value;
  if (v.trim().length >= 3) debounce = setTimeout(() => runSearch(v), 450);
});
$('#syncedOnly').addEventListener('change', renderResults);

$('#queueForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const singer = $('#singer').value.trim();
  if (!singer) { $('#singer').focus(); return; }
  if (!state.track) { setWarn('Load a song first, then add it to the queue.'); return; }
  queue.push({ singer, trackId: state.track.id, track: state.track.trackName, artist: state.track.artistName, yt: media.kind === 'yt' ? ytVideoId : null });
  $('#singer').value = '';
  saveQueue();
});
$('#nextUp').addEventListener('click', nextSinger);
renderQueue();

$('#playBtn').addEventListener('click', () => media.toggle());
$('#seek').addEventListener('input', (e) => media.seek(parseFloat(e.target.value)));
$('#offMinus').addEventListener('click', () => setOffset(state.offset - 0.1));
$('#offPlus').addEventListener('click', () => setOffset(state.offset + 0.1));
$('#tapBtn').addEventListener('click', tapSync);
const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : $('#stage').requestFullscreen().catch(() => {}));
$('#fsBtn').addEventListener('click', toggleFs);
document.addEventListener('fullscreenchange', () => setTimeout(() => { state.focus = -2; }, 60));
window.addEventListener('resize', () => { state.focus = -2; });

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input[type=text], input[type=search]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); media.toggle(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); media.seek(media.time() - 5); }
  else if (k === 'ArrowRight') { e.preventDefault(); media.seek(media.time() + 5); }
  else if (k === '[') setOffset(state.offset - (e.shiftKey ? 0.5 : 0.1));
  else if (k === ']') setOffset(state.offset + (e.shiftKey ? 0.5 : 0.1));
  else if (k === '{') setOffset(state.offset - 0.5);
  else if (k === '}') setOffset(state.offset + 0.5);
  else if (k === 't' || k === 'T') tapSync();
  else if (k === 'f' || k === 'F') toggleFs();
});

requestAnimationFrame(frame);
