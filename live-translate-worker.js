import { createResilientTranscriber } from './transcription-runtime.js?build=v1.6.4-20261021-01';

let recognizer = null;
let translator = null;
let stage = 'idle';
let processing = false;

const notify = (type, data = {}) => self.postMessage({ type, ...data });
const tidy = (text) => String(text || '').replace(/\s+/gu, ' ').trim();

function level(samples) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples.length; i += 4) {
    sum += samples[i] * samples[i];
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

async function initialize(webgpu) {
  if (stage === 'loading' || stage === 'ready') return;
  stage = 'loading';
  try {
    notify('status', { message: 'Загружаю Whisper Tiny для английской речи…' });
    const tiny = 'onnx-community/whisper-tiny';
    const candidates = webgpu
      ? [{ modelId: tiny, device: 'webgpu' }, { modelId: tiny, device: 'wasm' }]
      : [{ modelId: tiny, device: 'wasm' }];
    recognizer = createResilientTranscriber(candidates, 'live-prewarm', (type, data) => {
      if (type === 'model-progress') {
        notify('status', { message: 'Whisper: ' + (data.file || Math.round(data.progress) + '%') });
      } else if (type === 'backend-fallback') {
        notify('status', { message: data.message });
      } else if (type === 'status') {
        notify('status', { message: data.message });
      }
    });
    // The runtime loads models lazily. A silent warm-up ensures Start means actually ready.
    await recognizer.transcribe(new Float32Array(16000), {
      task: 'transcribe', language: 'english', return_timestamps: false,
      do_sample: false, num_beams: 1, max_length: 96,
    });
    notify('status', { message: 'Загружаю бесплатную локальную модель перевода EN → RU…' });
    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm'
    );
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    translator = await pipeline('translation', 'Xenova/opus-mt-en-ru', {
      device: 'wasm',
      dtype: 'q8',
      progress_callback(event) {
        if (event?.status === 'progress' && Number.isFinite(event.progress)) {
          notify('status', {
            message: 'Модель перевода: ' + Math.round(event.progress) + '%'
              + (event.file ? ' · ' + event.file : ''),
          });
        }
      },
    });
    stage = 'ready';
    notify('ready');
  } catch (error) {
    stage = 'idle';
    recognizer?.close();
    recognizer = null;
    try { await translator?.dispose?.(); } catch (_) { /* best effort */ }
    translator = null;
    notify('failure', { phase: 'init', message: String(error?.message || error) });
  }
}

async function infer(message) {
  const { session, index, start, end, audioBuffer } = message;
  if (stage !== 'ready') {
    notify('failure', { phase: 'infer', session, index, message: 'Сначала загрузи модели.' });
    return;
  }
  if (processing) {
    notify('failure', { phase: 'infer', session, index, message: 'Модель занята; фрагмент пропущен.' });
    return;
  }
  processing = true;
  try {
    if (!(audioBuffer instanceof ArrayBuffer) || !audioBuffer.byteLength ||
        audioBuffer.byteLength > 16000 * 30 * 4 || audioBuffer.byteLength % 4) {
      throw new Error('Некорректный аудиофрагмент.');
    }
    const audio = new Float32Array(audioBuffer);
    if (level(audio) < 0.0015) {
      notify('segment', { session, index, start, end, silent: true });
      return;
    }
    const result = await recognizer.transcribe(audio, {
      task: 'transcribe', language: 'english', return_timestamps: false,
      do_sample: false, num_beams: 1, max_length: 224,
    });
    const en = tidy(result?.text);
    if (!en || /^\[?(music|silence|applause)\]?\.?$/iu.test(en)) {
      notify('segment', { session, index, start, end, silent: true });
      return;
    }
    const translated = await translator(en, { max_new_tokens: 180 });
    const ru = tidy(Array.isArray(translated)
      ? translated[0]?.translation_text
      : translated?.translation_text);
    if (!ru) throw new Error('Модель вернула пустой перевод.');
    notify('segment', { session, index, start, end, en, ru });
  } catch (error) {
    notify('failure', {
      phase: 'infer', session, index,
      message: String(error?.message || error),
    });
  } finally {
    processing = false;
  }
}

self.addEventListener('message', ({ data = {} }) => {
  if (data.type === 'init') void initialize(Boolean(data.webgpu));
  else if (data.type === 'infer') void infer(data);
});
