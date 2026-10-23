const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { recordingIdentity, matchingCandidates, lookup } = require('../word-timing.js');

const track = { trackName: 'Take a Picture', artistName: 'Filter', albumName: 'Title of Record', duration: 364 };
const candidate = { track_name: 'Take A Picture', artist_name: 'Filter', album_name: 'Title of Record', duration: 364, timing_type: 'word', lyricsUrl: 'https://lrc.red/s/example.ttml' };

test('duplicated LRCLIB fields and official channel suffixes do not prevent a recording match', () => {
  for (const artistName of ['Filter - Take A Picture', 'Filter - Topic', 'FilterVEVO']) {
    assert.equal(recordingIdentity({ ...track, artistName }).artistName, 'Filter');
  }
  assert.equal(recordingIdentity({ ...track, trackName: 'Filter - Take A Picture' }).trackName, 'Take A Picture');
  assert.equal(recordingIdentity({ ...track, artistName: 'A band - with a dash' }).artistName, 'A band - with a dash');
  assert.equal(recordingIdentity({ ...track, trackName: 'Take A Picture (Live)' }).trackName, 'Take A Picture (Live)');
});

test('matching prefers the same recording and permits case/punctuation differences', () => {
  const otherAlbum = { ...candidate, album_name: 'Collection' };
  assert.deepEqual(matchingCandidates(track, [otherAlbum, candidate]), [candidate, otherAlbum]);
});

test('covers, live versions, different lengths, line timing, and unexpected URLs are excluded', () => {
  const mismatches = [
    null,
    { ...candidate, artist_name: 'A cover band' },
    { ...candidate, track_name: 'Take a Picture (Live)' },
    { ...candidate, duration: 221 },
    { ...candidate, duration: undefined },
    { ...candidate, timing_type: 'line' },
    { ...candidate, lyricsUrl: 'https://unrelated.example/song' },
    { ...candidate, lyricsUrl: 'http://lrc.red/s/example.ttml' },
  ];
  assert.deepEqual(matchingCandidates(track, mismatches), []);
});

test('missing track identity never matches an arbitrary result', () => {
  assert.deepEqual(matchingCandidates({ ...track, artistName: '' }, [candidate]), []);
});

test('missing matches and unavailable providers preserve a usable fallback path', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ results: [{ ...candidate, duration: 221 }] }) });
    assert.equal(await lookup(track), null);
    global.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(lookup(track), /503/);
  } finally { global.fetch = originalFetch; }
});

test('native browser parses held syllables and TTML spacing correctly', () => {
  const page = pathToFileURL(join(__dirname, 'word-timing.html')).href;
  const profile = mkdtempSync(join(tmpdir(), 'gkc-word-tests-'));
  try {
    const result = spawnSync(process.env.CHROME_BIN || 'google-chrome', [
      '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-background-networking', '--no-first-run', `--user-data-dir=${profile}`, '--dump-dom', page,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /data-failures="0"/, result.stdout);
    assert.match(result.stdout, /PASS a held first syllable/, result.stdout);
  } finally { rmSync(profile, { recursive: true, force: true }); }
});
