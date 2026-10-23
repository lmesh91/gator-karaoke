const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
const youtubeFunctions = source.slice(source.indexOf('function youtubeIdentity('), source.indexOf('function applyYtMode('));
const cleanTitle = source.slice(source.indexOf('function cleanTitle('), source.indexOf('/* ======================================================================\n   Lyrics search'));

function setup() {
  const calls = [], timers = [];
  const metadata = { title: 'Take A Picture', author: '', video_id: 'BauxVSmSD_c' };
  let duration = 0;
  const context = vm.createContext({
    media: { kind: 'yt' }, ytVideoId: 'BauxVSmSD_c', ytSearched: null,
    ytMetadataTimer: null, ytMetadataAttempts: 0,
    yt: { getVideoData: () => metadata, getDuration: () => duration },
    checkDuration() {}, $: () => ({}), clearTimeout() {},
    setTimeout(fn) { timers.push(fn); return timers.length; },
    autoFind(...args) { calls.push(args); },
  });
  vm.runInContext(cleanTitle + youtubeFunctions, context);
  return { context, metadata, calls, timers, duration(value) { duration = value; } };
}

test('a title arriving before artist/duration cannot trigger a title-only lookup', () => {
  const h = setup();
  h.context.onYtState();
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.ytSearched, null);
  assert.equal(h.timers.length, 1);
  h.metadata.author = 'Filter - Topic';
  h.duration(364);
  h.timers[0]();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), ['Filter Take A Picture', 364, { title: 'Take A Picture', artist: 'Filter' }]);
});

test('the metadata retry does not select lyrics using a previous video', () => {
  const h = setup();
  h.metadata.author = 'Filter - Topic';
  h.metadata.video_id = 'previous-video';
  h.duration(364);
  h.context.onYtState();
  assert.equal(h.calls.length, 0);
});

test('switching to a local file stops a pending YouTube lookup', () => {
  const h = setup();
  h.context.onYtState();
  h.metadata.author = 'Filter - Topic';
  h.duration(364);
  h.context.media.kind = 'file';
  h.timers[0]();
  assert.equal(h.calls.length, 0);
});

test('artist and title can be taken from a titled video on a label channel', () => {
  const h = setup();
  const identity = h.context.youtubeIdentity({ title: 'Filter - Take A Picture (Official Audio)', author: 'A record label' });
  assert.deepEqual(JSON.parse(JSON.stringify(identity)), { title: 'Take A Picture', artist: 'Filter' });
});
