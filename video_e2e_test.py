"""End-to-end video decoding in Chromium with genuine ffmpeg.wasm and mocked ASR only."""
import functools
import http.server
import pathlib
import shutil
import subprocess
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent
fixture = ROOT / "_video_ci_fixture.mp4"
if not shutil.which("ffmpeg"):
    raise RuntimeError("ffmpeg CLI is needed to create the e2e media fixture")
subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=128x96:r=2:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
    "-c:v", "mpeg4", "-c:a", "aac", "-shortest", str(fixture)
], check=True, timeout=40)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8767), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page(accept_downloads=True)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: print("BROWSER", msg.type, msg.text[:700]) if msg.type == "error" else None)
        page.add_init_script("""
          (() => {
            const NativeWorker = window.Worker;
            window.Worker = function(url, options) {
              if (!String(url).includes('transcription-worker.js')) {
                return new NativeWorker(url, options);
              }
              return {
                onmessage: null, onerror: null, onmessageerror: null,
                postMessage(data) {
                  const samples = new Float32Array(data.audioBuffer);
                  window.__decodedSamples = samples.length;
                  window.__decodedPeak = samples.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0);
                  setTimeout(() => {
                    this.onmessage?.({data: {
                      type:'result', jobId:data.jobId,
                      output:{
                        text:'Тестовая транскрибация видео',
                        chunks:[{text:'Тестовая транскрибация видео',timestamp:[0,1.5]}]
                      }
                    }});
                  }, 100);
                },
                terminate() {}
              };
            };
            window.Worker.prototype = NativeWorker.prototype;
          })();
        """)
        page.goto("http://127.0.0.1:8767/video.html", wait_until="domcontentloaded")
        page.locator("#videoFile").set_input_files(str(fixture))
        assert page.locator("#videoStartBtn").is_enabled()
        page.click("#videoStartBtn")
        page.wait_for_function(
            "() => document.querySelector('#videoStatus').textContent === 'ГОТОВО'",
            timeout=180_000
        )
        assert page.locator("#videoText").input_value() == "Тестовая транскрибация видео"
        assert page.evaluate("window.__decodedSamples") >= 30_000, "Audio extraction produced too few samples"
        assert page.evaluate("window.__decodedPeak") > .01, "Audio track was silent"
        assert page.locator("#videoSrt").is_enabled()
        assert page.locator("#videoTxt").is_enabled()
        with page.expect_download() as download_info:
            page.locator("#videoTxt").click()
        download = download_info.value
        assert download.suggested_filename.endswith(".txt")
        with page.expect_download() as download_info:
            page.locator("#videoSrt").click()
        download = download_info.value
        assert download.suggested_filename.endswith(".srt")
        assert page.locator("#videoError").is_hidden()
        assert not errors, errors
        print("Video decode/ASR handoff/download E2E: PASS")
        browser.close()
finally:
    server.shutdown()
    fixture.unlink(missing_ok=True)
