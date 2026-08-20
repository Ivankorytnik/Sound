import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;
env.useBrowserCache = true;

let activePipeline = null;
let activeKey = '';
const cancelled = new Set();

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function rms(samples) {
  if (!samples?.length) return 0;
  const step = samples.length > 160000 ? 8 : 4;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const x = samples[i];
    sum += x * x;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function repeatedPhraseRatio(text) {
  const words = normalizeText(text).toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length < 10) return 0;
  const grams = new Map();
  for (let i = 0; i <= words.length - 3; i += 1) {
    const gram = words.slice(i, i + 3).join(' ');
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  let repeated = 0;
  for (const count of grams.values()) if (count > 2) repeated += count - 2;
  return repeated / Math.max(1, words.length);
}

function cleanupText(text, level) {
  let out = normalizeText(text);
  if (!out || level === 'off') return out;

  // Схлопываем очевидные последовательные повторы слов и коротких фраз.
  out = out.replace(/\b([\p{L}\p{N}]{1,20})(?:\s+\1){3,}\b/giu, '$1');
  out = out.replace(/\b((?:[\p{L}\p{N}]+\s+){1,4}[\p{L}\p{N}]+)(?:[,.!?;:\-]*\s+\1){2,}/giu, '$1');
  out = normalizeText(out);

  if (level === 'strict' && repeatedPhraseRatio(out) > 0.32) return '[неразборчивая речь / повтор]';
  return out;
}

function overlapWords(previous, current) {
  const a = normalizeText(previous).toLowerCase().split(/\s+/u).filter(Boolean);
  const b = normalizeText(current).toLowerCase().split(/\s+/u).filter(Boolean);
  for (let n = Math.min(8, a.length, b.length); n >= 2; n -= 1) {
    if (a.slice(-n).join(' ') === b.slice(0, n).join(' ')) return n;
  }
  return 0;
}

function trimOverlap(previous, current) {
  const n = overlapWords(previous, current);
  if (!n) return normalizeText(current);
  return normalizeText(current).split(/\s+/u).slice(n).join(' ').trim();
}

async function disposePipeline() {
  if (activePipeline?.dispose) {
    try { await activePipeline.dispose(); } catch { /* ignore */ }
  }
  activePipeline = null;
  activeKey = '';
}

async function getPipeline(modelId, preferredDevice, jobId) {
  const candidates = preferredDevice === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError = null;

  for (const device of candidates) {
    const key = `${modelId}::${device}`;
    if (activePipeline && activeKey === key) {
      post('engine', { jobId, device, modelId, cached: true });
      return { transcriber: activePipeline, device };
    }

    await disposePipeline();
    try {
      post('status', { jobId, stage: 'model', message: device === 'webgpu' ? 'Запускаю Whisper через WebGPU…' : 'Запускаю Whisper через WASM/CPU…' });
      const options = {
        device,
        progress_callback: (data) => {
          if (cancelled.has(jobId)) return;
          if (data?.status === 'progress' && Number.isFinite(data.progress)) {
            post('model-progress', { jobId, progress: Math.max(0, Math.min(100, data.progress)), file: data.file || '', device });
          }
        },
      };
      // Для WebGPU q4-декодер заметно уменьшает размер/нагрузку. На WASM оставляем стабильный дефолт q8.
      if (device === 'webgpu') options.dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };

      activePipeline = await pipeline('automatic-speech-recognition', modelId, options);
      activeKey = key;
      post('engine', { jobId, device, modelId, cached: false });
      return { transcriber: activePipeline, device };
    } catch (error) {
      lastError = error;
      post('backend-fallback', { jobId, from: device, message: error?.message || String(error) });
    }
  }
  throw lastError || new Error('Не удалось запустить Whisper.');
}

function shiftedSegments(output, offset, fallbackDuration, fallbackText, exact) {
  if (!exact) return fallbackText ? [{ text: fallbackText, timestamp: [offset, offset + fallbackDuration] }] : [];
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  if (!chunks.length) return fallbackText ? [{ text: fallbackText, timestamp: [offset, offset + fallbackDuration] }] : [];
  return chunks
    .map((chunk) => {
      const text = normalizeText(chunk?.text);
      const raw = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [0, fallbackDuration];
      const start = Number.isFinite(raw[0]) ? raw[0] + offset : offset;
      const end = Number.isFinite(raw[1]) ? raw[1] + offset : offset + fallbackDuration;
      return { text, timestamp: [start, end] };
    })
    .filter((x) => x.text);
}

