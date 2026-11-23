"""Manual check of the REAL capture path: real getDisplayMedia (no mock), real tab
audio, real Whisper + OPUS-MT.

Chrome picks the tab titled "SpeechLab Meeting Tab" automatically
(--auto-select-tab-capture-source-by-title), which stands in for the Контур.Толк tab.
That tab plays fixtures/live-en-sample.wav (synthetic TTS, no meeting data).
Runs headed (minimized): headless Chromium delivers silent tab audio (peak 0).
Needs free RAM: model loading peaks near 1.5 GB; on low-memory PCs Chrome may close the tab.

Usage:  python live_tab_capture_real_test.py [--profile DIR]
"""
import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
PROFILE = sys.argv[sys.argv.index("--profile") + 1] if "--profile" in sys.argv else None
TITLE = "SpeechLab Meeting Tab"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8778), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:8778"

try:
    with sync_playwright() as p:
        args = [
            "--no-sandbox",
            "--start-minimized",
            "--autoplay-policy=no-user-gesture-required",
            "--auto-select-tab-capture-source-by-title=" + TITLE,
        ]
        if PROFILE:
            context = p.chromium.launch_persistent_context(PROFILE, headless=False, args=args)
        else:
            context = p.chromium.launch(headless=False, args=args).new_context()
        meeting = context.new_page()
        meeting.goto(BASE + "/fixtures/meeting-tab.html")
        assert meeting.title() == TITLE
        meeting.evaluate("window.play()")

        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/live-translate.html", wait_until="domcontentloaded")
        assert "getDisplayMedia" in page.evaluate(
            "String(Object.getOwnPropertyNames(MediaDevices.prototype))"), "real API expected"
        page.locator("#livePrepare").click()
        page.wait_for_function(
            "['ГОТОВО', 'ОШИБКА'].includes(document.querySelector('#liveState').textContent)",
            timeout=15 * 60 * 1000,
        )
        assert page.locator("#liveState").inner_text() == "ГОТОВО", page.locator("#liveError").inner_text()

        results = []
        for run in (1, 2):
            page.locator("#liveStart").click()
            page.wait_for_function(
                "!document.querySelector('#liveStop').disabled"
                " || !document.querySelector('#liveError').hidden", timeout=30000)
            assert page.locator("#liveError").is_hidden(), page.locator("#liveError").inner_text()
            tracks = page.evaluate("""() => {
              const s = document.querySelector('#liveVideo').srcObject;
              return { audio: s.getAudioTracks().length, video: s.getVideoTracks().length,
                       label: s.getVideoTracks()[0]?.label || '' };
            }""")
            assert tracks["audio"] == 1 and tracks["video"] == 1, tracks
            page.wait_for_timeout(20000)
            page.locator("#liveStop").click()
            page.wait_for_function(
                "document.querySelector('#liveState').textContent === 'ОСТАНОВЛЕНО'", timeout=120000)
            segments = page.evaluate("""() => [...document.querySelectorAll('#liveLog .live-line')]
              .map((l) => ({ time: l.querySelector('time').textContent,
                             en: l.querySelector('p').textContent,
                             ru: l.querySelector('strong').textContent }))""")
            live_tracks = page.evaluate(
                "document.querySelector('#liveVideo').srcObject === null")
            english = " ".join(s["en"] for s in segments).lower()
            russian = " ".join(s["ru"] for s in segments).lower()
            result = {"run": run, "tracks": tracks, "segments": segments,
                      "dropped": page.locator("#liveDropped").inner_text(),
                      "preview_released": live_tracks}
            results.append(result)
            print(json.dumps(result, ensure_ascii=False, indent=1))
            assert len(segments) >= 2, segments
            assert sum(w in english for w in ("delivery", "schedule", "office", "report", "friday")) >= 3, english
            assert "график" in russian or "отч" in russian or "пятниц" in russian, russian
            assert live_tracks, "capture must be released after stop"
        assert not errors, errors
        context.close()
    print("REAL TAB CAPTURE PASS")
finally:
    server.shutdown()
