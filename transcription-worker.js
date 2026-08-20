import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;
env.useBrowserCache = true;

const pipelines = new Map();
const cancelledJobs = new Set();
const post = (type, payload = {}) => self.postMessage({ type, ...payload });

function normalizeText(text) { return String(text || '').replace(/\s+/gu, ' ').trim(); }
function rms(samples) { if (!samples?.length) return 0; let sum=0,count=0; const step=samples.length>32000?4:1; for(let i=0;i<samples.length;i+=step){sum+=samples[i]*samples[i];count++;} return Math.sqrt(sum/Math.max(1,count)); }
function overlapSimilarity(a,b){const l=normalizeText(a).toLowerCase().split(/\s+/u).filter(Boolean);const r=normalizeText(b).toLowerCase().split(/\s+/u).filter(Boolean);const max=Math.min(12,l.length,r.length);for(let s=max;s>=2;s--){if(l.slice(-s).join(' ')===r.slice(0,s).join(' '))return s;}return 0;}
function trimOverlap(previous,current){const n=overlapSimilarity(previous,current);if(!n)return normalizeText(current);return normalizeText(current).split(/\s+/u).slice(n).join(' ').trim();}

function suspiciousRepeat(text) {
  const words = normalizeText(text).toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length < 10) return false;
  const counts = new Map(); words.forEach(w => counts.set(w,(counts.get(w)||0)+1));
  const max = Math.max(...counts.values());
  if (max / words.length > 0.42) return true;
  for (let size=2; size<=5; size++) {
    const grams = new Map();
    for (let i=0; i+size<=words.length; i++) { const g=words.slice(i,i+size).join(' '); grams.set(g,(grams.get(g)||0)+1); }
    if ([...grams.values()].some(v => v >= 5)) return true;
  }
  return false;
}

async function createPipeline(modelId, preferredDevice, jobId) {
  const candidates = preferredDevice === 'webgpu' ? ['webgpu','wasm'] : ['wasm']; let lastError;
  for (const device of candidates) {
    const key = `${modelId}::${device}`;
    if (pipelines.has(key)) { post('engine',{jobId,device,modelId,cached:true}); return {transcriber:pipelines.get(key),device}; }
    try {
      post('status',{jobId,stage:'model',message:device==='webgpu'?'Запускаю модель через WebGPU…':'Запускаю модель в фоновом Worker…'});
      const transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device,
        progress_callback: (d) => { if (!cancelledJobs.has(jobId) && d?.status==='progress' && Number.isFinite(d.progress)) post('model-progress',{jobId,progress:Math.max(0,Math.min(100,d.progress)),file:d.file||'',device}); },
      });
      pipelines.set(key,transcriber); post('engine',{jobId,device,modelId,cached:false}); return {transcriber,device};
    } catch (e) { lastError=e; post('backend-fallback',{jobId,from:device,message:e?.message||String(e)}); }
  }
  throw lastError || new Error('Не удалось запустить модель распознавания.');
}

function makeSegments(output, offset, duration, text, detailed) {
  if (detailed && Array.isArray(output?.chunks) && output.chunks.length) {
    return output.chunks.map(c => {
      const ts = Array.isArray(c.timestamp) ? c.timestamp : [0,duration];
      return { text: normalizeText(c.text), timestamp: [Number.isFinite(ts[0])?ts[0]+offset:offset, Number.isFinite(ts[1])?ts[1]+offset:offset+duration] };
    }).filter(s => s.text);
  }
  return text ? [{ text, timestamp:[offset, offset+duration] }] : [];
}

async function transcribeJob(m) {
  const {jobId,audioBuffer,modelId,preferredDevice,language,chunkSeconds=28,overlapSeconds=1.5,useVad=true,vadThreshold=.0035,detailedTimestamps=false,cleanup='standard',quality='balanced'} = m;
  cancelledJobs.delete(jobId); const audio = new Float32Array(audioBuffer); const sr=16000; const totalSeconds=audio.length/sr;
  const {transcriber,device}=await createPipeline(modelId,preferredDevice,jobId);
  const chunkSamples=Math.max(sr*8,Math.floor(chunkSeconds*sr)); const overlapSamples=Math.max(0,Math.floor(Math.min(overlapSeconds,chunkSeconds/4)*sr)); const step=Math.max(sr,chunkSamples-overlapSamples); const total=Math.max(1,Math.ceil(Math.max(1,audio.length-overlapSamples)/step));
  const segments=[]; const texts=[]; let previous=''; let processed=0,skipped=0;
  for(let start=0;start<audio.length;start+=step){
    if(cancelledJobs.has(jobId)){post('cancelled',{jobId});cancelledJobs.delete(jobId);return;}
    const end=Math.min(audio.length,start+chunkSamples); const slice=audio.slice(start,end); const duration=slice.length/sr;
    if(useVad && rms(slice)<vadThreshold){skipped++;processed++;post('chunk-progress',{jobId,index:processed,total,skipped,device,startSeconds:start/sr,totalSeconds});continue;}
    const options={task:'transcribe',return_timestamps:!!detailedTimestamps,chunk_length_s:Math.min(30,Math.max(8,Math.ceil(duration))),stride_length_s:0};
    if(language && language!=='auto') options.language=language;
    if(quality==='noisy'){options.no_repeat_ngram_size=3;options.repetition_penalty=1.08;}
    const output=await transcriber(slice,options); let text=normalizeText(output?.text); text=trimOverlap(previous,text);
    if(cleanup!=='off' && suspiciousRepeat(text)) {
      if(cleanup==='strict') text='[неразборчивая речь / повтор]';
    }
    if(text){ const offset=start/sr; const segs=makeSegments(output,offset,duration,text,detailedTimestamps); if(segs.length&&previous)segs[0].text=trimOverlap(previous,segs[0].text); segs.filter(s=>s.text).forEach(s=>segments.push(s)); texts.push(text); previous=`${previous} ${text}`.trim().split(/\s+/u).slice(-28).join(' '); }
    processed++; post('chunk-progress',{jobId,index:processed,total,skipped,device,startSeconds:start/sr,totalSeconds,partialText:text});
  }
  post('result',{jobId,output:{text:normalizeText(texts.join(' ')),chunks:segments,meta:{device,modelId,totalChunks:total,skipped}}});
}

self.addEventListener('message',(event)=>{const m=event.data||{};if(m.type==='cancel'){cancelledJobs.add(m.jobId);return;}if(m.type==='transcribe'){transcribeJob(m).catch(e=>post('error',{jobId:m.jobId,message:e?.message||String(e)||'Ошибка распознавания.',stack:e?.stack||''}));}});
