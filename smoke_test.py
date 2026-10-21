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
    assert page.locator("#appVersion").inner_text() == "v1.6.5"
    assert page.locator("#chooseSaveFolderBtn").count() == 1
    assert page.locator("#transcribeBtn").is_disabled()
    page.click("#dictaphoneModeBtn")
    assert page.locator("#dictaphoneMode").is_visible()
    page.wait_for_selector("#dictaphoneSaveFolderSlot #chooseSaveFolderBtn")
    start_box = page.locator("#startDictaphoneBtn").bounding_box()
    help_box = page.locator("#dictaphoneMode .capture-help").bounding_box()
    folder_box = page.locator("#dictaphoneSaveFolderSlot .folder-save-row").bounding_box()
    assert start_box and help_box and folder_box
    assert abs(start_box["y"] - help_box["y"]) <= 3, "Help is not inline with start"
    assert abs(start_box["y"] - folder_box["y"]) <= 3, "Save folder is not inline with start"
    assert start_box["x"] < help_box["x"] < folder_box["x"]
    page.click("#dictaphoneMode .capture-help summary")
    assert page.locator("#dictaphoneMode .capture-help").get_attribute("open") is not None
    page.click("#dictaphoneMode .capture-help summary")
    page.set_viewport_size({"width": 390, "height": 780})
    start_box = page.locator("#startDictaphoneBtn").bounding_box()
    help_box = page.locator("#dictaphoneMode .capture-help").bounding_box()
    folder_box = page.locator("#dictaphoneSaveFolderSlot .folder-save-row").bounding_box()
    assert start_box and help_box and folder_box
    assert start_box["y"] < help_box["y"] < folder_box["y"], "Mobile toolbar must stack"
    page.set_viewport_size({"width": 1280, "height": 720})
    page.click("#fileModeBtn")
    assert page.locator("#fileMode").is_visible()
    page.wait_for_selector(".input-panel > .folder-save-row #chooseSaveFolderBtn")
    assert page.locator("#chooseSaveFolderBtn").count() == 1
    page.locator("#fileInput").set_input_files({
        "name": "test.wav", "mimeType": "audio/wav",
        "buffer": b"RIFF" + b"\\x00" * 100
    })
    assert page.locator("#fileName").inner_text() == "test.wav"
    assert page.locator("#transcribeBtn").is_enabled()
    page.click("#removeFileBtn")
    assert page.locator("#transcribeBtn").is_disabled()
    # Simulate a display-capture source without audio. It must be rejected.
    page.click("#liveModeBtn")
    page.evaluate("""() => {
      window.__stopped = false;
      navigator.mediaDevices.getDisplayMedia = async () => ({
        getVideoTracks: () => [{
          readyState: 'live',
          getSettings: () => ({ displaySurface: 'browser' }),
          stop: () => { window.__stopped = true; },
        }],
        getAudioTracks: () => [],
        getTracks: () => [{
          stop: () => { window.__stopped = true; }
        }],
      });
    }""")
    page.click("#startCaptureBtn")
    page.wait_for_function("document.querySelector('#captureStatusText').textContent.includes('НЕ ПЕРЕДАН')")
    assert page.locator("#captureDiagnostic").is_visible()
    assert page.locator("#stopCaptureBtn").is_hidden()
    assert page.evaluate("window.__stopped")
    assert not errors, errors
    browser.close()
server.shutdown()
print("Speech Lab browser smoke: PASS")
