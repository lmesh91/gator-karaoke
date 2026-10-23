const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
function target() {
  const listeners = new Map(), classes = new Set();
  return {classes,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},
    addEventListener(name,fn) { if(!listeners.has(name)) listeners.set(name,[]); listeners.get(name).push(fn); },
    emit(name,event={}) { for(const fn of listeners.get(name)||[]) fn(event); },
  };
}
function setup() {
  const doc=target(),stage=target(),control={};
  const controls={inert:false,contains:x=>x===control};
  const timers=new Map(); let timerId=0;
  const scope=vm.createContext({module:{exports:{}},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(readFileSync(require.resolve('../fullscreen-controls.js'),'utf8'),scope);
  new scope.module.exports(stage,controls,doc);
  return {doc,stage,controls,control,enter(){doc.fullscreenElement=stage;doc.emit('fullscreenchange');},
    idle(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test('fullscreen hides controls on idle, wakes on pointer movement, and restores them on exit',()=>{
  const h=setup();h.enter();h.idle();
  assert.ok(h.stage.classes.has('controls-idle'));assert.equal(h.controls.inert,true);
  h.stage.emit('pointermove');assert.equal(h.controls.inert,false);assert.equal(h.stage.classes.has('controls-idle'),false);
  h.idle();h.doc.fullscreenElement=null;h.doc.emit('fullscreenchange');
  assert.equal(h.controls.inert,false);assert.equal(h.stage.classes.has('controls-idle'),false);
});
test('a held or dragged control remains visible until the pointer is released',()=>{
  const h=setup();h.enter();h.stage.emit('pointerdown');h.idle();
  assert.equal(h.controls.inert,false);
  h.doc.emit('pointerup');h.idle();assert.equal(h.controls.inert,true);
});
test('keyboard activity reveals hidden controls and preserves keyboard focus',()=>{
  const h=setup();h.enter();h.idle();h.doc.emit('keydown',{key:'Tab'});
  assert.equal(h.controls.inert,false);
  h.doc.activeElement=h.control;h.stage.emit('focusin');h.idle();assert.equal(h.controls.inert,false);
  h.stage.emit('pointermove');h.idle();assert.equal(h.controls.inert,true);
});
test('normal windowed playback never hides controls',()=>{
  const h=setup();h.stage.emit('pointermove');h.doc.emit('keydown',{key:' '});h.idle();
  assert.equal(h.controls.inert,false);assert.equal(h.stage.classes.has('controls-idle'),false);
});