async function transcribeJob(message) {
  const {
    jobId,
    audioBuffer,
    modelId,
    preferredDevice,
    language,
    cleanup = 'strict',
    chunkSeconds = 29,
    overlapSeconds = 0,
    returnTimestamps = false,
    useVad = true,
  } = message;

  cancelled.delete(jobId);
  const audio = new Float32Array(audioBuffer);
  const sampleRate = 16000;
  const totalSeconds = audio.length / sampleRate;
  const { transcriber, device } = await getPipeline(modelId, preferredDevice, jobId);

  const chunkSamples = Math.max(sampleRate * 8, Math.floor(chunkSeconds * sampleRate));
  const overlapSamples = Math.max(0, Math.floor(Math.min(overlapSeconds, 1.2) * sampleRate));
  const stepSamples = Math.max(sampleRate, chunkSamples - overlapSamples);
  const totalChunks = Math.max(1, Math.ceil(Math.max(1, audio.length - overlapSamples) / stepSamples));
  const vadThreshold = 0.0025;

  const texts = [];
  const segments = [];
  let previousTail = '';
  let skipped = 0;
  let processed = 0;
  const startedAt = performance.now();

  for (let start = 0; start < audio.length; start += stepSamples) {
    if (cancelled.has(jobId)) {
      post('cancelled', { jobId });
      cancelled.delete(jobId);
      return;
    }

    const end = Math.min(audio.length, start + chunkSamples);
    const slice = audio.subarray(start, end);
    const duration = slice.length / sampleRate;

    if (useVad && rms(slice) < vadThreshold) {
      skipped += 1;
      processed += 1;
    } else {
      const options = {
        task: 'transcribe',
        return_timestamps: returnTimestamps,
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.05,
      };
      if (language && language !== 'auto') options.language = language;

      const output = await transcriber(slice, options);
      let text = cleanupText(output?.text, cleanup);
      text = trimOverlap(previousTail, text);

      if (text && text !== '[неразборчивая речь / повтор]') {
        const offset = start / sampleRate;
        const chunkSegments = shiftedSegments(output, offset, duration, text, returnTimestamps);
        if (chunkSegments.length && previousTail) chunkSegments[0].text = trimOverlap(previousTail, chunkSegments[0].text);
        for (const item of chunkSegments) if (item.text) segments.push(item);
        texts.push(text);
        previousTail = `${previousTail} ${text}`.trim().split(/\s+/u).slice(-20).join(' ');
      } else if (text) {
        segments.push({ text, timestamp: [start / sampleRate, end / sampleRate] });
      }
      processed += 1;
    }

    const elapsed = (performance.now() - startedAt) / 1000;
    const avgPerChunk = elapsed / Math.max(1, processed);
    const remaining = Math.max(0, totalChunks - processed);
    const etaSeconds = avgPerChunk * remaining;
    const audioProcessedSeconds = Math.min(totalSeconds, processed * stepSamples / sampleRate);
    const realtimeFactor = audioProcessedSeconds > 0 ? elapsed / audioProcessedSeconds : null;
    post('chunk-progress', {
      jobId,
      index: processed,
      total: totalChunks,
      skipped,
      device,
      etaSeconds,
      realtimeFactor,
      totalSeconds,
    });
  }

  post('result', {
    jobId,
    output: {
      text: normalizeText(texts.join(' ')),
      chunks: segments,
      meta: { device, modelId, totalChunks, skipped, elapsedSeconds: (performance.now() - startedAt) / 1000 },
    },
  });
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelled.add(message.jobId);
    return;
  }
  if (message.type === 'transcribe') {
    transcribeJob(message).catch((error) => {
      post('error', { jobId: message.jobId, message: error?.message || String(error) || 'Ошибка распознавания.', stack: error?.stack || '' });
    });
  }
});
