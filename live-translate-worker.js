import { createResilientTranscriber } from './transcription-runtime.js?build=v1.6.4-20261021-01';
import './live-translate-core.js?build=20261123-speech';

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
    await loadVad();
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

// ---- Voice activity detection (Silero VAD, MIT, ~2 MB ONNX, runs locally) -------------
// Optional: if it cannot load, live translation still works and "speech only" falls back
// to text filtering. Never blocks preparation.
const VAD_WINDOW = 512; // 32 ms at 16 kHz, the window size Silero v5 expects
const VAD_THRESHOLD = 0.35; // lower than the usual 0.5 so quiet or distant voices count
let vad = null;

async function loadVad() {
  try {
    notify('status', { message: 'Загружаю детектор речи (Silero VAD)…' });
    const { AutoModel, Tensor } = await import(
      'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm'
    );
    const model = await AutoModel.from_pretrained('onnx-community/silero-vad', {
      config: { model_type: 'custom' }, dtype: 'fp32', device: 'wasm',
    });
    vad = { model, Tensor };
    const probe = await speechActivity(new Float32Array(16000));
    if (!probe || !Number.isFinite(probe.max)) throw new Error('VAD вернул некорректный результат.');
    notify('vad', { ok: true });
  } catch (error) {
    try { await vad?.model?.dispose?.(); } catch (_) { /* best effort */ }
    vad = null;
    notify('vad', { ok: false, message: String(error?.message || error) });
  }
}

// Seconds of detected speech and peak speech probability for one fragment.
async function speechActivity(audio) {
  if (!vad) return null;
  const { model, Tensor } = vad;
  // Normalise loudness first: the detector should judge "is it a voice", not "is it loud",
  // so quiet participants are not discarded. Gain is capped to avoid inflating hiss.
  let peak = 0;
  for (let i = 0; i < audio.length; i += 1) peak = Math.max(peak, Math.abs(audio[i]));
  const gain = peak > 1e-4 ? Math.min(0.5 / peak, 30) : 1;
  const sr = new Tensor('int64', BigInt64Array.from([16000n]), []);
  let state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  let speechWindows = 0;
  let confidentWindows = 0;
  let sum = 0;
  let max = 0;
  for (let offset = 0; offset + VAD_WINDOW <= audio.length; offset += VAD_WINDOW) {
    const frame = new Float32Array(VAD_WINDOW);
    for (let i = 0; i < VAD_WINDOW; i += 1) frame[i] = audio[offset + i] * gain;
    const output = await model({ input: new Tensor('float32', frame, [1, VAD_WINDOW]), sr, state });
    state = output.stateN;
    const probability = Number(output.output.data[0]);
    if (probability >= VAD_THRESHOLD) { speechWindows += 1; sum += probability; }
    if (probability >= 0.9) confidentWindows += 1;
    if (probability > max) max = probability;
  }
  const seconds = (windows) => Math.round(windows * VAD_WINDOW / 16000 * 100) / 100;
  return {
    speech: seconds(speechWindows),
    confident: seconds(confidentWindows),
    mean: speechWindows ? Math.round(sum / speechWindows * 100) / 100 : 0,
    max: Math.round(max * 100) / 100,
  };
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
  const speechOnly = message.speechOnly !== false;
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
    // Digital silence never needs a model. The gate is unchanged from before, so quiet
    // speech is not affected; the voice detector makes the finer decision.
    if (level(audio) < 0.0015) {
      notify('segment', { session, index, start, end, silent: true });
      return;
    }
    const activity = speechOnly ? await speechActivity(audio) : null;
    if (speechOnly && !core.hasEnoughSpeech(activity)) {
      // No voice: skip Whisper entirely (saves ~2 s CPU and removes hallucinations).
      consecutiveFailures = 0;
      notify('segment', { session, index, start, end, silent: true, filtered: 'vad', vad: activity });
      return;
    }
    const result = await recognizer.transcribe(audio, {
      task: 'transcribe', language: 'english', return_timestamps: false,
      do_sample: false, num_beams: 1, max_length: 224,
    });
    const decision = core.classifyTranscript(result?.text, activity, speechOnly);
    if (!decision.keep) {
      consecutiveFailures = 0;
      notify('segment', {
        session, index, start, end, silent: true,
        filtered: speechOnly ? decision.reason : '', vad: activity, raw: tidy(result?.text),
      });
      return;
    }
    const en = decision.text;
    const ru = await translateSentences(en);
    if (!ru) throw new Error('Модель вернула пустой перевод.');
    consecutiveFailures = 0;
    notify('segment', { session, index, start, end, en, ru, vad: activity });
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
