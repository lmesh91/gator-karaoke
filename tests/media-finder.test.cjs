const assert = require('node:assert/strict');
const { test } = require('node:test');
const { rankVideos, rankInstrumentals, artistMatches, baseTitle } = require('../media-finder.js');

const track = { trackName: 'Example Song', artistName: 'The Examples', duration: 220 };
const v = (id, title, author, length) => ({ id: id.padEnd(11, '_'), title, author, length });

test('the official music video wins when its length matches the lyrics', () => {
  const ranked = rankVideos(track, [
    v('lyrics', 'The Examples - Example Song (Lyrics)', 'Lyric Channel', 220),
    v('mv', 'The Examples - Example Song (Official Music Video)', 'TheExamplesVEVO', 221),
  ]);
  assert.equal(ranked[0].id, 'mv_________');
  assert.equal(ranked[0].kind, 'Music video');
});

test('a much longer music video loses to an exact-length official audio upload', () => {
  const ranked = rankVideos(track, [
    v('mv', 'The Examples - Example Song (Official Music Video)', 'TheExamplesVEVO', 250),
    v('topic', 'Example Song', 'The Examples - Topic', 220),
  ]);
  assert.deepEqual(ranked.map((r) => r.kind), ['Official audio', 'Music video']);
});

test('covers, live takes, re-recordings, instrumentals and other songs are not offered as the video', () => {
  const ranked = rankVideos(track, [
    v('cover', 'Example Song - acoustic cover', 'Someone', 220),
    v('live', 'The Examples - Example Song (Live at the Arena)', 'The Examples', 220),
    v('rerec', "The Examples - Example Song (Examples's Version)", 'The Examples', 220),
    v('inst', 'The Examples - Example Song (Instrumental)', 'Backing Tracks', 220),
    v('other', 'The Examples - Different Tune (Official Video)', 'The Examples', 220),
    v('artist', 'Example Song (Official Video)', 'Unrelated Uploader', 220),
  ]);
  assert.deepEqual(ranked, []);
});

test('re-uploads that only call themselves official rank below the artist’s own uploads', () => {
  const ranked = rankVideos(track, [
    v('fake', 'The Examples - Example Song - Official Music HQ Sound', 'Some Reuploader', 220),
    v('topic', 'Example Song', 'The Examples - Topic', 220),
  ]);
  assert.equal(ranked[0].id, 'topic______');
  assert.equal(ranked[1].official, false);
});

test('Wikidata videos are kept even when search did not return them', () => {
  const ranked = rankVideos(track, [], ['wikidataMV1']);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].official, true);
});

test('instrumentals must be backing tracks for this song, ranked by length match', () => {
  const ranked = rankInstrumentals(track, [
    v('long', 'The Examples - Example Song (Instrumental)', 'A', 236),
    v('exact', 'The Examples - Example Song (Official Instrumental)', 'B', 220),
    v('kara', 'Example Song - The Examples (Karaoke Version)', 'Karaoke Co', 222),
    v('piano', 'The Examples - Example Song (Piano Instrumental)', 'C', 220),
    v('vocal', 'The Examples - Example Song (Official Video)', 'D', 220),
    v('far', 'The Examples - Example Song (Instrumental)', 'E', 300),
  ]);
  assert.deepEqual(ranked.map((r) => r.id.replace(/_+$/, '')), ['exact', 'kara', 'long']);
  assert.equal(ranked[1].kind, 'Karaoke track');
});

test('artist and title matching tolerate "The", features and edition suffixes', () => {
  assert.equal(artistMatches('Examples', 'The Examples'), true);
  assert.equal(artistMatches('Someone Else', 'The Examples feat. Someone Else'), true);
  assert.equal(artistMatches('Exam', 'The Examples'), false);
  assert.equal(baseTitle('Example Song (feat. Guest) - 2011 Remaster'), 'Example Song');
});

test('manual YouTube search links contain the selected artist and song, with an instrumental option', () => {
  const {youtubeSearchURL} = require('../media-finder.js');
  const song = {artistName: 'Earth, Wind & Fire', trackName: 'September (Remastered)'};
  const video = new URL(youtubeSearchURL(song));
  assert.equal(video.origin, 'https://www.youtube.com');
  assert.equal(video.pathname, '/results');
  assert.equal(video.searchParams.get('search_query'), 'Earth, Wind & Fire September');
  assert.equal(new URL(youtubeSearchURL(song, true)).searchParams.get('search_query'), 'Earth, Wind & Fire September instrumental');
});
