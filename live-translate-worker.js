import { createResilientTranscriber } from './transcription-runtime.js?build=v1.6.4-20261021-01';
import './live-translate-core.js?build=20261123-audit';

const core = self.SpeechLiveCore;
const TINY = 'onnx-community/whisper-tiny';
// A ~6 s live fragment must not block the queue for the 10-minute file-transcription default.
const LIVE_INFERENCE_TIMEOUT_MS = 45 * 1000;
// After this many consecutive failed fragments the session is reported as fatal.
const MAX_CONSECUTIVE_FAILURES = 3;

let recognizer = null;
let translator = null;
let stage = 'idle';
let processing = false;
let consecutiveFailures = 0;

function forwardRecognizerEvent(type, data) {
  if (type === 'model-progress') {
    notify('status', { message: 'Whisper: ' + (data.file || Math.round(data.progress) + '%') });
  } else if (type === 'backend-fallback' || type === 'status') {
    notify('status', { message: data.message });
  }
}

function createRecognizer(candidates) {
  return createResilientTranscriber(candidates, 'live', forwardRecognizerEvent, {
    inferenceTimeoutMs: LIVE_INFERENCE_TIMEOUT_MS,
  });
}

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
    const candidates = webgpu
      ? [{ modelId: TINY, device: 'webgpu' }, { modelId: TINY, device: 'wasm' }]
      : [{ modelId: TINY, device: 'wasm' }];
    recognizer = createRecognizer(candidates);
    consecutiveFailures = 0;
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
    // Loading ONNX weights is not enough: first inference can fail or be broken.
    // Perform an actual English -> Russian translation before enabling capture.
    const probeEnglish = 'We need to discuss the delivery schedule.';
    const failures = [];
    for (const dtype of ['q8', 'q4']) {
      let candidate = null;
      try {
        notify('status', { message: 'Проверка модели перевода (' + dtype + ')…' });
        candidate = await pipeline('translation', 'Xenova/opus-mt-en-ru', {
          device: 'wasm',
          dtype,
          progress_callback(event) {
            if (event?.status === 'progress' && Number.isFinite(event.progress)) {
              notify('status', {
                message: 'Модель перевода (' + dtype + '): ' + Math.round(event.progress) + '%'
                  + (event.file ? ' · ' + event.file : ''),
              });
            }
          },
        });
        const probe = await candidate(probeEnglish, {
          max_new_tokens: 64, num_beams: 1, do_sample: false,
        });
        const probeRussian = tidy(Array.isArray(probe)
          ? probe[0]?.translation_text : probe?.translation_text);
        if (!/[а-яё]/iu.test(probeRussian)) {
          throw new Error('Пробный перевод не содержит русского текста.');
        }
        translator = candidate;
        notify('diagnostic', { en: probeEnglish, ru: probeRussian, model: dtype });
        break;
      } catch (error) {
        failures.push(dtype + ': ' + String(error?.message || error));
        try { await candidate?.dispose?.(); } catch (_) { /* best effort */ }
        if (dtype === 'q8') {
          notify('status', { message: 'Основной формат модели не запустился. Пробую резервный q4…' });
        }
      }
    }
    if (!translator) throw new Error('Не удалось запустить перевод EN → RU. ' + failures.join(' | '));
    stage = 'ready';
    notify('ready');
  } catch (error) {
    stage = 'idle';
    recognizer?.close();
    recognizer = null;
    try { await translator?.dispose?.(); } catch (_) { /* best effort */ }
    translator = null;
    // The shared runtime words its errors for file transcription; give a live-mode action.
    const detail = String(error?.attempts?.at(-1)?.message || error?.message || error);
    notify('failure', {
      phase: 'init',
      message: 'Не удалось запустить локальные AI-модели. Проверь интернет и доступ к '
        + 'cdn.jsdelivr.net и huggingface.co, затем повтори подготовку. Подробности: ' + detail,
    });
  }
}

async function translateSentences(en) {
  const sentences = core.splitSentences(en);
  const parts = [];
  // Sequential on purpose: one sentence at a time keeps peak WASM memory flat.
  for (const sentence of sentences) {
    const output = await translator(sentence, { max_new_tokens: 112, num_beams: 1, do_sample: false });
    const text = tidy(Array.isArray(output) ? output[0]?.translation_text : output?.translation_text);
    if (text) parts.push(text);
  }
  return tidy(parts.join(' '));
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
    if (core.isNonSpeech(result?.text)) {
      consecutiveFailures = 0;
      notify('segment', { session, index, start, end, silent: true });
      return;
    }
    const en = core.stripAnnotations(result?.text);
    const ru = await translateSentences(en);
    if (!ru) throw new Error('Модель вернула пустой перевод.');
    consecutiveFailures = 0;
    notify('segment', { session, index, start, end, en, ru });
  } catch (error) {
    consecutiveFailures += 1;
    // The resilient runtime never reuses a failed backend; once every candidate failed it
    // rejects all later fragments. Rebuild it (WASM, models come from the browser cache)
    // instead of silently dropping the rest of the meeting.
    if (Array.isArray(error?.attempts)) {
      recognizer?.close();
      recognizer = createRecognizer([{ modelId: TINY, device: 'wasm' }]);
    }
    notify('failure', {
      phase: 'infer', session, index,
      fatal: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
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
