import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;
env.useBrowserCache = true;

const pipelines = new Map();
const cancelledJobs = new Set();
const post = (type, payload = {}) => self.postMessage({ type, ...payload });

function normalizeText(text) {
  return String(text || '')
    .replace(/[ \t\u00A0]+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/([,.;:!?])(?=[А-ЯA-ZЁ])/gu, '$1 ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeWord(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/giu, '');
}

function rms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  let count = 0;
  const step = samples.length > 64000 ? 4 : 1;
  for (let i = 0; i < samples.length; i += step) {
    const value = samples[i];
    sum += value * value;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function speechActivity(samples, sampleRate = 16000) {
  if (!samples?.length) return { rms: 0, activeRatio: 0 };
  const frame = Math.max(1, Math.floor(sampleRate * 0.4));
  let active = 0;
  let total = 0;
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let sum = 0;
    for (let i = start; i < end; i += 4) sum += samples[i] * samples[i];
    const count = Math.max(1, Math.ceil((end - start) / 4));
    const frameRms = Math.sqrt(sum / count);
    if (frameRms >= 0.006) active += 1;
    total += 1;
  }
  return { rms: rms(samples), activeRatio: active / Math.max(1, total) };
}

function gentlyNormalize(samples) {
  const level = rms(samples);
  if (!level || level >= 0.028) return samples;
  const gain = Math.min(2.4, 0.065 / Math.max(level, 0.0001));
  if (gain <= 1.05) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = Math.max(-0.98, Math.min(0.98, samples[i] * gain));
  }
  return out;
}

function wordClose(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length < 5 || b.length < 5) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let diff = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) diff += 1;
    if (diff > 1) return false;
  }
  return diff + Math.abs(a.length - b.length) <= 1;
}

function overlapWords(previous, current) {
  const leftRaw = normalizeText(previous).split(/\s+/u).filter(Boolean);
  const rightRaw = normalizeText(current).split(/\s+/u).filter(Boolean);
  const left = leftRaw.map(normalizeWord);
  const right = rightRaw.map(normalizeWord);
  const max = Math.min(22, left.length, right.length);

  for (let size = max; size >= 3; size -= 1) {
    let matches = 0;
    for (let i = 0; i < size; i += 1) {
      if (wordClose(left[left.length - size + i], right[i])) matches += 1;
    }
    const ratio = matches / size;
    const threshold = size >= 8 ? 0.72 : size >= 5 ? 0.8 : 1;
    if (ratio >= threshold) return size;
  }
  return 0;
}

function trimOverlap(previous, current) {
  const clean = normalizeText(current);
  if (!previous || !clean) return clean;
  const count = overlapWords(previous, clean);
  if (!count) return clean;
  return clean.split(/\s+/u).slice(count).join(' ').trim();
}

function suspiciousRepeat(text) {
  const words = normalizeText(text).toLowerCase().split(/\s+/u).map(normalizeWord).filter(Boolean);
  if (words.length < 10) return false;
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  const max = Math.max(...counts.values());
  if (max / words.length > 0.38) return true;
  for (let size = 2; size <= 6; size += 1) {
    const grams = new Map();
    for (let i = 0; i + size <= words.length; i += 1) {
      const gram = words.slice(i, i + size).join(' ');
      grams.set(gram, (grams.get(gram) || 0) + 1);
    }
    const limit = size <= 3 ? 4 : 3;
    if ([...grams.values()].some((value) => value >= limit)) return true;
  }
  return false;
}

function textQualityScore(text, duration, activeRatio) {
  const clean = normalizeText(text);
  const words = clean.split(/\s+/u).map(normalizeWord).filter(Boolean);
  if (!words.length) return -100;
  const unique = new Set(words).size / words.length;
  const cyrillic = (clean.match(/[а-яё]/giu) || []).length;
  const letters = (clean.match(/[a-zа-яё]/giu) || []).length;
  const languageFit = letters ? cyrillic / letters : 0.5;
  const expectedFloor = Math.max(1, Math.floor(duration * Math.max(0.12, activeRatio) * 0.7));
  let score = Math.min(words.length, expectedFloor * 2) + unique * 12 + languageFit * 4;
  if (suspiciousRepeat(clean)) score -= 18;
  if (activeRatio > 0.35 && words.length < Math.min(4, expectedFloor)) score -= 8;
  return score;
}

