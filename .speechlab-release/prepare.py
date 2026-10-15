"""Assemble only the six approved release files from hash-checked sources."""
from pathlib import Path
import hashlib, json, re, sys
A = Path(__file__).resolve().parent
R = Path(sys.argv[1]).resolve()
KEY = 'v1.6.3-20261015-02'
OLD = 'v1.6.2-20261013-1115'
SOURCE = {'app-core.js':'de9f06958caa33c0cb5a1833a7807f8ecb022d81','index.html':'44f2ea8fcca70991c0da507a093c9eaea8da8f8b','app.js':'19c77595d8a3a663b0c1758182b7dcf5f50e3fcd','transcription-worker.js':'66e1738e17f34dfb3662a624c04d675e10755d49'}
ASSETS = {'transcription-worker.js':'4f9ba4450c13f22fa80ea7b0d7467235510f133d','transcription-runtime.js':'c2e7ac9522e2e7a5637ccef806073a77b66823fd','transcription-engine.js':'0d58a9c30fed9390b33c56e357a3bf53116594dc','app.js':'dc394cd3246fb4402cd5e975f5a0dbd17286c2a7','decode.js':'9e6953e0b4d653009710615aff541a318352ce08','ui-lifecycle.js':'c8686288256a1c67b1391c377849f51bb4f14604'}
def sha(b): return hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()
def checked(root, items):
    for name, expected in items.items():
        actual=sha((root/name).read_bytes())
        if actual!=expected: raise ValueError(f'{name}: {actual} != reviewed {expected}')
def once(t, old, new):
    if t.count(old)!=1: raise ValueError('Source block is ambiguous or missing')
    return t.replace(old,new,1)
def section(t, begin, end, name, expected):
    start=t.index(begin); stop=t.index(end,start+len(begin))
    old=t[start:stop].rstrip('\n')+'\n'
    if hashlib.sha256(old.encode()).hexdigest()!=expected: raise ValueError(f'{name}: source block changed')
    return once(t,old,(A/name).read_text())
def tag(t, el, ident, value):
    pattern=rf'(<{el}\b[^>]*\bid="{re.escape(ident)}"[^>]*>)[^<]*(</{el}>)'
    out,n=re.subn(pattern,lambda m:m[1]+value+m[2],t)
    if n!=1: raise ValueError(f'Missing HTML #{ident}')
    return out
checked(R,SOURCE);checked(A,ASSETS)
core=(R/'app-core.js').read_text()
core=section(core,'  async function decodeToMono16k(file) {','  function createWorker() {','decode.js','0fb1d20f3f2718a496bf2ce975b275450c219c884693402e1237cf489d071734')
core=section(core,'  async function startTranscription() {','  function renderLiveText(text) {','ui-lifecycle.js','8ce228da7f8b422c9789bfb77fb981b4744441f005406412a71c77b7eefdda5d')
core=once(core,"    version: 'v1.6.2',\n    date: '13.10.2026',\n    time: '11:15',\n    key: 'v1.6.2-20261013-1115',",f"    version: 'v1.6.3',\n    date: '15.10.2026',\n    time: '16:22',\n    key: '{KEY}',")
html=(R/'index.html').read_text()
html=once(html,f'./app.js?build={OLD}',f'./app.js?build={KEY}')
html=tag(html,'strong','appVersion','v1.6.3')
html=tag(html,'small','appBuildTime','15.10.2026 \u00b7 16:22')
html=tag(html,'span','footerBuild','\u0412\u0435\u0440\u0441\u0438\u044f v1.6.3 \u00b7 \u0441\u0431\u043e\u0440\u043a\u0430 15.10.2026 16:22')
files={'app-core.js':core,'index.html':html}
for name in ('app.js','transcription-worker.js','transcription-runtime.js','transcription-engine.js'): files[name]=(A/name).read_text()
for name,text in files.items(): (R/name).write_text(text,encoding='utf-8',newline='\n')
print(json.dumps({'build':KEY,'files':{n:sha((R/n).read_bytes()) for n in files}},indent=2))
