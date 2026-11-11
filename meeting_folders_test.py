"""Check real UI -> worker result -> local folder saves using deterministic handles."""
import functools, http.server, io, threading, wave
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',8777),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
FIXTURE='''() => {
  const missing = () => new DOMException('Missing', 'NotFoundError');
  class Directory {
    constructor(name) { this.name=name; this.dirs=new Map(); this.files=new Map(); }
    async queryPermission() { return 'granted'; }
    async getDirectoryHandle(name,options={}) {
      if(!this.dirs.has(name)) { if(!options.create) throw missing(); this.dirs.set(name,new Directory(name)); }
      return this.dirs.get(name);
    }
    async getFileHandle(name,options={}) {
      if(!this.files.has(name)) { if(!options.create)throw missing(); this.files.set(name,null); }
      return {createWritable:async()=>({write:async blob=>this.files.set(name,blob),close:async()=>{},abort:async()=>{}})};
    }
  }
  window.meetingRoot=new Directory('Встречи');
  window.showDirectoryPicker=async()=>window.meetingRoot;
  window.Worker=class { postMessage(msg) { if(msg.type!=='transcribe')return;this.job=msg.jobId;window.testWorker=this;} terminate(){} };
}'''
audio=io.BytesIO()
with wave.open(audio,'wb') as f:
    f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(b'\0\0'*32000)
with sync_playwright() as p:
    browser=p.chromium.launch(args=['--no-sandbox'])
    for choose_first in [True,False]:
        page=browser.new_page(accept_downloads=True);page.add_init_script(FIXTURE);errors=[];downloads=[]
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('download',lambda d:downloads.append(d))
        page.goto('http://127.0.0.1:8777');page.wait_for_selector('#chooseSaveFolderBtn',state='attached')
        # Works with both compact and the original page layout.
        if choose_first:
            page.locator('#chooseSaveFolderBtn').evaluate('(button)=>button.click()')
            page.wait_for_function("document.querySelector('#chooseSaveFolderBtn').textContent.includes('СМЕНИТЬ')")
        page.click('#fileModeBtn');page.locator('#fileInput').set_input_files({'name':'meeting.wav','mimeType':'audio/wav','buffer':audio.getvalue()})
        page.click('#transcribeBtn');page.wait_for_function('window.testWorker !== undefined')
        page.evaluate("testWorker.onmessage({data:{type:'result',jobId:testWorker.job,output:{text:'Добрый день коллеги. Обсудим лизинг. Лизинг автомобилей, лизинг для таксопарков.',chunks:[]}}})")
        if not choose_first:
            assert page.evaluate('meetingRoot.dirs.size')==0
            assert not downloads
            page.locator('#chooseSaveFolderBtn').evaluate('(button)=>button.click()')
        page.wait_for_function("[...meetingRoot.dirs.values()].some(dir=>dir.files.size===2 && [...dir.files.values()].every(Boolean))")
        data=page.evaluate('''async()=>{
          const [name,dir]=[...meetingRoot.dirs.entries()][0];
          const [txtName,blob]=[...dir.files.entries()].find(([name])=>name.endsWith('.txt'));
          const audio=[...dir.files.entries()].find(([name])=>name.endsWith('.wav'));
          const now=new Date(),date=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
          return {name,txtName,text:await blob.text(),audioName:audio[0],audioBytes:audio[1].size,date};
        }''')
        assert data['name']==f"Лизинг_{data['date']}",data
        assert data['txtName']==data['name']+'.txt'
        assert data['audioName']==data['name']+'.wav'
        assert data['audioBytes']==len(audio.getvalue())
        assert 'Лизинг автомобилей' in data['text']
        page.evaluate('SpeechLabFiles.saveMeeting()')
        assert page.evaluate('[...meetingRoot.dirs.values()][0].files.size')==2
        page.fill('#transcript','Бюджет изменён вручную')
        page.click('#downloadBtn')
        page.wait_for_function("[...meetingRoot.dirs.values()][0].files.size===3")
        assert page.evaluate('meetingRoot.dirs.size')==1
        assert not errors,errors
        page.close()
    browser.close()
server.shutdown()
print('Meeting folders: automatic audio/TXT pair, topic/date, exact bytes, folder selected after ASR, no unsolicited downloads, repeat saves and edited TXT: PASS')
