"""Manual end-to-end check with REAL models and REAL inference (no fake Worker).

Chain under test: tab audio (synthetic English speech fixture) -> Web Audio -> 16 kHz
fragments -> Whisper Tiny -> English text -> OPUS-MT -> Russian text -> captions/log.

Only getDisplayMedia is replaced, because the browser picker cannot be automated; it
returns a stream that plays fixtures/live-en-sample.wav (synthetic TTS, no real meeting
data). Downloads Transformers.js and ONNX weights from jsDelivr/Hugging Face.

Usage:  python live_model_e2e_real_test.py [--profile DIR]
  --profile DIR keeps the browser cache between runs (models load from cache).
"""
import functools
import http.server
import json
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
PROFILE = sys.argv[sys.argv.index("--profile") + 1] if "--profile" in sys.argv else None
RUNS = 2  # second run proves a clean restart with already loaded models


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8776), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()

INIT = """
  window.__lines = [];
  new MutationObserver(() => {
    const log = document.querySelector('#liveLog');
    if (log && log.children.length > window.__lines.length) {
      window.__lines.push(performance.now());
    } else if (log && !log.children.length) {
      window.__lines = [];
    }
  }).observe(document, { childList: true, subtree: true });
  const nav = navigator.mediaDevices || {};
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true,
    value: { ...nav, addEventListener() {}, removeEventListener() {}, getDisplayMedia: async () => {
      const ctx = new AudioContext();
      const data = await (await fetch('./fixtures/live-en-sample.wav')).arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const destination = ctx.createMediaStreamDestination();
      source.connect(destination);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const display = canvas.captureStream(5);
      window.__playbackSeconds = buffer.duration;
      window.__captureStarted = performance.now();
      source.start();
      return new MediaStream([...display.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    } }
  });
"""


def run():
    with sync_playwright() as p:
        args = ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
        if PROFILE:
            context = p.chromium.launch_persistent_context(PROFILE, headless=True, args=args)
            page = context.new_page()
        else:
            context = p.chromium.launch(headless=True, args=args)
            page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(INIT)
        page.goto("http://127.0.0.1:8776/live-translate.html", wait_until="domcontentloaded")

        t0 = time.monotonic()
        page.locator("#livePrepare").click()
        page.wait_for_function(
            "['ГОТОВО', 'ОШИБКА'].includes(document.querySelector('#liveState').textContent)",
            timeout=15 * 60 * 1000,
        )
        load_seconds = time.monotonic() - t0
        assert page.locator("#liveState").inner_text() == "ГОТОВО", (
            page.locator("#liveStatus").inner_text(), page.locator("#liveError").inner_text())
        print(f"Models ready in {load_seconds:.1f}s:", page.locator("#liveDiagnostic").inner_text())

        report = []
        for run_index in range(RUNS):
            page.locator("#liveStart").click()
            page.wait_for_function("!document.querySelector('#liveStop').disabled", timeout=20000)
            duration = page.evaluate("window.__playbackSeconds")
            page.wait_for_timeout(int(duration * 1000) + 600)
            stop_at = time.monotonic()
            page.locator("#liveStop").click()
            page.wait_for_function(
                "document.querySelector('#liveState').textContent === 'ОСТАНОВЛЕНО'",
                timeout=120000,
            )
            drain = time.monotonic() - stop_at
            data = page.evaluate("""() => ({
              started: window.__captureStarted, lines: window.__lines,
              segments: [...document.querySelectorAll('#liveLog .live-line')].map((line) => ({
                time: line.querySelector('time').textContent,
                en: line.querySelector('p').textContent,
                ru: line.querySelector('strong').textContent })),
              dropped: document.querySelector('#liveDropped').textContent,
              error: document.querySelector('#liveError').hidden ? '' : document.querySelector('#liveError').textContent,
            })""")
            english = " ".join(s["en"] for s in data["segments"]).lower()
            russian = " ".join(s["ru"] for s in data["segments"])
            # Fragment k ends at 6*(k+1) s of audio; arrival is measured from capture start.
            latencies = [round((at - data["started"]) / 1000 - min(6 * (i + 1), duration), 2)
                         for i, at in enumerate(data["lines"])]
            run_report = {"run": run_index + 1, "drain_after_stop_s": round(drain, 2),
                          "latency_after_fragment_end_s": latencies, **data}
            run_report.pop("lines")
            run_report.pop("started")
            report.append(run_report)
            print(json.dumps(run_report, ensure_ascii=False, indent=1))
            assert not data["error"], data["error"]
            assert data["dropped"] == "0", data
            hits = [w for w in ("morning", "delivery", "schedule", "office", "report", "friday")
                    if w in english]
            assert len(hits) >= 4, f"Whisper missed too much of the fixture: {english!r}"
            assert sum("а" <= c.lower() <= "я" for c in russian) > 40, f"No Russian output: {russian!r}"
            assert "report" in english or "friday" in english, "last phrase (tail) was lost: " + english
            # Regression: OPUS-MT used to drop every sentence after the first one in a fragment.
            assert "пятниц" in russian.lower() or "отч" in russian.lower(), (
                "last English sentence missing from the Russian translation: " + russian)

        assert not errors, errors
        context.close()
        return load_seconds, report


try:
    load, result = run()
    print(f"REAL E2E PASS · model load {load:.1f}s · runs {len(result)}")
finally:
    server.shutdown()
