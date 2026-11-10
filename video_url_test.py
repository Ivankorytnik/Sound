"""Direct URL behavior using controlled media responses; no third-party availability claims."""
import functools
import http.server
import subprocess
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 8768), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'video.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                        'color=c=black:s=128x96:r=2:d=2', '-f', 'lavfi', '-i',
                        'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', str(path)], check=True)
        media = path.read_bytes()
        silent_path = Path(folder) / 'silent.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(path), '-an', '-c:v', 'copy', str(silent_path)], check=True)
        silent = silent_path.read_bytes()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
            page = browser.new_page(accept_downloads=True)
            errors = []
            requests = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            def media_route(route):
                request = route.request
                requests.append((request.url, request.method, request.headers.get('range')))
                if request.url.endswith('/forbidden.mp4'):
                    route.fulfill(status=403, body='Forbidden'); return
                if request.url.endswith('/page'):
                    route.fulfill(status=200, content_type='text/html', body='<html>Not a video</html>'); return
                if request.url.endswith('/large.mp4'):
                    route.fulfill(status=200, headers={'Content-Type': 'video/mp4', 'Content-Length': str(301 * 1024 * 1024)}, body=''); return
                if request.url.endswith('/blocked.mp4'):
                    route.abort('failed'); return
                data = silent if request.url.endswith('/silent.mp4') else media
                headers = {'Content-Type': 'video/mp4', 'Content-Length': str(len(data))}
                if request.method == 'HEAD': route.fulfill(status=200, headers=headers, body=''); return
                if request.headers.get('range'):
                    headers['Content-Range'] = f'bytes 0-{len(data)-1}/{len(data)}'
                    route.fulfill(status=206, headers=headers, body=data); return
                route.fulfill(status=200, headers=headers, body=data)
            page.route('https://media.example.org/**', media_route)
            page.goto('http://127.0.0.1:8768/video.html')
            page.click('#videoSourceUrl')
            assert page.locator('#videoDrop').is_hidden()
            def check(url):
                page.fill('#videoSourceInput', url)
                page.click('#videoCheckUrl')
                page.wait_for_function("() => !document.querySelector('#videoCheckUrl').disabled")
            check('https://media.example.org/video.mp4')
            assert page.locator('#videoStartBtn').is_enabled()
            assert page.locator('#videoDownloadAudio').is_enabled()
            assert '96p' in page.locator('#videoDownloadQuality').inner_text()
            assert 'есть аудиодорожка' in page.locator('#videoAudioHint').inner_text()
            assert all(method == 'HEAD' or byte_range for _, method, byte_range in requests)
            with page.expect_download() as result:
                page.click('#videoDownloadVideo')
            assert Path(result.value.path()).read_bytes() == media
            count = len(requests)
            with page.expect_download(): page.click('#videoDownloadVideo')
            assert len(requests) == count, 'Repeated action downloaded the source again'
            check('https://media.example.org/silent.mp4')
            assert page.locator('#videoDownloadAudio').is_disabled()
            assert page.locator('#videoStartBtn').is_disabled()
            assert page.locator('#videoDownloadVideo').is_enabled()
            assert 'нет аудиодорожки' in page.locator('#videoAudioHint').inner_text()
            for url, expected in [
                ('https://media.example.org/page', 'прямая ссылка'),
                ('https://media.example.org/forbidden.mp4', '403'),
                ('https://media.example.org/large.mp4', '300 МБ'),
                ('https://media.example.org/blocked.mp4', 'CORS'),
                ('https://youtube.com/watch?v=demo', 'серверный обработчик'),
                ('https://rutube.ru/video/demo', 'серверный обработчик'),
                ('https://vkvideo.ru/video/demo', 'серверный обработчик'),
                ('https://127.0.0.1/video.mp4', 'сетевых адресов'),
                ('https://[::1]/video.mp4', 'сетевых адресов'),
                ('file:///etc/passwd', 'HTTP/HTTPS'),
                ('https://name:secret@example.org/video.mp4', 'логина'),
                ('not a url', 'полную ссылку'),
            ]:
                check(url)
                assert expected in page.locator('#videoError').inner_text(), (url, page.locator('#videoError').inner_text())
                assert page.locator('#videoDownloadVideo').is_disabled()
            # Abort a pending network check, then accept a new source without a stale callback.
            pending = []
            page.route('https://slow.example.org/**', lambda route: pending.append(route))
            page.fill('#videoSourceInput', 'https://slow.example.org/video.mp4')
            page.click('#videoCheckUrl')
            page.click('#videoCancel')
            assert page.locator('#videoStatus').inner_text() == 'ОТМЕНЕНО'
            check('https://media.example.org/video.mp4')
            assert page.locator('#videoStartBtn').is_enabled()
            page.click('#videoSourceFile')
            assert page.locator('#videoStartBtn').is_disabled()
            assert page.locator('#videoAudioPreview').is_hidden()
            assert not errors, errors
            page.set_viewport_size({'width': 390, 'height': 844})
            page.click('#videoSourceUrl')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path='/tmp/speechlab-video-1.1-mobile.png', full_page=True)
            browser.close()
    print('Video URL metadata/download/cache/errors/cancel/mobile: PASS')
finally:
    server.shutdown()
