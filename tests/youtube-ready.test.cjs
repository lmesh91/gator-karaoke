const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const app = readFileSync(require.resolve('../app.js'),'utf8');
const loader = app.slice(app.indexOf('async function loadYouTube('),app.indexOf('function ensureInstPlayer('));
function setup() {
  const cues=[],players=[];
  class Player {
    constructor(_,options) { this.options=options;players.push(this); }
    ready() { this.cueVideoById=id=>cues.push(id);this.mute=()=>{};this.unMute=()=>{};this.options.events.onReady(); }
  }
  const context=vm.createContext({yt:null,ytPlayerReady:null,ytVideoId:null,ytBlockedId:null,
    ytMetadataTimer:null,ytMetadataAttempts:0,ytSearched:null,ytLookup:null,instOn:false,
    directAudio:{active:false,release(){}},media:{kind:'clock',use(kind){this.kind=kind;}},
    clearTimeout(){},stopInstrumental(){},selectTab(){},applyYtMode(){},onYtState(){},
    loadYTApi:async()=>({Player}),
  });
  vm.runInContext(loader,context);
  return {context,cues,players};
}
test('a pasted selection waits for the existing player to be ready and supersedes an automatic selection',async()=>{
  const h=setup();
  const automatic=h.context.loadYouTube('automatic01',{searchLyrics:false});
  await new Promise(setImmediate);
  assert.equal(h.players.length,1);
  const manual=h.context.loadYouTube('manualvid01',{searchLyrics:false});
  await new Promise(setImmediate);
  h.players[0].ready();
  await Promise.all([automatic,manual]);
  assert.deepEqual(h.cues,['manualvid01']);
  assert.equal(h.context.ytVideoId,'manualvid01');
});
test('a source change while the YouTube API loads prevents an obsolete player from being created',async()=>{
  const h=setup();let resolve;
  h.context.loadYTApi=()=>new Promise(r=>resolve=r);
  const pending=h.context.loadYouTube('automatic01',{searchLyrics:false});
  h.context.media.kind='file';
  resolve({Player:class {constructor(){throw new Error('Obsolete player created');}}});
  await pending;
  assert.equal(h.players.length,0);
});
