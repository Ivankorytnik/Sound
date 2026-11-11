from playwright.sync_api import sync_playwright
from pathlib import Path
import http.server, functools, threading
ROOT = Path(__file__).resolve().parent
(ROOT / 'screenshots').mkdir(exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',8766),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 b=p.chromium.launch(args=['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 page=b.new_page(permissions=['microphone'],accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:8766');page.wait_for_selector('#chooseSaveFolderBtn',state='attached')
 print('version',page.locator('#appVersion').inner_text())
 for w,h in [(360,844),(390,844),(768,1024),(1024,768),(1366,768),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(60)
  for mode in ['dictaphone','live','file']:
   page.click('#'+mode+'ModeBtn')
   sizes=page.evaluate('({width:innerWidth,doc:document.documentElement.scrollWidth,height:innerHeight,docHeight:document.documentElement.scrollHeight})')
   assert sizes['doc']<=w, (w,mode,sizes)
   if w>=1200: assert sizes['docHeight']<=h,(w,mode,sizes)
  if w in [390,1366,1920]:
   page.click('#dictaphoneModeBtn');page.screenshot(path=f'{ROOT}/screenshots/speech-{w}x{h}.png',full_page=True)
 print('responsive passed')
 page.set_viewport_size({'width':1366,'height':768})
 rect=page.locator('.output-panel').bounding_box();page.click('#advancedSettings summary');assert page.locator('.output-panel').bounding_box()==rect
 page.fill('#speakerName1','Проверка');page.uncheck('#speakerLabelsToggle');assert page.locator('#speakerConfig').is_hidden();page.check('#speakerLabelsToggle');assert page.input_value('#speakerName1')=='Проверка'
 page.click('#advancedSettings summary')
 page.uncheck('#dictaphoneAutoTranscribeToggle');page.click('#startDictaphoneBtn');page.wait_for_selector('#stopDictaphoneBtn',state='visible');page.wait_for_timeout(1100);page.click('#stopDictaphoneBtn');page.wait_for_selector('#audioPreview',state='visible');assert page.locator('#transcribeBtn').is_enabled()
 with page.expect_download() as d: page.click('#downloadAudioBtn')
 assert d.value.suggested_filename
 page.click('#removeFileBtn');assert page.locator('#transcribeBtn').is_disabled()
 print('recording audio download and remove passed')
 # Test actual UI worker message path with a deterministic worker fixture.
 page.evaluate('''() => {
 window.Worker = class {
 postMessage(msg) { if(msg.type==='cancel')return; window.workerFixture=this;this.job=msg.jobId; }
 terminate(){};
 };
 }''')
 import wave,io
 audio=io.BytesIO()
 with wave.open(audio,'wb') as f: f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(b'\0\0'*32000)
 page.click('#fileModeBtn');page.locator('#fileInput').set_input_files({'name':'Очень длинное имя аудиозаписи '*12+'.wav','mimeType':'audio/wav','buffer':audio.getvalue()})
 assert page.locator('#fileName').get_attribute('title')
 page.click('#transcribeBtn');page.wait_for_function('window.workerFixture !== undefined')
 page.evaluate("workerFixture.onmessage({data:{type:'chunk-progress',index:1,total:2,partialText:'Первый текст',jobId:workerFixture.job}})")
 page.fill('#transcript','Моя правка')
 page.evaluate("workerFixture.onmessage({data:{type:'chunk-progress',index:2,total:2,partialText:'второй фрагмент',jobId:workerFixture.job}})")
 assert page.input_value('#transcript')=='Моя правка второй фрагмент'
 page.evaluate("workerFixture.onmessage({data:{type:'result',output:{text:'Первый текст второй фрагмент',chunks:[{text:'Первый текст',timestamp:[0,1]}]},jobId:workerFixture.job}})")
 assert page.input_value('#transcript')=='Моя правка второй фрагмент'
 page.click('#segmentsViewBtn');assert page.locator('#segmentsList').is_visible();page.click('#textViewBtn');assert page.input_value('#transcript')=='Моя правка второй фрагмент'
 with page.expect_download() as d:page.click('#downloadBtn')
 assert d.value.suggested_filename.endswith('.txt')
 for w,h in [(1366,768),(1920,1080),(390,844)]:
  page.set_viewport_size({'width':w,'height':h});page.screenshot(path=f'{ROOT}/screenshots/result-{w}x{h}.png',full_page=True)
 print('streamed edits views txt passed',errors)
 assert not errors
 b.close()
