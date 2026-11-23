'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('./live-translate-core.js');
function near(actual, expected, tolerance = 0.002) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);
}
const oneSecond = Float32Array.from({length:48000}, (_,i)=> Math.sin(2*Math.PI*400*i/48000));
const down = core.resampleMono(oneSecond,48000);
assert.equal(down.length,16000);
near(down[200],0,0.04);
assert.equal(core.resampleMono(new Float32Array([0.25,0.5]),16000)[1],0.5);
assert.equal(core.resampleMono(new Float32Array(0),48000).length,0);
assert.throws(()=>core.resampleMono(oneSecond,0),RangeError);
assert.equal(core.clock(3661),'01:01:01');
assert.equal(core.srtTime(0.128),'00:00:00,128');
const srt=core.toSrt([
  {start:0,end:2.5,ru:'Привет!'},
  {start:2.5,end:4.2,ru:'Тест перевода.'},
  {start:4.2,end:5,ru:''},
]);
assert.match(srt,/1\n00:00:00,000 --> 00:00:02,500\nПривет!/);
assert.match(srt,/2\n00:00:02,500 --> 00:00:04,200\nТест перевода/);
assert.doesNotMatch(srt,/\n3\n/);
const page=fs.readFileSync('live-translate.html','utf8');
for (const id of ['livePrepare','liveStart','liveStop','liveRu','liveEn',
  'liveTxt','liveSrt','liveCopy','liveVideo','liveLog','liveDropped']) {
  assert.ok(page.includes('id="'+id+'"'), 'Missing UI id '+id);
}
const source=fs.readFileSync('video.html','utf8');
assert.ok(source.includes('href="./live-translate.html"'));
const worker=fs.readFileSync('live-translate-worker.js','utf8');
assert.ok(worker.includes("'Xenova/opus-mt-en-ru'"));
assert.ok(worker.includes("language: 'english'"));
console.log('Live translation core and UI smoke: PASS');
