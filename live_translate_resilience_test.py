"""Mocked-Worker regression tests for live translation failure handling.

Covers: hung AI Worker (watchdog), fatal repeated failures, Worker crash while
draining the last fragment, audio-based timecodes and restart after failure.
No real models are downloaded here; see live_model_real_test.py for that.
"""
import functools
import http.server
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8775), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()

INIT = """
  window.SPEECHLAB_LIVE_WATCHDOG_MS = 1500;
  window.__mode = 'ok';
  window.__workers = 0;
  class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null; window.__workers += 1; }
    emit(data) { setTimeout(() => this.onmessage?.({ data }), 0); }
    postMessage(payload) {
      if (payload.type === 'init') {
        this.emit({ type: 'ready' });
        return;
      }
      if (payload.type !== 'infer') return;
      const base = { session: payload.session, index: payload.index };
      const mode = window.__mode;
      if (mode === 'hang') return;
      if (mode === 'fatal') {
        this.emit({ type: 'failure', phase: 'infer', fatal: true, message: 'ONNX test failure.', ...base });
      } else if (mode === 'crash') {
        setTimeout(() => this.onerror?.({ message: 'boom', preventDefault() {} }), 0);
      } else {
        this.emit({ type: 'segment', ...base, start: payload.start, end: payload.end,
          en: 'We are discussing delivery.', ru: 'Мы обсуждаем поставки.' });
      }
    }
    terminate() {}
  }
  window.Worker = FakeWorker;
  const nav = navigator.mediaDevices || {};
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true,
    value: { ...nav, addEventListener() {}, removeEventListener() {}, getDisplayMedia: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const display = canvas.captureStream(10);
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      return new MediaStream([...display.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    } }
  });
"""


def text(page, selector):
    return page.locator(selector).inner_text()


def prepare(page):
    page.locator("#livePrepare").click()
    page.wait_for_function("!document.querySelector('#liveStart').disabled", timeout=10000)


def capture_tail_and_stop(page):
    """Capture ~2 s (less than one frame) and stop, so the tail is processed during drain."""
    page.locator("#liveStart").click()
    page.wait_for_function("!document.querySelector('#liveStop').disabled", timeout=10000)
    page.wait_for_timeout(2000)
    started = time.monotonic()
    page.locator("#liveStop").click()
    page.wait_for_function("document.querySelector('#liveState').textContent === 'ОСТАНОВЛЕНО'",
                           timeout=15000)
    return time.monotonic() - started


def assert_failed_and_recoverable(page, needle):
    assert page.locator("#liveError").is_visible(), "error must be visible"
    assert needle in text(page, "#liveError"), text(page, "#liveError")
    assert page.locator("#livePrepare").is_enabled(), "models must be re-preparable"
    assert page.locator("#liveStart").is_disabled(), "start must wait for new models"
    assert page.locator("#liveStop").is_disabled()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(INIT)
    page.goto("http://127.0.0.1:8775/live-translate.html", wait_until="domcontentloaded")

    # 1. Normal tail: timecodes follow captured audio, not the 6-second grid.
    prepare(page)
    capture_tail_and_stop(page)
    assert page.locator("#liveLog .live-line").count() == 1
    with page.expect_download() as event:
        page.locator("#liveSrt").click()
    srt = Path(event.value.path()).read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:0" in srt, srt
    end_seconds = int(srt.split("-->")[1].strip()[6:8])
    assert end_seconds < 4, "tail fragment must not be stamped as a full 6 s frame: " + srt

    # 2. Hung model: watchdog releases the worker instead of waiting 30 s for drain.
    page.evaluate("window.__mode = 'hang'")
    took = capture_tail_and_stop(page)
    assert took < 8, f"hung worker blocked stop for {took:.1f}s"
    assert_failed_and_recoverable(page, "не отвечает")
    assert text(page, "#liveDropped") == "1", text(page, "#liveDropped")

    # 3. Restart after failure, then repeated fatal failures stop the session cleanly.
    page.evaluate("window.__mode = 'fatal'")
    prepare(page)
    assert page.evaluate("window.__workers") == 2, "a fresh worker must be created"
    took = capture_tail_and_stop(page)
    assert took < 8, f"fatal failure blocked stop for {took:.1f}s"
    assert_failed_and_recoverable(page, "несколько раз")

    # 4. Worker crash while draining the last fragment must not wait for the 30 s timeout.
    page.evaluate("window.__mode = 'crash'")
    prepare(page)
    took = capture_tail_and_stop(page)
    assert took < 8, f"crashed worker blocked stop for {took:.1f}s"
    assert_failed_and_recoverable(page, "Ошибка AI Worker")

    # 5. Full recovery: a new session works and replaces the old transcript.
    page.evaluate("window.__mode = 'ok'")
    prepare(page)
    capture_tail_and_stop(page)
    assert page.locator("#liveLog .live-line").count() == 1
    assert "Мы обсуждаем поставки" in text(page, "#liveRu")
    assert text(page, "#liveDropped") == "0"

    assert not errors, errors
    browser.close()

server.shutdown()
print("Speech Lab live translation resilience: PASS")
