"""Real Chromium UI, real Whisper weights and synthetic test audio. No user audio."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
import json, os, subprocess, sys, threading, time
root=Path(sys.argv[1]).resolve()
out=Path(os.environ['RUNNER_TEMP'])/'speechlab-report'
out.mkdir(exist_ok=True)
fixture=out/'speech.wav'
phrase='\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043c\u044b \u043f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u043c \u0440\u0430\u0441\u043f\u043e\u0437\u043d\u0430\u0432\u0430\u043d\u0438\u0435 \u0440\u0435\u0447\u0438. \u0417\u0430\u043f\u0438\u0441\u044c \u0434\u043e\u043b\u0436\u043d\u0430 \u043f\u0440\u0435\u0432\u0440\u0430\u0442\u0438\u0442\u044c\u0441\u044f \u0432 \u0442\u0435\u043a\u0441\u0442.'
subprocess.run(['espeak-ng','-v','ru','-s','140','-w',str(fixture),phrase],check=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',8765),partial(Quiet,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
report={'scope':'Real browser, UI, nested Workers, real Whisper Tiny and Base WASM/q8; synthetic Russian speech; no physical GPU or user recording.','results':[],'browser_errors':[],'console_errors':[]}
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--no-sandbox','--disable-gpu'])
        page=browser.new_page(viewport={'width':1440,'height':1100},accept_downloads=True)
        page.add_init_script("Object.defineProperty(navigator,'gpu',{get:()=>undefined,configurable:true})")
        page.on('pageerror',lambda error: report['browser_errors'].append(str(error)))
        page.on('console',lambda msg: report['console_errors'].append(msg.text) if msg.type=='error' else None)
        page.goto('http://127.0.0.1:8765/',wait_until='networkidle',timeout=60000)
        page.wait_for_function("document.querySelector('#appVersion').textContent==='v1.6.3'")
        page.locator('#fileModeBtn').click()
        page.locator('#fileInput').set_input_files(str(fixture))
        language=page.locator('#languageSelect option').evaluate_all("items=>items.find(o=>o.textContent.includes('\u0420\u0443\u0441\u0441'))?.value")
        if language: page.locator('#languageSelect').select_option(language)
        for model,quality in [('tiny','fast'),('base','balanced')]:
            page.locator('#modelSelect').select_option('onnx-community/whisper-'+model)
            page.locator('#qualitySelect').select_option(quality)
            started=time.monotonic()
            page.locator('#transcribeBtn').click()
            page.wait_for_function("['\u0413\u041e\u0422\u041e\u0412\u041e','\u041e\u0428\u0418\u0411\u041a\u0410','\u041e\u0428\u0418\u0411\u041a\u0410 AI'].includes(document.querySelector('#statusText').textContent)",timeout=480000)
            result=page.evaluate("({status:document.querySelector('#statusText').textContent,note:document.querySelector('#statusNote').textContent,text:document.querySelector('#transcript').value,progress:document.querySelector('#progressValue').textContent})")
            result.update(model=model,seconds=round(time.monotonic()-started,2))
            report['results'].append(result)
            print(json.dumps(result,ensure_ascii=False),flush=True)
            page.screenshot(path=str(out/(model+'.png')),full_page=True)
            assert result['status']=='\u0413\u041e\u0422\u041e\u0412\u041e',result
            assert result['progress']=='100%' and len(result['text'].split())>=3,result
        with page.expect_download(timeout=30000) as download:
            page.locator('#downloadBtn').click()
        target=out/'transcript.txt'; download.value.save_as(str(target))
        assert target.read_text().strip()==report['results'][-1]['text'].strip()
        report['txt_export']='passed'
        report['passed']=True
        browser.close()
finally:
    server.shutdown()
    (out/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
