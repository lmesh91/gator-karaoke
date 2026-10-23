const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
function finder(fetch, now = () => Date.now(), location) {
  const Clock = class extends Date { static now() { return now(); } };
  const context = vm.createContext({ fetch, location, Date: Clock, AbortController, DOMException, URL, URLSearchParams, setTimeout, clearTimeout,
    module: { exports: {} } });
  vm.runInContext(readFileSync(require.resolve('../media-finder.js'), 'utf8'), context);
  return context.module.exports;
}
const json = (body) => ({ ok: true, json: async () => body });
const video = [{ type: 'video', videoId: 'abcdefghijk', title: 'Example' }];

test('false and unknown directory flags do not discard online HTTPS mirrors', async () => {
  const calls = [];
  const f = finder(async (url) => {
    calls.push(new URL(url).hostname);
    if (url.includes('instances.json')) return json([
      ['down.example', { type: 'https', api: false, cors: false }],
      ['online.example', { type: 'https', api: null, cors: null }],
    ]);
    if (url.includes('down.example')) return { ok: false, status: 530 };
    return json(video);
  });
  assert.equal((await f.youtubeSearch('song'))[0].id, 'abcdefghijk');
  assert.deepEqual(calls, ['api.invidious.io', 'down.example', 'online.example']);
  calls.length = 0;
  await f.youtubeSearch('another song');
  assert.deepEqual(calls, ['online.example']);
});

test('directory outages use multiple backups after 530, CORS and malformed responses', async () => {
  const calls = [];
  const f = finder(async (url) => {
    const host = new URL(url).hostname;
    calls.push(host);
    if (host === 'api.invidious.io') throw new TypeError('Network error');
    if (host === 'invidious.f5.si') return { ok: false, status: 530 };
    if (host === 'inv.nadeko.net') throw new TypeError('Failed to fetch');
    if (host === 'invidious.nerdvpn.de') return json({ error: 'unavailable' });
    return json(video);
  });
  assert.equal((await f.youtubeSearch('song')).length, 1);
  assert.equal(calls.at(-1), 'yt.chocolatemoo53.com');
  assert.equal(calls.length, 5);
});

test('a failed preferred mirror is replaced and cooled down for subsequent searches', async () => {
  let failPreferred = false;
  const calls = [];
  const f = finder(async (url) => {
    const host = new URL(url).hostname;
    if (host === 'api.invidious.io') return json([
      ['first.example', { type: 'https', api: true, cors: true }],
      ['second.example', { type: 'https', api: true, cors: true }],
    ]);
    calls.push(host);
    if (host === 'first.example' && failPreferred) return { ok: false, status: 503 };
    return json(video);
  });
  await f.youtubeSearch('one');
  failPreferred = true;
  await f.youtubeSearch('two');
  await f.youtubeSearch('three');
  assert.deepEqual(calls, ['first.example', 'first.example', 'second.example', 'second.example']);
});

test('cancellation stops failover without marking the mirror unhealthy', async () => {
  const ctl = new AbortController();
  let cancel = true;
  let searchCalls = 0;
  const f = finder(async (url) => {
    if (url.includes('instances.json')) return json([['first.example', { type: 'https' }]]);
    searchCalls++;
    if (cancel) { ctl.abort(); throw new DOMException('Aborted', 'AbortError'); }
    return json(video);
  });
  await assert.rejects(f.youtubeSearch('one', { signal: ctl.signal }), { name: 'AbortError' });
  assert.equal(searchCalls, 1);
  cancel = false;
  assert.equal((await f.youtubeSearch('two')).length, 1);
  assert.equal(searchCalls, 2);
});

test('non-public transports and invalid hostnames are excluded', async () => {
  const hosts = [];
  const f = finder(async (url) => {
    if (url.includes('instances.json')) return json([
      ['hidden.onion', { type: 'https' }], ['host.i2p', { type: 'i2p' }],
      ['inv-ygg.nadeko.net', { type: 'https' }], ['host.example/path', { type: 'https' }],
      ['good.example', { type: 'https' }],
    ]);
    hosts.push(new URL(url).hostname);
    return json(video);
  });
  await f.youtubeSearch('song');
  assert.deepEqual(hosts, ['good.example']);
});

test('a failed mirror becomes eligible again after its cooldown', async () => {
  let now = 1000, available = false, requests = 0;
  const f = finder(async (url) => {
    if (url.includes('instances.json')) return json([['recovering.example', { type: 'https' }]]);
    if (new URL(url).hostname !== 'recovering.example') throw new Error('Unavailable');
    requests++;
    if (!available) return { ok: false, status: 530 };
    return json(video);
  }, () => now);
  await assert.rejects(f.youtubeSearch('one'));
  available = true;
  await assert.rejects(f.youtubeSearch('two'));
  assert.equal(requests, 1);
  now += 60001;
  assert.equal((await f.youtubeSearch('three')).length, 1);
  assert.equal(requests, 2);
});

test('a failed directory lookup is retried instead of cached for the session', async () => {
  let now = 1000, directoryRequests = 0;
  const f = finder(async (url) => {
    if (url.includes('instances.json')) {
      directoryRequests++;
      if (directoryRequests === 1) throw new Error('Directory down');
      return json([['new.example', { type: 'https' }]]);
    }
    return json(video);
  }, () => now);
  await f.youtubeSearch('one');
  await f.youtubeSearch('two');
  assert.equal(directoryRequests, 1);
  now += 60001;
  await f.youtubeSearch('three');
  assert.equal(directoryRequests, 2);
  now += 600001;
  await f.youtubeSearch('four');
  assert.equal(directoryRequests, 3);
});

test('local yt-dlp search is preferred without contacting any public mirror', async () => {
  const calls = [];
  const f = finder(async (url) => {
    calls.push(url);
    if (url.endsWith('/status')) return json({ provider: 'yt-dlp', available: true });
    assert.match(url, /^http:\/\/localhost:8765\/api\/media\/search\?/);
    return json({ videos: [{ id: 'abcdefghijk', title: 'Song', author: 'Artist', length: 220 }] });
  }, undefined, new URL('http://localhost:8765/'));
  assert.equal((await f.youtubeSearch('Artist Song'))[0].length, 220);
  await f.youtubeSearch('Another song');
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((url) => url.endsWith('/status')).length, 1);
});

test('ordinary static servers without the helper keep the mirror fallback', async () => {
  const calls = [];
  const f = finder(async (url) => {
    calls.push(url);
    if (url.endsWith('/status')) return { ok: false, status: 404 };
    if (url.includes('instances.json')) return json([['online.example', { type: 'https' }]]);
    return json(video);
  }, undefined, new URL('http://127.0.0.1:8765/'));
  assert.equal((await f.youtubeSearch('song')).length, 1);
  assert.equal(calls.length, 3);
});

test('a local extraction failure can still use mirror search', async () => {
  const f = finder(async (url) => {
    if (url.endsWith('/status')) return json({ provider: 'yt-dlp', available: true });
    if (url.includes('/api/media/search?')) return { ok: false, status: 502 };
    if (url.includes('instances.json')) return json([['online.example', { type: 'https' }]]);
    return json(video);
  }, undefined, new URL('http://localhost:8765/'));
  assert.equal((await f.youtubeSearch('song')).length, 1);
});
