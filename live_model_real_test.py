"""Manual integration check: real downloaded Whisper + translation models, no fake Worker."""
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
    ("127.0.0.1", 8774), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--enable-unsafe-swiftshader"],
        )
        page = browser.new_page()
        page_errors = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto("http://127.0.0.1:8774/live-translate.html", wait_until="domcontentloaded")
        assert page.locator("#liveStart").is_disabled()
        page.locator("#livePrepare").click()
        # This test intentionally fetches real JS and large ONNX weights.
        # It is manual and never runs during the regular smoke workflow.
        page.wait_for_function(
            """() => {
              const status = document.querySelector('#liveState')?.textContent;
              return status === 'ГОТОВО' || status === 'ОШИБКА';
            }""",
            timeout=14 * 60 * 1000,
        )
        status = page.locator("#liveState").inner_text()
        diagnostic = page.locator("#liveDiagnostic").inner_text()
        assert status == "ГОТОВО", (
            "Real AI model failed: " + page.locator("#liveStatus").inner_text()
            + " / " + page.locator("#liveError").inner_text()
            + " / page errors: " + repr(page_errors)
        )
        assert "→" in diagnostic and "Проверка модели" in diagnostic, diagnostic
        assert page.locator("#liveStart").is_enabled()
        assert not page_errors, page_errors
        print("REAL MODEL PREFLIGHT PASS")
        print("Diagnostic:", diagnostic)
        browser.close()
finally:
    server.shutdown()
