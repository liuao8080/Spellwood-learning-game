import test from 'node:test';
import assert from 'node:assert/strict';
import { NetworkAudioDirector } from '../src/network/audio.mjs';
import { playSceneSound } from '../src/network/scene-audio.mjs';

// Scheduled-node model only. These checks do not prove audible output.
function fixture() {
  const director = new NetworkAudioDirector(), sources = [];
  const param = () => ({ value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ disconnects: 0, connect() {}, disconnect() { this.disconnects++; } });
  const source = () => { const s = { ...node(), frequency: param(), stops: [], start(t) { this.startTime = t; }, stop(t) { this.stops.push(t); }, addEventListener(k, fn) { this[k] = fn; } }; sources.push(s); return s; };
  const ctx = { currentTime: 10, sampleRate: 1000, destination: {}, state: 'running',
    createOscillator: source, createBufferSource: source,
    createGain: () => ({ ...node(), gain: param() }), createBiquadFilter: () => ({ ...node(), frequency: param() }),
    createBuffer: (_, size) => ({ getChannelData: () => new Float32Array(size) }),
    suspend() { this.state = 'suspended'; return Promise.resolve(); }, resume() { this.state = 'running'; return Promise.resolve(); } };
  director.ctx = ctx; director.master = ctx.createGain(); director.unlocked = true;
  director.music = { paused: false, volume: 0, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  return { director, sources, ctx };
}

test('hiding the battle cancels every scheduled victory tone and resumes music alone', () => {
  const { director, sources, ctx } = fixture(); director.play('win');
  assert.equal(director.sources.size, 6); const old = [...sources];
  director.visibility(true); assert.equal(director.sources.size, 0); assert.equal(ctx.state, 'suspended');
  assert(old.every(s => s.stops.at(-1) === undefined && s.disconnects === 1));
  director.visibility(false); assert.equal(ctx.state, 'running'); assert.equal(director.music.paused, false);
  assert.equal(sources.length, 6, 'resuming does not rebuild an old cue');
  for (const s of old) s.ended(); assert(old.every(s => s.disconnects === 1));
  director.play('turn'); assert.equal(director.sources.size, 2, 'newly accepted actions can sound');
});

test('normal ends and the sound preference release oscillators, noise filters and gains', () => {
  const { director, sources } = fixture(); director.play('hit');
  const records = [...director.sources]; assert.equal(records.length, 3);
  sources[0].ended(); assert.equal(director.sources.size, 2);
  director.sync({ sound: false }); assert.equal(director.sources.size, 0);
  assert(records.every(record => record.nodes.every(node => node.disconnects === 1)));
  playSceneSound('draw', director); assert.equal(sources.length, 3);
  director.sync({ sound: true }); playSceneSound('draw', director); assert.equal(director.sources.size, 3);
});

test('hidden direct scene cues cannot create audio nodes', () => {
  const { director, sources } = fixture(); director.visibility(true);
  director.play('hit'); playSceneSound('draw', director); director.tone(400, 0, .2); director.noise(0, .2);
  assert.equal(sources.length, 0); assert.equal(director.sources.size, 0);
});

test('temporary pack mute stops sound immediately, keeps preference changes and never replays old cues',()=>{
  const {director,sources}=fixture();director.play('win');assert.equal(sources.length,6);
  director.setTemporaryMute(true);assert.equal(director.sources.size,0);assert.equal(director.music.paused,true);
  director.sync({sound:true,music:false,musicVolume:17,soundVolume:40});
  director.duckSpeech(true);director.duckSpeech(false);director.visibility(true);director.visibility(false);
  director.play('hit');assert.equal(sources.length,6);assert.equal(director.settings.sound,false);
  director.setTemporaryMute(false);assert.equal(director.settings.sound,true);assert.equal(director.settings.music,false);
  assert.equal(director.settings.musicVolume,17);assert.equal(director.settings.soundVolume,40);assert.equal(director.music.paused,true);
  assert.equal(director.sources.size,0);assert.equal(sources.length,6);director.play('turn');assert.equal(director.sources.size,2);
});

test('leaving a muted pack preserves an originally silent preference',()=>{
  const {director,sources}=fixture();director.sync({sound:false,music:false});director.setTemporaryMute(true);director.setTemporaryMute(false);
  director.play('hit');assert.equal(sources.length,0);assert.equal(director.music.paused,true);assert.equal(director.settings.sound,false);
});
