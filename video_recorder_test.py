"""Native MediaRecorder/Web Audio test with synthetic capture streams.
The OS picker is stubbed; encoding, mixing, downloads and playback are real.
"""
import functools
import http.server
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}/video.html'
SETUP = """
(() => {
  window.captureMode = 'sound'; window.captureTracks = []; window.audioContexts = [];
  const NativeRecorder = window.MediaRecorder;
  window.recordedStreams = [];
  window.MediaRecorder = class extends NativeRecorder {
    constructor(stream, options) { super(stream, options); window.recordedStreams.push(stream); }
  };
  function tone(frequency) {
    const ctx = new AudioContext(); window.audioContexts.push(ctx);
    const osc = ctx.createOscillator(), out = ctx.createMediaStreamDestination();
    osc.frequency.value = frequency; osc.connect(out); osc.start(); ctx.resume();
    return out.stream.getAudioTracks()[0];
  }
  navigator.mediaDevices.getDisplayMedia = async options => {
    window.lastCaptureOptions = options;
    if (captureMode === 'deny') throw new DOMException('denied', 'NotAllowedError');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'); let frame = 0;
    setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#216f99' : '#603dc8'; ctx.fillRect(0,0,320,180); }, 40);
    const stream = canvas.captureStream(25);
    if (options.audio && captureMode !== 'silent') stream.addTrack(tone(440));
    window.lastDisplay = stream;
    window.captureTracks.push(...stream.getTracks());
    if (captureMode === 'pending') return new Promise(resolve => window.resolveCapture = () => resolve(stream));
    return stream;
  };
  navigator.mediaDevices.getUserMedia = async options => {
    window.lastMicOptions = options;
    if (captureMode === 'mic-deny') throw new DOMException('denied','NotAllowedError');
    const stream = new MediaStream([tone(880)]);
    window.captureTracks.push(...stream.getTracks()); return stream;
  };
})();
"""
def stopped(page):
    assert page.evaluate("captureTracks.every(t => t.readyState === 'ended')")
    assert page.evaluate("recordedStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))")

def start(page, mode='sound', mic=False):
    page.evaluate('(mode) => captureMode = mode', mode)
    page.locator('#videoRecordMic').set_checked(mic)
    page.click('#videoRecordStart')
    page.wait_for_function("document.querySelector('#videoRecordStatus').textContent.includes('Идёт запись')")

def stop(page):
    page.click('#videoRecordStop')
    page.wait_for_function("document.querySelector('#videoRecordStatus').textContent === 'Запись готова'")
    stopped(page)

try:
    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
        browser = p.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'])
        page = browser.new_page(accept_downloads=True, viewport={'width':1366,'height':900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda dialog: dialog.accept())
        page.add_init_script(SETUP)
        page.goto(URL)
        page.click('#videoSourceRecord')
        assert page.locator('#videoDrop').is_hidden()
        assert page.locator('#videoRecordSound').is_checked()
        assert not page.locator('#videoRecordMic').is_checked()
        start(page, mic=True)
        assert page.locator('#videoSourceFile').is_disabled()
        assert page.locator('#videoStartBtn').is_disabled()
        assert 'подключён' in page.locator('#videoRecordMicStatus').inner_text()
        assert page.evaluate('recordedStreams[0].getAudioTracks().length') == 1, 'Audio must be mixed into one track'
        page.wait_for_timeout(1300)
        page.click('#videoRecordPause')
        timer = page.locator('#videoRecordTimer').inner_text()
        page.wait_for_timeout(1200)
        assert page.locator('#videoRecordTimer').inner_text() == timer, 'Pause is excluded from timer'
        page.click('#videoRecordResume')
        page.wait_for_timeout(1100)
        stop(page)
        assert page.locator('#videoPreview').is_visible()
        assert page.locator('#videoStartBtn').is_enabled()
        assert page.locator('#videoDownloadAudio').is_enabled()
        with page.expect_download() as info: page.click('#videoDownloadVideo')
        output = pathlib.Path(tmp) / info.value.suggested_filename
        info.value.save_as(output)
        probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(output)]))
        assert {s['codec_type'] for s in probe['streams']} == {'audio', 'video'}
        # Verify both independent tones survived the Web Audio mix and encoding.
        raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(output),'-vn','-ac','1','-ar','8000','-f','f32le','-'])
        import array, math
        samples = array.array('f',raw)
        def amplitude(hz):
            return abs(sum(x * complex(math.cos(2*math.pi*hz*i/8000), math.sin(2*math.pi*hz*i/8000))
                           for i,x in enumerate(samples))) / len(samples)
        assert amplitude(440) > .03 and amplitude(880) > .03
        page.click('#videoSourceFile'); page.click('#videoSourceRecord')
        assert page.locator('#videoDownloadVideo').is_enabled(), 'Return to record restores the completed file'
        # Silent recording and ended event in pause must finalize a playable video without ASR.
        start(page, 'silent')
        page.wait_for_timeout(1100)
        assert 'недоступен' in page.locator('#videoRecordSoundStatus').inner_text()
        page.click('#videoRecordPause')
        page.evaluate("lastDisplay.getVideoTracks()[0].dispatchEvent(new Event('ended'))")
        page.wait_for_function("document.querySelector('#videoRecordStatus').textContent === 'Запись готова'")
        stopped(page)
        assert page.locator('#videoStartBtn').is_disabled()
        assert page.locator('#videoDownloadAudio').is_disabled()
        assert page.locator('#videoDownloadVideo').is_enabled()
        with page.expect_download() as info: page.click('#videoDownloadVideo')
        silent = pathlib.Path(tmp) / 'silent.webm'; info.value.save_as(silent)
        probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(silent)]))
        assert [s['codec_type'] for s in probe['streams']] == ['video']
        # Mic-only path: no system sound requested, but audio is present and ready for Whisper.
        page.locator('#videoRecordSound').uncheck()
        start(page, 'silent', mic=True)
        page.wait_for_timeout(500)
        assert page.evaluate('lastCaptureOptions.audio') is False
        stop(page)
        assert page.locator('#videoStartBtn').is_enabled()
        # Permission failures release all tracks and retain the previous downloadable file.
        page.evaluate("captureMode = 'mic-deny'")
        page.click('#videoRecordStart')
        page.wait_for_function("document.querySelector('#videoRecordStart').disabled === false")
        stopped(page)
        assert 'доступ запрещён' in page.locator('#videoRecordNote').inner_text()
        assert page.locator('#videoDownloadVideo').is_enabled()
        page.evaluate("captureMode = 'deny'")
        page.click('#videoRecordStart')
        page.wait_for_function("document.querySelector('#videoRecordStart').disabled === false")
        stopped(page)
        # Cancelling while the native picker is pending discards the later stream.
        page.evaluate("captureMode = 'pending'")
        page.click('#videoRecordStart'); page.click('#videoRecordStop')
        page.evaluate('resolveCapture()')
        page.wait_for_timeout(150)
        stopped(page)
        # Screenshot and overflow checks at desktop/mobile widths.
        (ROOT / 'screenshots').mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT / 'screenshots' / 'video-record-desktop.png'), full_page=True)
        for width in [390, 768, 1366]:
            page.set_viewport_size({'width':width, 'height':900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}'
        assert not errors, errors
        browser.close()
        print('Screen recording: native encode/mix, pause, downloads, silent/mic-only, ended, cancellation, errors, layout: PASS')
finally:
    server.shutdown()
