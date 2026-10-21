import http.server
import functools
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8765", wait_until="networkidle")
    page.wait_for_selector("#appVersion")
    assert page.locator("#appVersion").inner_text() == "v1.6.4"
    assert page.locator("#chooseSaveFolderBtn").count() == 1
    assert page.locator("#transcribeBtn").is_disabled()
    page.click("#dictaphoneModeBtn")
    assert page.locator("#dictaphoneMode").is_visible()
    page.click("#fileModeBtn")
    assert page.locator("#fileMode").is_visible()
    page.locator("#fileInput").set_input_files({
        "name": "test.wav", "mimeType": "audio/wav",
        "buffer": b"RIFF" + b"\\x00" * 100
    })
    assert page.locator("#fileName").inner_text() == "test.wav"
    assert page.locator("#transcribeBtn").is_enabled()
    page.click("#removeFileBtn")
    assert page.locator("#transcribeBtn").is_disabled()
    assert not errors, errors
    browser.close()
server.shutdown()
print("Speech Lab browser smoke: PASS")
