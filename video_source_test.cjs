/* No external dependencies or network. Real MP4 fixtures generated with FFmpeg. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const sandbox = { window: {}, URL, File, location: { protocol: 'https:' }, fetch: null };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'video-source.js'), 'utf8'), sandbox);
const source = sandbox.window.SpeechVideoSource;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'speechlab-source-'));
const signal = () => new AbortController().signal;
(async () => {
  for (const url of ['file:///tmp/video.mp4', 'https://a:b@example.org/a.mp4',
    'http://example.org/a.mp4', 'https://127.1/a.mp4', 'https://[::1]/a.mp4',
    'https://localhost/a.mp4', 'https://metadata.internal/a.mp4',
    'https://youtube.com/watch?v=x', 'https://vkvideo.ru/video/x', 'https://rutube.ru/video/x']) {
    assert.throws(() => source.validate(url), undefined, url);
  }
  assert.equal(source.validate('https://media.example.org/video.mp4#test').href, 'https://media.example.org/video.mp4');
  const fixture = path.join(folder, 'video.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=128x96:r=2:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', fixture]);
  const media = fs.readFileSync(fixture);
  const metadata = source.mp4Metadata(media);
  assert.equal(metadata.hasAudio, true);
  assert.equal(metadata.height, 96);
  assert.equal(metadata.width, 128);
  assert(metadata.duration >= 2 && metadata.duration < 3);
  const silent = path.join(folder, 'silent.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fixture, '-an', '-c:v', 'copy', silent]);
  assert.equal(source.mp4Metadata(fs.readFileSync(silent)).hasAudio, false);
  for (let length = 0; length < media.length; length += 71) {
    assert.doesNotThrow(() => source.mp4Metadata(media.subarray(0, length)));
  }
  const calls = [];
  sandbox.fetch = async (url, options) => {
    calls.push(options);
    if (options.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(media.length) }});
    return new Response(media, { status: options.headers ? 206 : 200,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(media.length), 'Content-Range': `bytes 0-${media.length-1}/${media.length}` }});
  };
  const result = await source.probe('https://media.example.org/video.mp4', signal());
  assert.equal(result.hasAudio, true);
  assert.equal(result.size, media.length);
  assert.equal(calls.length, 2);
  assert(calls.every((x) => x.credentials === 'omit' && x.referrerPolicy === 'no-referrer'));
  const downloaded = await source.retrieve(result, signal(), () => {});
  assert.equal(downloaded.size, media.length);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), media);
  sandbox.fetch = async () => new Response(null, { headers: { 'Content-Length': String(301 * 1024 * 1024) }});
  await assert.rejects(source.probe('https://media.example.org/large.mp4', signal()), /300 МБ/);
  sandbox.fetch = async () => new Response('<html>Login required</html>', { headers: { 'Content-Type': 'text/html' }});
  await assert.rejects(source.probe('https://media.example.org/page', signal()), /прямая ссылка/);
  // A server ignoring Range cannot force a full-body probe.
  let readChunks = 0, cancelled = false;
  sandbox.fetch = async (url, options) => {
    if (options.method === 'HEAD') return new Response(null, { status: 405 });
    return new Response(new ReadableStream({
      pull(controller) { readChunks++; controller.enqueue(new Uint8Array(64 * 1024)); },
      cancel() { cancelled = true; }
    }), { headers: { 'Content-Type': 'video/webm' }});
  };
  await source.probe('https://media.example.org/video.webm', signal());
  assert(cancelled);
  assert(readChunks <= 18, 'Probe exceeded 1 MB plus stream prefetch');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(source.probe('https://media.example.org/video.mp4', controller.signal), /abort/i);
  console.log('Video source URL/metadata/bounds/privacy/cancellation: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(folder, { recursive: true, force: true }));
