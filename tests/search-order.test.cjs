const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
const merging = source.slice(source.indexOf('function fromLrclib('), source.indexOf('async function searchLrclib('))
  + source.slice(source.indexOf('function mergeResults('), source.indexOf('async function runSearch('));
const context = vm.createContext({});
vm.runInContext(merging, context);
// Arrays from the sandbox have a different prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

const lrclib = (id, synced, extra = {}) => ({ id, trackName: `Song ${id}`, artistName: 'Band', albumName: 'Album', duration: 200, syncedLyrics: synced, plainLyrics: 'x', ...extra });
const word = (id) => ({ id, track_name: `Song ${id}`, artist_name: 'Band', album_name: 'Album', duration: 200, isrc: id, timing_type: 'word', lyricsUrl: `https://lrc.red/s/${id}.ttml` });

test('every word-timed result is listed before any line-timed result, whatever the relevance order', () => {
  const merged = context.mergeResults(
    [lrclib(1, '[00:01.00]La'), lrclib(2, null), lrclib(3, '[00:01.00]<00:01.00>La <00:01.50>la'), lrclib(4, '[00:02.00]La')],
    [word('USAAA0000001'), word('USAAA0000002')],
  );
  assert.deepEqual(plain(merged.map((r) => r.timing)), ['word', 'word', 'word', 'line', 'line', 'plain']);
  assert.deepEqual(plain(merged.map((r) => r.key)), ['wt:USAAA0000001', 'wt:USAAA0000002', '3', '1', '4', '2']);
});

test('LRCLIB keys keep their original form so saved sync offsets still apply', () => {
  assert.equal(context.fromLrclib(lrclib(42, '[00:01.00]La')).key, '42');
});
