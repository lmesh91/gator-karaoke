const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
const youtubeFunctions = source.slice(source.indexOf('function youtubeIdentity('), source.indexOf('function applyYtMode('));
const cleanTitle = source.slice(source.indexOf('function cleanTitle('), source.indexOf('/* ======================================================================\n   Lyrics search'));
const autoFindFunction = source.slice(source.indexOf('async function autoFind('), source.indexOf('/* ======================================================================\n   Stage rendering'));

function setup() {
  const calls = [], upgrades = [], timers = [];
  const metadata = { title: 'Take A Picture', author: '', video_id: 'BauxVSmSD_c' };
  const track = { id: 123, trackName: 'Take A Picture', artistName: 'Filter - Take A Picture', duration: 364 };
  let duration = 0, finishSearch;
  const context = vm.createContext({
    media: { kind: 'yt' }, ytVideoId: 'BauxVSmSD_c', ytSearched: null,
    ytMetadataTimer: null, ytMetadataAttempts: 0, ytLookup: null,
    state: { track: null, lines: [], offset: 1.2 },
    yt: { getVideoData: () => metadata, getDuration: () => duration },
    checkDuration() {}, $: () => ({}), clearTimeout() {},
    setTimeout(fn) { timers.push(fn); return timers.length; },
    autoFind(...args) {
      calls.push(args.slice(0, 3));
      return new Promise(resolve => { finishSearch = () => {
        if (!args[3]()) return resolve();
        context.state.track = track;
        resolve(track);
      }; });
    },
    startWordTiming(...args) { upgrades.push(args); },
  });
  vm.runInContext(cleanTitle + youtubeFunctions, context);
  return { context, metadata, calls, upgrades, timers, track,
    duration(value) { duration = value; },
    async finish() { finishSearch(); await Promise.resolve(); },
  };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('title alone starts the lyrics search immediately, even if duration stays zero', async () => {
  const h = setup();
  h.context.onYtState();
  assert.deepEqual(plain(h.calls), [['Take A Picture', 0, { title: 'Take A Picture', artist: '' }]]);
  await h.finish();
  assert.equal(h.context.state.track, h.track);
  h.context.onYtState();
  assert.equal(h.calls.length, 1);
});

test('late artist metadata repairs only the background timing lookup, without reloading lyrics or sync', async () => {
  const h = setup();
  h.context.onYtState();
  await h.finish();
  h.metadata.author = 'Filter - Topic';
  h.context.onYtState();
  assert.equal(h.calls.length, 1);
  assert.equal(h.upgrades.length, 1);
  assert.equal(h.upgrades[0][0], h.track);
  assert.equal(h.upgrades[0][1].artistName, 'Filter');
  assert.equal(h.upgrades[0][1].duration, 364);
  assert.equal(h.context.state.offset, 1.2);
  h.context.onYtState();
  assert.equal(h.upgrades.length, 1);
});

test('artist details arriving while LRCLIB is loading also refine the returned track', async () => {
  const h = setup();
  h.context.onYtState();
  h.metadata.author = 'Filter - Topic';
  h.context.onYtState();
  await h.finish();
  assert.equal(h.upgrades.length, 1);
});

test('missing duration does not block a lookup with complete artist details', () => {
  const h = setup();
  h.metadata.author = 'Filter - Topic';
  h.context.onYtState();
  assert.deepEqual(plain(h.calls[0]), ['Filter Take A Picture', 0, { title: 'Take A Picture', artist: 'Filter' }]);
});

test('a previous video cannot select lyrics or refine the current song', async () => {
  const h = setup();
  h.metadata.video_id = 'previous-video';
  h.context.onYtState();
  assert.equal(h.calls.length, 0);
  h.metadata.video_id = 'BauxVSmSD_c';
  h.context.onYtState();
  h.context.ytVideoId = 'next-video';
  await h.finish();
  assert.equal(h.context.state.track, null);
  assert.equal(h.upgrades.length, 0);
});

test('switching audio or manually choosing another song prevents late refinement', async () => {
  for (const switchSource of [true, false]) {
    const h = setup();
    h.context.onYtState();
    await h.finish();
    if (switchSource) h.context.media.kind = 'file';
    else h.context.state.track = { id: 'manual-choice' };
    h.metadata.author = 'Filter - Topic';
    h.context.onYtState();
    assert.equal(h.upgrades.length, 0);
  }
});

test('video titles and official music channels identify artists, ordinary uploader names do not', () => {
  const h = setup();
  assert.deepEqual(plain(h.context.youtubeIdentity({ title: 'Filter - Take A Picture (Official Audio)', author: 'A record label' })), { title: 'Take A Picture', artist: 'Filter' });
  assert.deepEqual(plain(h.context.youtubeIdentity({ title: 'Take A Picture', author: 'My Favorite Music' })), { title: 'Take A Picture', artist: '' });
  assert.deepEqual(plain(h.context.youtubeIdentity({ title: 'Take A Picture', author: 'FilterVEVO' })), { title: 'Take A Picture', artist: 'Filter' });
});

test('late automatic search results cannot replace a manual song selection or an obsolete video', async () => {
  for (const manualChoice of [true, false]) {
    let finish, loaded = false, current = true;
    const context = vm.createContext({ trackVersion: 0, $: () => ({}),
      runSearch: () => new Promise(resolve => { finish = resolve; }),
      loadTrack() { loaded = true; },
    });
    vm.runInContext(autoFindFunction, context);
    const pending = context.autoFind('Filter', 364, null, () => current);
    if (manualChoice) context.trackVersion++;
    else current = false;
    finish([{ syncedLyrics: '[00:00]Example', duration: 364 }]);
    await pending;
    assert.equal(loaded, false);
  }
});