function candidateList(modelId, preferredDevice, quality) {
  const webgpu = preferredDevice === 'webgpu';
  const explicit = modelId && modelId !== 'auto';
  const turbo = 'onnx-community/whisper-large-v3-turbo';
  const small = 'onnx-community/whisper-small';
  const base = 'onnx-community/whisper-base';
  const tiny = 'onnx-community/whisper-tiny';

  if (explicit) {
    const list = [];
    if (webgpu) list.push({ modelId, device: 'webgpu' });
    if (!modelId.includes('large-v3-turbo')) list.push({ modelId, device: 'wasm' });
    if (modelId.includes('large-v3-turbo')) {
      if (webgpu) list.push({ modelId: small, device: 'webgpu' });
      list.push({ modelId: base, device: 'wasm' });
    }
    return list;
  }

  if (quality === 'fast') {
    return webgpu
      ? [{ modelId: tiny, device: 'webgpu' }, { modelId: tiny, device: 'wasm' }]
      : [{ modelId: tiny, device: 'wasm' }];
  }

  if (quality === 'max') {
    return webgpu
      ? [
          { modelId: turbo, device: 'webgpu' },
          { modelId: small, device: 'webgpu' },
          { modelId: base, device: 'wasm' },
        ]
      : [{ modelId: small, device: 'wasm' }, { modelId: base, device: 'wasm' }];
  }

  if (quality === 'accurate') {
    return webgpu
      ? [{ modelId: small, device: 'webgpu' }, { modelId: base, device: 'wasm' }]
      : [{ modelId: base, device: 'wasm' }];
  }

  if (quality === 'noisy') {
    return webgpu
      ? [{ modelId: small, device: 'webgpu' }, { modelId: base, device: 'wasm' }]
      : [{ modelId: base, device: 'wasm' }];
  }

  return webgpu
    ? [{ modelId: small, device: 'webgpu' }, { modelId: base, device: 'wasm' }]
    : [{ modelId: base, device: 'wasm' }];
}

async function createPipeline(modelId, preferredDevice, quality, jobId) {
  const candidates = candidateList(modelId, preferredDevice, quality);
  let lastError;

  for (const candidate of candidates) {
    const dtype = candidate.device === 'webgpu'
      ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
      : undefined;
    const key = `${candidate.modelId}::${candidate.device}::${dtype ? 'fp32-q4' : 'default'}`;

    if (pipelines.has(key)) {
      post('engine', { jobId, device: candidate.device, modelId: candidate.modelId, cached: true });
      return { transcriber: pipelines.get(key), ...candidate };
    }

    try {
      post('status', {
        jobId,
        stage: 'model',
        message: candidate.device === 'webgpu'
          ? `Загружаю ${candidate.modelId.split('/').pop()} через WebGPU…`
          : `Загружаю ${candidate.modelId.split('/').pop()} в Worker/WASM…`,
      });

      const pipelineOptions = {
        device: candidate.device,
        progress_callback: (data) => {
          if (cancelledJobs.has(jobId)) return;
          if (data?.status === 'progress' && Number.isFinite(data.progress)) {
            post('model-progress', {
              jobId,
              progress: Math.max(0, Math.min(100, data.progress)),
              file: data.file || '',
              device: candidate.device,
              modelId: candidate.modelId,
            });
          }
        },
      };
      if (dtype) pipelineOptions.dtype = dtype;

      const transcriber = await pipeline('automatic-speech-recognition', candidate.modelId, pipelineOptions);
      pipelines.set(key, transcriber);
      post('engine', { jobId, device: candidate.device, modelId: candidate.modelId, cached: false });
      return { transcriber, ...candidate };
    } catch (error) {
      lastError = error;
      post('backend-fallback', {
        jobId,
        from: `${candidate.modelId.split('/').pop()} / ${candidate.device}`,
        message: error?.message || String(error),
      });
    }
  }

  throw lastError || new Error('Не удалось запустить модель распознавания.');
}

function makeSegments(output, offset, duration, text, detailed) {
  if (detailed && Array.isArray(output?.chunks) && output.chunks.length) {
    return output.chunks
      .map((chunk) => {
        const chunkText = normalizeText(chunk?.text);
        const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [0, duration];
        const start = Number.isFinite(timestamp[0]) ? timestamp[0] + offset : offset;
        const end = Number.isFinite(timestamp[1]) ? timestamp[1] + offset : offset + duration;
        return { text: chunkText, timestamp: [start, end] };
      })
      .filter((segment) => segment.text);
  }
  return text ? [{ text, timestamp: [offset, offset + duration] }] : [];
}

