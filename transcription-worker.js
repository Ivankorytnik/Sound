import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;
env.useBrowserCache = true;

const pipelines = new Map();
let cancelledJobs = new Set();

function post(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function rms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  const step = samples.length > 32000 ? 4 : 1;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const value = samples[i];
    sum += value * value;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/gu, ' ').trim();
}

function overlapSimilarity(a, b) {
  const left = normalizeText(a).toLowerCase().split(/\s+/u).filter(Boolean);
  const right = normalizeText(b).toLowerCase().split(/\s+/u).filter(Boolean);
  const max = Math.min(10, left.length, right.length);
  for (let size = max; size >= 2; size -= 1) {
    if (left.slice(-size).join(' ') === right.slice(0, size).join(' ')) return size;
  }
  return 0;
}

function trimTextOverlap(previous, current) {
  const count = overlapSimilarity(previous, current);
  if (!count) return normalizeText(current);
  const words = normalizeText(current).split(/\s+/u);
  return words.slice(count).join(' ').trim();
}

async function createPipeline(modelId, preferredDevice, jobId) {
  const candidates = preferredDevice === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
  let lastError;

  for (const device of candidates) {
    const key = `${modelId}::${device}`;
    if (pipelines.has(key)) {
      post('engine', { jobId, device, modelId, cached: true });
      return { transcriber: pipelines.get(key), device };
    }

    try {
      post('status', {
        jobId,
        stage: 'model',
        message: device === 'webgpu' ? 'Запускаю модель через WebGPU…' : 'Запускаю модель в фоновом Worker…',
      });

      const transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device,
        progress_callback: (data) => {
          if (cancelledJobs.has(jobId)) return;
          if (data?.status === 'progress' && Number.isFinite(data.progress)) {
            post('model-progress', {
              jobId,
              progress: Math.max(0, Math.min(100, data.progress)),
              file: data.file || '',
              device,
            });
          }
        },
      });

      pipelines.set(key, transcriber);
      post('engine', { jobId, device, modelId, cached: false });
      return { transcriber, device };
    } catch (error) {
      lastError = error;
      post('backend-fallback', {
        jobId,
        from: device,
        message: error?.message || String(error),
      });
    }
  }

  throw lastError || new Error('Не удалось запустить модель распознавания.');
}

function makeSegments(output, offsetSeconds, fallbackDuration, text) {
  const result = [];
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];

  if (chunks.length) {
    for (const chunk of chunks) {
      const chunkText = normalizeText(chunk?.text);
      if (!chunkText) continue;
      const raw = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, fallbackDuration];
      const start = Number.isFinite(raw[0]) ? raw[0] + offsetSeconds : offsetSeconds;
      const end = Number.isFinite(raw[1]) ? raw[1] + offsetSeconds : offsetSeconds + fallbackDuration;
      result.push({ text: chunkText, timestamp: [start, end] });
    }
  } else if (text) {
    result.push({ text, timestamp: [offsetSeconds, offsetSeconds + fallbackDuration] });
  }

  return result;
}

async function transcribeJob(message) {
  const {
    jobId,
    audioBuffer,
    modelId,
    preferredDevice,
    language,
    chunkSeconds = 20,
    overlapSeconds = 0.7,
    useVad = true,
    vadThreshold = 0.0045,
    noisyMode = false,
    cleanupMode = 'standard',
  } = message;

  cancelledJobs.delete(jobId);
  const audio = new Float32Array(audioBuffer);
  const sampleRate = 16000;
  const totalSeconds = audio.length / sampleRate;
  const { transcriber, device } = await createPipeline(modelId, preferredDevice, jobId);

  const chunkSamples = Math.max(sampleRate * 8, Math.floor(chunkSeconds * sampleRate));
  const overlapSamples = Math.max(0, Math.floor(Math.min(overlapSeconds, chunkSeconds / 4) * sampleRate));
  const stepSamples = Math.max(sampleRate, chunkSamples - overlapSamples);
  const totalChunks = Math.max(1, Math.ceil(Math.max(1, audio.length - overlapSamples) / stepSamples));

  const segments = [];
  const texts = [];
  let previousText = '';
  let processed = 0;
  let skipped = 0;

  for (let start = 0, index = 0; start < audio.length; start += stepSamples, index += 1) {
    if (cancelledJobs.has(jobId)) {
      post('cancelled', { jobId });
      cancelledJobs.delete(jobId);
      return;
    }

    const end = Math.min(audio.length, start + chunkSamples);
    const slice = audio.slice(start, end);
    const chunkDuration = slice.length / sampleRate;
    const chunkRms = rms(slice);

    if (useVad && chunkRms < vadThreshold) {
      skipped += 1;
      processed += 1;
      post('chunk-progress', {
        jobId,
        index: processed,
        total: totalChunks,
        skipped,
        device,
        startSeconds: start / sampleRate,
        totalSeconds,
      });
      continue;
    }

    const options = {
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: Math.min(30, Math.max(8, Math.ceil(chunkDuration))),
      stride_length_s: 0,
    };

    // Aggressive repetition constraints are useful for noisy archival audio,
    // but can damage normal conversational speech. Keep them out of clean modes.
    if (noisyMode || cleanupMode === 'strict') {
      options.repetition_penalty = noisyMode ? 1.06 : 1.02;
      if (noisyMode) options.no_repeat_ngram_size = 4;
    }

    if (language && language !== 'auto') options.language = language;

    const output = await transcriber(slice, options);
    let text = normalizeText(output?.text);
    text = trimTextOverlap(previousText, text);

    if (text) {
      const offset = start / sampleRate;
      const chunkSegments = makeSegments(output, offset, chunkDuration, text);
      if (chunkSegments.length && previousText) {
        chunkSegments[0].text = trimTextOverlap(previousText, chunkSegments[0].text);
      }
      for (const segment of chunkSegments) {
        if (segment.text) segments.push(segment);
      }
      texts.push(text);
      previousText = `${previousText} ${text}`.trim().split(/\s+/u).slice(-24).join(' ');
    }

    processed += 1;
    post('chunk-progress', {
      jobId,
      index: processed,
      total: totalChunks,
      skipped,
      device,
      startSeconds: start / sampleRate,
      totalSeconds,
      partialText: text,
    });
  }

  post('result', {
    jobId,
    output: {
      text: normalizeText(texts.join(' ')),
      chunks: segments,
      meta: { device, modelId, totalChunks, skipped },
    },
  });
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelledJobs.add(message.jobId);
    return;
  }
  if (message.type === 'transcribe') {
    transcribeJob(message).catch((error) => {
      post('error', {
        jobId: message.jobId,
        message: error?.message || String(error) || 'Ошибка распознавания.',
        stack: error?.stack || '',
      });
    });
  }
});
