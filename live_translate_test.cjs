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
near(down[200], Math.sin(2*Math.PI*400*(200*3+1)/48000), 0.005);
assert.equal(core.resampleMono(new Float32Array([0.25,0.5]),16000)[1],0.5);
assert.equal(core.resampleMono(new Float32Array(0),48000).length,0);

// Streaming resampler must retain its phase across blocks (e.g. 44.1k -> 16k).
const sourceRate = 44100;
const input = Float32Array.from({length:sourceRate*3+317}, (_,i) => Math.sin(i*2*Math.PI*330/sourceRate));
const expected = core.resampleMono(input,sourceRate);
const streamResampler = core.createStreamingResampler(sourceRate);
const parts=[];
for(let i=0;i<input.length;i+=4096) parts.push(streamResampler.push(input.slice(i,i+4096)));
const flattened = Float32Array.from(parts.flatMap(part=>Array.from(part)));
assert.equal(flattened.length,expected.length,'Streaming conversion must not lose samples between blocks');
for (let i=0;i<flattened.length;i+=223) near(flattened[i],expected[i],0.005);

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
// Whisper sound-event annotations must never be translated as speech.
for (const text of ['[BLANK_AUDIO]', ' [Music]', '(upbeat music)', '♪ ♪', '*applause*', 'Music.', '', '  ...  ', '[ Silence ]']) {
  assert.ok(core.isNonSpeech(text), 'Non-speech not detected: ' + JSON.stringify(text));
}
for (const text of ['Hello everyone.', 'We need the music license.', 'OK', '[Music] Let us start.']) {
  assert.ok(!core.isNonSpeech(text), 'Speech wrongly rejected: ' + JSON.stringify(text));
}
assert.equal(core.stripAnnotations('[Music] Let us   start. (laughs)'), 'Let us start.');

assert.deepEqual(core.splitSentences('The new office will open in March. Please send the report before Friday.'),
  ['The new office will open in March.', 'Please send the report before Friday.']);
assert.deepEqual(core.splitSentences('Ask Dr. Smith today! Is it ready? Yes… ok'),
  ['Ask Dr. Smith today!', 'Is it ready?', 'Yes…', 'ok']);
assert.deepEqual(core.splitSentences('  no punctuation here  '), ['no punctuation here']);
assert.deepEqual(core.splitSentences(''), []);

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