async function runChunk(transcriber, audio, language, quality, detailedTimestamps, retry = false) {
  const highAccuracy = quality === 'accurate' || quality === 'max';
  const options = {
    task: 'transcribe',
    return_timestamps: !!detailedTimestamps,
    top_k: 0,
    do_sample: false,
    num_beams: retry ? 3 : highAccuracy ? 2 : 1,
    max_new_tokens: 448,
  };
  if (language && language !== 'auto') options.language = language;
  return transcriber(audio, options);
}

async function transcribeJob(message) {
  const {
    jobId,
    audioBuffer,
    modelId = 'auto',
    preferredDevice,
    language,
    chunkSeconds = 27,
    overlapSeconds = 3,
    useVad = true,
    vadThreshold = 0.0035,
    detailedTimestamps = false,
    cleanup = 'standard',
    quality = 'balanced',
  } = message;

  cancelledJobs.delete(jobId);
  const audio = new Float32Array(audioBuffer);
  const sampleRate = 16000;
  const totalSeconds = audio.length / sampleRate;
  const { transcriber, device, modelId: resolvedModel } = await createPipeline(modelId, preferredDevice, quality, jobId);

  const chunkSamples = Math.max(sampleRate * 8, Math.floor(Math.min(29, chunkSeconds) * sampleRate));
  const overlapSamples = Math.max(0, Math.floor(Math.min(overlapSeconds, chunkSeconds / 4) * sampleRate));
  const stepSamples = Math.max(sampleRate, chunkSamples - overlapSamples);
  const totalChunks = Math.max(1, Math.ceil(Math.max(1, audio.length - overlapSamples) / stepSamples));

  const segments = [];
  const texts = [];
  let previousContext = '';
  let processed = 0;
  let skipped = 0;
  let retried = 0;

  for (let start = 0; start < audio.length; start += stepSamples) {
    if (cancelledJobs.has(jobId)) {
      post('cancelled', { jobId });
      cancelledJobs.delete(jobId);
      return;
    }

    const end = Math.min(audio.length, start + chunkSamples);
    const rawSlice = audio.slice(start, end);
    const duration = rawSlice.length / sampleRate;
    const activity = speechActivity(rawSlice, sampleRate);

    if (useVad && activity.rms < vadThreshold && activity.activeRatio < 0.08) {
      skipped += 1;
      processed += 1;
      post('chunk-progress', {
        jobId, index: processed, total: totalChunks, skipped, retried, device,
        modelId: resolvedModel, startSeconds: start / sampleRate, totalSeconds,
      });
      continue;
    }

    const slice = gentlyNormalize(rawSlice);
    let output = await runChunk(transcriber, slice, language, quality, detailedTimestamps, false);
    let rawText = normalizeText(output?.text);
    let score = textQualityScore(rawText, duration, activity.activeRatio);
    const suspicious = suspiciousRepeat(rawText)
      || (activity.activeRatio > 0.35 && duration > 8 && rawText.split(/\s+/u).filter(Boolean).length < 3);

    if (suspicious && (quality === 'accurate' || quality === 'max' || cleanup === 'strict')) {
      post('quality-check', {
        jobId,
        index: processed + 1,
        total: totalChunks,
        message: 'Перепроверяю сомнительный фрагмент…',
      });
      const retryOutput = await runChunk(transcriber, slice, language, quality, detailedTimestamps, true);
      const retryText = normalizeText(retryOutput?.text);
      const retryScore = textQualityScore(retryText, duration, activity.activeRatio);
      retried += 1;
      if (retryScore > score + 0.5) {
        output = retryOutput;
        rawText = retryText;
        score = retryScore;
      }
    }

    let text = trimOverlap(previousContext, rawText);
    if (cleanup !== 'off' && suspiciousRepeat(text)) {
      if (cleanup === 'strict') text = '[неразборчивая речь / повтор]';
    }

    if (text) {
      const offset = start / sampleRate;
      const chunkSegments = makeSegments(output, offset, duration, text, detailedTimestamps);
      if (chunkSegments.length) {
        chunkSegments[0].text = trimOverlap(previousContext, chunkSegments[0].text);
      }
      for (const segment of chunkSegments) {
        if (segment.text) segments.push(segment);
      }
      texts.push(text);
      previousContext = `${previousContext} ${text}`
        .trim()
        .split(/\s+/u)
        .slice(-42)
        .join(' ');
    }

    processed += 1;
    post('chunk-progress', {
      jobId,
      index: processed,
      total: totalChunks,
      skipped,
      retried,
      device,
      modelId: resolvedModel,
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
      meta: {
        device,
        modelId: resolvedModel,
        totalChunks,
        skipped,
        retried,
        quality,
      },
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
