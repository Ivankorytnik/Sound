"""Real Worker (no mocks) with CDN / Hugging Face blocked: preparation must fail
quickly with an actionable error, keep capture disabled and allow a retry."""
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
    ("127.0.0.1", 8777), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context()
        blocked = []

        def block(route):
            blocked.append(route.request.url)
            route.abort()

        for pattern in ("**/cdn.jsdelivr.net/**", "**/huggingface.co/**", "**/*.hf.co/**"):
            context.route(pattern, block)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:8777/live-translate.html", wait_until="domcontentloaded")
        for attempt in (1, 2):
            started = time.monotonic()
            page.locator("#livePrepare").click()
            page.wait_for_function(
                "['ГОТОВО', 'ОШИБКА'].includes(document.querySelector('#liveState').textContent)",
                timeout=120000,
            )
            took = time.monotonic() - started
            assert page.locator("#liveState").inner_text() == "ОШИБКА"
            message = page.locator("#liveError").inner_text()
            assert "huggingface.co" in message and "повтори" in message, message
            assert "Запись не удалена" not in message, "file-transcription wording leaked: " + message
            assert page.locator("#liveStart").is_disabled(), "capture must stay disabled"
            assert page.locator("#livePrepare").is_enabled(), "retry must be possible"
            print(f"attempt {attempt}: failed in {took:.1f}s · {message[:160]}")
        assert blocked, "the test must actually block model/CDN requests"
        assert not errors, errors
        browser.close()
    print("Speech Lab offline model failure: PASS")
finally:
    server.shutdown()
