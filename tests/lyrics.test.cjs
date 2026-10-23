const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Exercise the browser's parser and animation without loading external media.
const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf("const audio = $('#audio');")), context);
const parseLRC = context.parseLRC;

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
}

function element() {
  const classes = new Set();
  const properties = new Map();
  return {
    offsetTop: 0, offsetHeight: 40, children: [],
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
      getPropertyValue: (name) => properties.get(name),
    },
    matches: () => false,
  };
}

function animate(lines, time) {
  const animation = vm.createContext({
    state: { lines, offset: 0, active: -2, focus: -2 },
    media: { time: () => time, duration: () => 60, playing: () => true },
    lyricsEl: element(), viewport: { clientHeight: 500 }, countdown: element(),
    $: () => element(), fmt: (t) => String(t), requestAnimationFrame: () => {},
  });
  for (const line of lines) {
    line.el = element();
    line.wordEls = line.words.map(element);
  }
  vm.runInContext(source.slice(source.indexOf('function findActive('), source.indexOf('/* ---------- sync controls')), animation);
  animation.frame();
  return animation;
}

test('a held syllable uses the interval until its next word tag', () => {
  const lines = parseLRC('[00:10]<00:10>Stay <00:11>with <00:16>me<00:18>\n[00:20]Next');
  near(lines[0].words[1].end, 16);
  animate(lines, 13.5);
  assert.equal(lines[0].wordEls[1].style.getPropertyValue('--p'), '0.500');
  assert.equal(lines[0].wordEls[2].style.getPropertyValue('--p'), '0.000');
});

test('a final word without an end tag stays animated until the next line', () => {
  const lines = parseLRC('[00:10]<00:10>Hold <00:11>on\n[00:20]Next');
  near(lines[0].end, 19.95);
  animate(lines, 15.475);
  assert.equal(lines[0].wordEls[1].style.getPropertyValue('--p'), '0.500');
  assert.ok(!lines[0].el.classList.contains('sung'));
});

test('explicit syllable endings and offsets remain authoritative', () => {
  const [line] = parseLRC('[offset:500]\n[00:10]<00:10>Lo<00:11>ve<00:16>\n[00:20]Next');
  near(line.words[0].start, 9.5);
  near(line.words[0].end, 10.5);
  near(line.words[1].end, 15.5);
  near(line.end, 15.5);
});

test('estimated timings give surplus time to the held final word', () => {
  const [short] = parseLRC('[00:10]Stay with me\n[00:14]Next');
  const lines = parseLRC('[00:10]Stay with me\n[00:20]Next');
  const held = lines[0];
  near(held.words[0].end, short.words[0].end);
  near(held.words[1].end, short.words[1].end);
  near(held.words[2].end, 19.85);
  animate(lines, (held.words[2].start + held.words[2].end) / 2);
  assert.equal(held.wordEls[2].style.getPropertyValue('--p'), '0.500');
});

test('known song duration bounds the last line with or without word tags', () => {
  const [timed] = parseLRC('[00:10]<00:10>Hold <00:11>on', 25);
  const [estimated] = parseLRC('[00:10]Hold on', 25);
  near(timed.words[1].end, 24.95);
  near(estimated.words[1].end, 24.85);
});

test('explicit gaps end held notes before instrumental breaks', () => {
  const lines = parseLRC('[00:10]<00:10>Hold <00:11>on\n[00:16]\n[00:30]Next');
  near(lines[0].end, 15.95);
  assert.ok(lines[1].gap);
  const animation = animate(lines, 28);
  assert.equal(animation.state.focus, 2);
  assert.equal(animation.countdown.hidden, false);
});

test('short and simultaneous lines never produce negative word durations', () => {
  const lines = parseLRC('[00:10]One two\n[00:10]Three\n[00:10.10]Four');
  for (const line of lines) {
    for (const word of line.words) {
      assert.ok(word.end >= word.start);
      assert.ok(word.end <= line.end + 1e-8);
    }
  }
});
