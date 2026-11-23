"""Browser regression: interrupted recording recovery and folder import."""
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
    ('127.0.0.1', 8783), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox'])
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:8783/')
    page.wait_for_function('!!window.SpeechLabRecovery && !!window.SpeechLabApp')
    assert page.locator('#speechlabRecovery').count() == 1
    page.evaluate("""async () => {
      const backup = window.SpeechLabRecovery;
      const id = await backup.begin('dictaphone', 'audio/webm');
      if (!id) throw new Error('Could not create session');
      backup.append('dictaphone', new Blob(['first'], {type: 'audio/webm'}));
      backup.append('dictaphone', new Blob(['second'], {type: 'audio/webm'}));
      await backup.finish('dictaphone');
    }""")
    page.wait_for_function("document.querySelector('#recoverySessions').textContent.includes('завершена')")
    page.locator('#recoverySessions button').first.click()
    page.wait_for_function("document.querySelector('#fileName').textContent.includes('dictaphone_')")
    assert page.locator('#downloadAudioBtn').is_visible()
    assert not errors, errors
    page.reload()
    page.wait_for_function('!!window.SpeechLabRecovery && !!window.SpeechLabApp')
    page.locator('#refreshRecoveryBtn').click()
    page.wait_for_function("document.querySelector('#recoverySessions').textContent.includes('завершена')")
    page.locator('#recoverySessions button').first.click()
    page.wait_for_function("document.querySelector('#fileName').textContent.includes('dictaphone_')")
    assert page.locator('#downloadAudioBtn').is_visible()
    chooser = page.locator('#speechlabRecovery input[type=file]')
    chooser.set_input_files([
        {'name': 'meeting.webm', 'mimeType': 'audio/webm', 'buffer': b'audio'},
        {'name': 'meeting.txt', 'mimeType': 'text/plain', 'buffer': 'Привет, это архив.'.encode('utf-8')},
    ])
    page.wait_for_function("document.querySelector('#recoveryFolderFiles').textContent.includes('meeting.webm')")
    page.locator('#recoveryFolderFiles button').first.click()
    page.wait_for_function("document.querySelector('#transcript').value.includes('Привет, это архив.')")
    assert page.locator('#fileName').inner_text() == 'meeting.webm'
    assert not errors, errors
    browser.close()
server.shutdown()
print('Recording recovery: persistent chunks, reopen after reload, folder TXT/audio import PASS')
