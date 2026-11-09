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
    ("127.0.0.1", 8766), functools.partial(Quiet, directory=str(ROOT))
)
threading.Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8766/", wait_until="domcontentloaded")
    assert page.locator(".video-entry-link").count() == 1
    # Original modes remain available; default dictaphone has not changed.
    assert page.locator("#dictaphoneModeBtn").get_attribute("aria-selected") == "true"
    assert page.locator("#fileModeBtn").count() == 1
    assert page.locator("#liveModeBtn").count() == 1
    page.locator(".video-entry-link").click()
    page.wait_for_url("**/video.html")
    assert page.locator("#videoStartBtn").is_disabled()
    assert page.locator("#videoResult").is_hidden()
    page.locator("#videoFile").set_input_files({
        "name": "demo.mp4",
        "mimeType": "video/mp4",
        "buffer": b"dummy-video-content",
    })
    assert page.locator("#videoFileName").inner_text() == "demo.mp4"
    assert page.locator("#videoStartBtn").is_enabled()
    page.locator("#videoClearButton").click()
    assert page.locator("#videoStartBtn").is_disabled()
    page.locator("#videoFile").set_input_files({
        "name": "wrong.txt",
        "mimeType": "text/plain",
        "buffer": b"no",
    })
    assert page.locator("#videoError").is_visible()
    assert page.locator("#videoStartBtn").is_disabled()
    assert not errors, errors
    page.locator(".video-back").click()
    page.wait_for_url("http://127.0.0.1:8766/")
    assert page.locator("#dictaphoneModeBtn").get_attribute("aria-selected") == "true"
    browser.close()

server.shutdown()
print("Speech Lab isolated video UI smoke: PASS")
