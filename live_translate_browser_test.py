import functools
import http.server
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8771), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""
      class FakeWorker {
        constructor() { this.onmessage = null; this.onerror = null; }
        postMessage(payload) {
          if (payload.type === 'init') {
            setTimeout(() => this.onmessage?.({ data: { type: 'ready' } }), 0);
          } else if (payload.type === 'infer') {
            setTimeout(() => this.onmessage?.({ data: {
              type: 'segment', session: payload.session, index: payload.index,
              start: payload.start, end: payload.end,
              en: 'We are discussing delivery.', ru: 'Мы обсуждаем поставки.'
            } }), 0);
          }
        }
        terminate() {}
      }
      window.Worker = FakeWorker;
      const nav = navigator.mediaDevices || {};
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true,
        value: { ...nav, getDisplayMedia: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 16;
          const display = canvas.captureStream(10);
          window.__testAudio = new AudioContext();
          const oscillator = window.__testAudio.createOscillator();
          const destination = window.__testAudio.createMediaStreamDestination();
          oscillator.connect(destination);
          oscillator.start();
          window.__testOscillator = oscillator;
          return new MediaStream([...display.getVideoTracks(), ...destination.stream.getAudioTracks()]);
        } }
      });
    """)
    page.goto("http://127.0.0.1:8771/video.html", wait_until="domcontentloaded")
    assert page.locator('a[href="./live-translate.html"]').count() == 1
    page.locator('a[href="./live-translate.html"]').click()
    page.wait_for_url("**/live-translate.html")
    assert page.locator("#liveStart").is_disabled()
    page.locator("#livePrepare").click()
    page.wait_for_function("!document.querySelector('#liveStart').disabled", timeout=10000)
    assert page.locator("#liveStart").is_enabled()
    page.locator("#liveStart").click()
    page.wait_for_function("!document.querySelector('#liveStop').disabled", timeout=10000)
    assert page.locator("#liveStop").is_enabled()
    page.wait_for_function("document.querySelector('#liveLog').children.length > 0", timeout=15000)
    assert "Мы обсуждаем поставки" in page.locator("#liveRu").inner_text()
    assert page.locator("#liveTxt").is_enabled()
    assert page.locator("#liveSrt").is_enabled()
    with page.expect_download() as event:
        page.locator("#liveSrt").click()
    assert event.value.suggested_filename.endswith(".srt")
    page.locator("#liveStop").click()
    page.wait_for_function("!document.querySelector('#liveStart').disabled", timeout=10000)
    assert page.locator("#liveStart").is_enabled()
    assert not errors, errors
    page.evaluate("window.__testOscillator?.stop(); window.__testAudio?.close();")
    browser.close()

server.shutdown()
print("Speech Lab live translation mocked browser smoke: PASS")
