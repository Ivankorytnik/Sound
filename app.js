const $ = (selector) => document.querySelector(selector);

const APP_BUILD = Object.freeze({
  version: 'v1.0.0',
  date: '20.08.2026',
  time: '07:31',
  key: 'v1.0.0-20260820-0731',
});

const els = {
  liveModeBtn: $('#liveModeBtn'),
  dictaphoneModeBtn: $('#dictaphoneModeBtn'),
  fileModeBtn: $('#fileModeBtn'),
  liveMode: $('#liveMode'),
  dictaphoneMode: $('#dictaphoneMode'),
  fileMode: $('#fileMode'),
  captureSourceMode: $('#captureSourceMode'),
  captureModeBadge: $('#captureModeBadge'),
  manualModeLabel: $('#manualModeLabel'),
  autoCaptureToggle: $('#autoCaptureToggle'),
  autoModeLabel: $('#autoModeLabel'),
  captureModeHint: $('#captureModeHint'),
  manualSourceWrap: $('#manualSourceWrap'),
  manualSourceSelect: $('#manualSourceSelect'),
  lastSourceRow: $('#lastSourceRow'),
  lastSourceText: $('#lastSourceText'),
  micToggle: $('#micToggle'),
  autoTranscribeToggle: $('#autoTranscribeToggle'),
  speakerLabelsToggle: $('#speakerLabelsToggle'),
  speakerConfig: $('#speakerConfig'),
  mySpeakerName: $('#mySpeakerName'),
  speakerName1: $('#speakerName1'),
  speakerName2: $('#speakerName2'),
  speakerName3: $('#speakerName3'),
  captureStatus: $('#captureStatus'),
  captureStatusText: $('#captureStatusText'),
  recordTimer: $('#recordTimer'),
  systemIndicator: $('#systemIndicator'),
  systemStatus: $('#systemStatus'),
  micIndicator: $('#micIndicator'),
  micStatus: $('#micStatus'),
  startCaptureBtn: $('#startCaptureBtn'),
  startCaptureBtnText: $('#startCaptureBtnText'),
  stopCaptureBtn: $('#stopCaptureBtn'),
  dictaphoneAutoTranscribeToggle: $('#dictaphoneAutoTranscribeToggle'),
  dictaphoneStatus: $('#dictaphoneStatus'),
  dictaphoneStatusText: $('#dictaphoneStatusText'),
  dictaphoneTimer: $('#dictaphoneTimer'),
  dictaphoneMicIndicator: $('#dictaphoneMicIndicator'),
  dictaphoneMicStatus: $('#dictaphoneMicStatus'),
  startDictaphoneBtn: $('#startDictaphoneBtn'),
  stopDictaphoneBtn: $('#stopDictaphoneBtn'),
  fileInput: $('#fileInput'),
  dropzone: $('#dropzone'),
  fileCard: $('#fileCard'),
  fileLabel: $('#fileLabel'),
  fileName: $('#fileName'),
  fileMeta: $('#fileMeta'),
  removeFileBtn: $('#removeFileBtn'),
  audioPreview: $('#audioPreview'),
  downloadAudioBtn: $('#downloadAudioBtn'),
  languageSelect: $('#languageSelect'),
  modelSelect: $('#modelSelect'),
  qualitySelect: $('#qualitySelect'),
  cleanupSelect: $('#cleanupSelect'),
  transcribeBtn: $('#transcribeBtn'),
  transcribeBtnText: $('#transcribeBtnText'),
  progressWrap: $('#progressWrap'),
  progressBar: $('#progressBar'),
  progressValue: $('#progressValue'),
  statusText: $('#statusText'),
  statusNote: $('#statusNote'),
  resultEmpty: $('#resultEmpty'),
  resultBlock: $('#resultBlock'),
  transcript: $('#transcript'),
  wordCount: $('#wordCount'),
  segmentCount: $('#segmentCount'),
  audioDuration: $('#audioDuration'),
  segmentsList: $('#segmentsList'),
  segmentsBox: $('#segmentsBox'),
  copyBtn: $('#copyBtn'),
  downloadExcelBtn: $('#downloadExcelBtn'),
  downloadBtn: $('#downloadBtn'),
  toast: $('#toast'),
  engineHint: $('#engineHint'),
  appVersion: $('#appVersion'),
  appBuildTime: $('#appBuildTime'),
  footerBuild: $('#footerBuild'),
};

const state = {
  mode: 'live',
  selectedFile: null,
  previewUrl: null,
  currentDuration: 0,
  transcribing: false,
  jobId: 0,
  worker: null,
  workerEngine: '',
  workerModel: '',
  heartbeatTimer: null,
  startedAt: 0,
  lastWorkerMessageAt: 0,
  lastOutput: null,
  lastRecordingBlob: null,
  capture: {
    displayStream: null,
    micStream: null,
    audioContext: null,
    recorder: null,
    chunks: [],
    startedAt: 0,
    timer: null,
    finalBlob: null,
  },
  dictaphone: {
    micStream: null,
    recorder: null,
    chunks: [],
    startedAt: 0,
    timer: null,
    finalBlob: null,
  },
};

function showToast(message, type = 'ok') {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle('error', type === 'error');
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setProgress(percent, title, note = '') {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  els.progressWrap?.classList.remove('hidden');
  if (els.progressBar) els.progressBar.style.width = `${value}%`;
  if (els.progressValue) els.progressValue.textContent = `${value}%`;
  if (els.statusText) els.statusText.textContent = title;
  if (els.statusNote) els.statusNote.textContent = note;
}

function setTranscribing(value) {
  state.transcribing = value;
  if (els.fileInput) els.fileInput.disabled = value;
  if (els.languageSelect) els.languageSelect.disabled = value;
  if (els.modelSelect) els.modelSelect.disabled = value;
  if (els.qualitySelect) els.qualitySelect.disabled = value;
  if (els.cleanupSelect) els.cleanupSelect.disabled = value;
  if (els.removeFileBtn) els.removeFileBtn.disabled = value;
  if (els.transcribeBtn) {
    els.transcribeBtn.disabled = !value && !state.selectedFile;
    els.transcribeBtn.classList.toggle('cancel-mode', value);
  }
  if (els.transcribeBtnText) els.transcribeBtnText.textContent = value ? 'ОСТАНОВИТЬ' : 'РАСПОЗНАТЬ РЕЧЬ';
  if (els.startCaptureBtn && !state.capture.recorder) els.startCaptureBtn.disabled = value;
  if (els.startDictaphoneBtn && !state.dictaphone.recorder) els.startDictaphoneBtn.disabled = value;
}

function resetResult() {
  state.lastOutput = null;
  els.resultEmpty?.classList.remove('hidden');
  els.resultBlock?.classList.add('hidden');
  if (els.transcript) els.transcript.value = '';
  if (els.wordCount) els.wordCount.textContent = '0';
  if (els.segmentCount) els.segmentCount.textContent = '0';
  if (els.audioDuration) els.audioDuration.textContent = '—';
  if (els.segmentsList) els.segmentsList.innerHTML = '';
  if (els.segmentsBox) {
    els.segmentsBox.open = false;
    els.segmentsBox.classList.add('hidden');
  }
}

function clearPreviewUrl() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

function clearFile() {
  if (state.transcribing) return;
  state.selectedFile = null;
  state.currentDuration = 0;
  if (els.fileInput) els.fileInput.value = '';
  els.fileCard?.classList.add('hidden');
  els.audioPreview?.classList.add('hidden');
  els.audioPreview?.removeAttribute('src');
  clearPreviewUrl();
  if (els.transcribeBtn) els.transcribeBtn.disabled = true;
  els.progressWrap?.classList.add('hidden');
  els.downloadAudioBtn?.classList.add('hidden');
  state.lastRecordingBlob = null;
  resetResult();
}

function looksLikeMedia(file) {
  if (!file) return false;
  const extOk = /\.(mp3|wav|m4a|aac|ogg|webm|mp4|mpeg|mpga|mov)$/i.test(file.name || '');
  return file.type?.startsWith('audio/') || file.type?.startsWith('video/') || extOk;
}

function selectFile(file, { recording = false, label = '' } = {}) {
  if (!file) return;
  if (!looksLikeMedia(file)) {
    showToast('Нужен аудио- или видеофайл', 'error');
    return;
  }

  state.selectedFile = file;
  state.currentDuration = 0;
  resetResult();
  els.progressWrap?.classList.add('hidden');
  if (els.fileLabel) els.fileLabel.textContent = label || (recording ? 'ЛОКАЛЬНАЯ ЗАПИСЬ' : 'ФАЙЛ');
  if (els.fileName) els.fileName.textContent = file.name || 'recording.webm';
  if (els.fileMeta) els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
  els.fileCard?.classList.remove('hidden');
  if (els.transcribeBtn) els.transcribeBtn.disabled = false;

  clearPreviewUrl();
  state.previewUrl = URL.createObjectURL(file);
  if (els.audioPreview) {
    els.audioPreview.src = state.previewUrl;
    els.audioPreview.classList.remove('hidden');
  }
  if (recording) els.downloadAudioBtn?.classList.remove('hidden');
}

function updateMode(mode) {
  state.mode = mode;
  const live = mode === 'live';
  const dictaphone = mode === 'dictaphone';
  const file = mode === 'file';
  els.liveMode?.classList.toggle('hidden', !live);
  els.dictaphoneMode?.classList.toggle('hidden', !dictaphone);
  els.fileMode?.classList.toggle('hidden', !file);
  els.liveModeBtn?.classList.toggle('active', live);
  els.dictaphoneModeBtn?.classList.toggle('active', dictaphone);
  els.fileModeBtn?.classList.toggle('active', file);
  els.liveModeBtn?.setAttribute('aria-selected', String(live));
  els.dictaphoneModeBtn?.setAttribute('aria-selected', String(dictaphone));
  els.fileModeBtn?.setAttribute('aria-selected', String(file));
}

function hasWebGPU() {
  return Boolean(navigator.gpu) && !/Firefox/i.test(navigator.userAgent);
}

function resolveModel() {
  const selected = els.modelSelect?.value || 'auto';
  if (selected !== 'auto') return selected;

  // WebGPU can comfortably handle Base for normal use. On CPU/WASM, long files
  // automatically switch to Tiny to avoid hour-long jobs.
  if (hasWebGPU()) return 'onnx-community/whisper-base';
  if (state.currentDuration > 20 * 60) return 'onnx-community/whisper-tiny';
  return 'onnx-community/whisper-base';
}

function modelLabel(modelId) {
  if (/small/i.test(modelId)) return 'Whisper Small';
  if (/tiny/i.test(modelId)) return 'Whisper Tiny';
  return 'Whisper Base';
}

function qualityOptions() {
  const quality = els.qualitySelect?.value || 'accurate';
  if (quality === 'noisy') {
    return { chunkSeconds: 14, overlapSeconds: 0.8, useVad: true, vadThreshold: 0.0032 };
  }
  if (quality === 'fast') {
    return { chunkSeconds: 26, overlapSeconds: 0.35, useVad: false, vadThreshold: 0 };
  }
  return { chunkSeconds: 20, overlapSeconds: 0.65, useVad: true, vadThreshold: 0.0040 };
}

async function decodeToMono16k(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineAudioContextClass) {
    throw new Error('Браузер не поддерживает обработку аудио. Используй актуальный Chrome или Edge.');
  }

  const audioContext = new AudioContextClass();
  try {
    setProgress(4, 'Читаю аудио', 'Декодирование выполняется системным аудиодвижком браузера.');
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    state.currentDuration = decoded.duration;

    const targetRate = 16000;
    const targetLength = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContextClass(1, targetLength, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);

    setProgress(9, 'Готовлю звук', '16 кГц mono · без тяжёлого JavaScript-цикла в интерфейсе.');
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } catch (error) {
    console.error(error);
    throw new Error('Не удалось прочитать аудиодорожку. Попробуй MP3, WAV, M4A или WEBM.');
  } finally {
    await audioContext.close().catch(() => {});
  }
}

function createWorker() {
  if (state.worker) return state.worker;
  const worker = new Worker(`./transcription-worker.js?build=${encodeURIComponent(APP_BUILD.key)}`, { type: 'module' });
  state.worker = worker;
  return worker;
}

function terminateWorker() {
  if (state.worker) state.worker.terminate();
  state.worker = null;
  state.workerEngine = '';
  state.workerModel = '';
}

function startHeartbeat() {
  clearInterval(state.heartbeatTimer);
  state.startedAt = Date.now();
  state.lastWorkerMessageAt = Date.now();
  state.heartbeatTimer = setInterval(() => {
    if (!state.transcribing) return;
    const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
    const quiet = Math.round((Date.now() - state.lastWorkerMessageAt) / 1000);
    if (quiet >= 5 && els.statusNote) {
      const engine = state.workerEngine ? ` · ${state.workerEngine}` : '';
      els.statusNote.textContent = `Работаю в фоновом потоке${engine} · прошло ${formatTime(elapsed)}. Интерфейс можно прокручивать — вкладка не зависла.`;
    }
  }, 1000);
}

function stopHeartbeat() {
  clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/gu, ' ').trim();
}

function collapseRepeatedWords(text, strict = false) {
  const words = normalizeText(text).split(/\s+/u).filter(Boolean);
  if (!words.length) return '';

  const normalized = words.map((w) => w.toLowerCase().replace(/[.,!?;:«»"'()\[\]—–-]/gu, ''));
  const unique = new Set(normalized.filter(Boolean));
  if (strict && words.length >= 14 && unique.size / Math.max(1, words.length) < 0.18) {
    return '[неразборчивая речь / повтор]';
  }

  const out = [];
  let previous = '';
  let sameCount = 0;
  for (let i = 0; i < words.length; i += 1) {
    const key = normalized[i];
    if (key && key === previous) sameCount += 1;
    else {
      previous = key;
      sameCount = 1;
    }
    if (sameCount <= (strict ? 1 : 2)) out.push(words[i]);
  }

  // Collapse obvious repeated short phrases: "привет конечно" x 10, etc.
  let tokens = out;
  for (let size = 1; size <= 5; size += 1) {
    const next = [];
    for (let i = 0; i < tokens.length;) {
      const phrase = tokens.slice(i, i + size);
      if (phrase.length < size) {
        next.push(...phrase);
        break;
      }
      const key = phrase.map((w) => w.toLowerCase().replace(/\W/gu, '')).join('|');
      let repeats = 1;
      while (i + (repeats + 1) * size <= tokens.length) {
        const other = tokens.slice(i + repeats * size, i + (repeats + 1) * size)
          .map((w) => w.toLowerCase().replace(/\W/gu, '')).join('|');
        if (other !== key) break;
        repeats += 1;
      }
      next.push(...phrase);
      i += Math.max(1, repeats) * size;
    }
    tokens = next;
  }

  return normalizeText(tokens.join(' '));
}

function cleanOutput(output) {
  const cleanup = els.cleanupSelect?.value || 'standard';
  if (cleanup === 'off') return output;
  const strict = cleanup === 'strict';
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const cleanedChunks = chunks.map((chunk) => ({
    ...chunk,
    text: collapseRepeatedWords(chunk.text, strict),
  })).filter((chunk) => chunk.text);

  const text = cleanedChunks.length
    ? cleanedChunks.map((chunk) => chunk.text).join(' ')
    : collapseRepeatedWords(output?.text || '', strict);

  return { ...output, text: normalizeText(text), chunks: cleanedChunks };
}

function renderSegments(chunks = []) {
  if (!els.segmentsList || !els.segmentsBox) return;
  els.segmentsList.innerHTML = '';
  if (!Array.isArray(chunks) || chunks.length === 0) {
    els.segmentsBox.classList.add('hidden');
    return;
  }
  els.segmentsBox.classList.remove('hidden');

  for (const chunk of chunks) {
    const row = document.createElement('div');
    row.className = 'segment';
    const time = document.createElement('div');
    time.className = 'segment-time';
    const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] : null;
    const end = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] : null;
    time.textContent = `${formatTime(start)}${Number.isFinite(end) ? `–${formatTime(end)}` : ''}`;
    const text = document.createElement('div');
    text.className = 'segment-text';
    text.textContent = normalizeText(chunk.text);
    row.append(time, text);
    els.segmentsList.append(row);
  }
}

function renderResult(rawOutput) {
  const output = cleanOutput(rawOutput || {});
  const text = normalizeText(output.text);
  const chunks = Array.isArray(output.chunks) ? output.chunks : [];
  state.lastOutput = output;
  if (els.transcript) els.transcript.value = text;
  const words = text ? text.split(/\s+/u).filter(Boolean).length : 0;
  if (els.wordCount) els.wordCount.textContent = String(words);
  if (els.segmentCount) els.segmentCount.textContent = String(chunks.length);
  if (els.audioDuration) els.audioDuration.textContent = formatTime(state.currentDuration);
  renderSegments(chunks);
  els.resultEmpty?.classList.add('hidden');
  els.resultBlock?.classList.remove('hidden');
}

function workerPromise(payload, transfer) {
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    const jobId = payload.jobId;

    const onMessage = (event) => {
      const message = event.data || {};
      if (message.jobId !== jobId) return;
      state.lastWorkerMessageAt = Date.now();

      if (message.type === 'model-progress') {
        const mapped = 12 + (message.progress * 0.35);
        setProgress(mapped, 'Загружаю AI-модель', message.file ? `Модель: ${message.file}` : 'Первый запуск может занять время; затем модель останется в кэше браузера.');
      } else if (message.type === 'engine') {
        state.workerEngine = message.device === 'webgpu' ? 'WebGPU' : 'Worker / WASM';
        state.workerModel = message.modelId || '';
        const cached = message.cached ? ' · модель уже в памяти' : '';
        setProgress(50, 'AI готов', `${state.workerEngine} · ${modelLabel(message.modelId)}${cached}`);
      } else if (message.type === 'backend-fallback') {
        if (message.from === 'webgpu') {
          state.workerEngine = 'Worker / WASM';
          setProgress(25, 'WebGPU недоступен', 'Автоматически переключаюсь на фоновый WASM. Интерфейс останется отзывчивым.');
        }
      } else if (message.type === 'chunk-progress') {
        const ratio = message.total ? message.index / message.total : 0;
        const mapped = 52 + ratio * 44;
        const skipText = message.skipped ? ` · пропущено тишины: ${message.skipped}` : '';
        setProgress(mapped, `Распознаю фрагмент ${message.index} из ${message.total}`, `${state.workerEngine || 'Worker'}${skipText} · обработано примерно ${formatTime(message.startSeconds || 0)} из ${formatTime(message.totalSeconds || state.currentDuration)}`);
      } else if (message.type === 'result') {
        cleanup();
        resolve(message.output || {});
      } else if (message.type === 'cancelled') {
        cleanup();
        reject(new DOMException('Распознавание остановлено', 'AbortError'));
      } else if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message || 'Ошибка распознавания.'));
      }
    };

    const onError = (event) => {
      cleanup();
      reject(new Error(event.message || 'Ошибка фонового Worker.'));
    };

    function cleanup() {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(payload, transfer);
  });
}

async function transcribe() {
  if (state.transcribing) {
    cancelTranscription();
    return;
  }
  if (!state.selectedFile) return;

  setTranscribing(true);
  resetResult();
  startHeartbeat();
  const jobId = ++state.jobId;

  try {
    setProgress(2, 'Подготовка', 'Тяжёлая AI-обработка будет вынесена из интерфейса в отдельный Worker.');
    const audio = await decodeToMono16k(state.selectedFile);
    if (jobId !== state.jobId) throw new DOMException('Остановлено', 'AbortError');

    const modelId = resolveModel();
    const preferredDevice = hasWebGPU() ? 'webgpu' : 'wasm';
    const q = qualityOptions();
    const autoSelected = els.modelSelect?.value === 'auto';
    const reason = autoSelected && /tiny/i.test(modelId)
      ? 'Длинная запись на CPU: автоматически выбран Tiny, чтобы не ждать слишком долго.'
      : `${modelLabel(modelId)} · ${preferredDevice === 'webgpu' ? 'пытаюсь использовать WebGPU' : 'фоновый CPU/WASM'}.`;

    setProgress(11, 'Запускаю AI', `${formatTime(state.currentDuration)} · ${reason}`);

    const output = await workerPromise({
      type: 'transcribe',
      jobId,
      audioBuffer: audio.buffer,
      modelId,
      preferredDevice,
      language: els.languageSelect?.value || 'auto',
      ...q,
    }, [audio.buffer]);

    if (jobId !== state.jobId) throw new DOMException('Остановлено', 'AbortError');
    renderResult(output);
    setProgress(100, 'Готово', `${state.workerEngine || 'Worker'} · интерфейс оставался свободным во время распознавания.`);
    showToast('Распознавание завершено');
  } catch (error) {
    if (error?.name === 'AbortError') {
      setProgress(0, 'Остановлено', 'Распознавание отменено пользователем.');
      showToast('Распознавание остановлено');
    } else {
      console.error(error);
      const message = error?.message || 'Не удалось распознать файл.';
      setProgress(0, 'Ошибка', message);
      showToast(message, 'error');
    }
  } finally {
    if (jobId === state.jobId) setTranscribing(false);
    stopHeartbeat();
  }
}

function cancelTranscription() {
  if (!state.transcribing) return;
  state.jobId += 1;
  terminateWorker();
  setTranscribing(false);
  stopHeartbeat();
  setProgress(0, 'Остановлено', 'Фоновый AI-процесс остановлен.');
}

async function copyTranscript() {
  const text = els.transcript?.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  try {
    await navigator.clipboard.writeText(text);
    showToast('Текст скопирован');
  } catch {
    els.transcript.focus();
    els.transcript.select();
    document.execCommand('copy');
    showToast('Текст скопирован');
  }
}

function safeBaseName() {
  return (state.selectedFile?.name || 'transcript')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_')
    .slice(0, 80) || 'transcript';
}

function downloadTranscript() {
  const text = els.transcript?.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeBaseName()}_transcript.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function fallbackExcelCsv(text) {
  const lines = [
    ['Поле', 'Значение'],
    ['Источник', state.selectedFile?.name || 'Диктофон'],
    ['Длительность', formatTime(state.currentDuration)],
    ['Слов', text.split(/\s+/u).filter(Boolean).length],
    ['Текст', text],
  ];
  const csv = '\ufeff' + lines.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeBaseName()}_transcript_excel.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

let excelJsPromise = null;

function loadExcelJs() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (excelJsPromise) return excelJsPromise;
  excelJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error('ExcelJS не загрузился'));
    script.onerror = () => reject(new Error('Не удалось загрузить модуль Excel'));
    document.head.appendChild(script);
  }).catch((error) => {
    excelJsPromise = null;
    throw error;
  });
  return excelJsPromise;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadExcelWithSheetJs(text) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    ['Параметр', 'Значение'],
    ['Источник', state.selectedFile?.name || 'Диктофон'],
    ['Длительность', formatTime(state.currentDuration)],
    ['Количество слов', text.split(/\s+/u).filter(Boolean).length],
    ['Версия Speech Lab', APP_BUILD.version],
    ['Сборка', `${APP_BUILD.date} ${APP_BUILD.time}`],
    ['Дата выгрузки', new Date().toLocaleString('ru-RU')],
    [],
    ['Распознанный текст'],
    [text],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 22 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Текст');

  const chunks = Array.isArray(state.lastOutput?.chunks) ? state.lastOutput.chunks : [];
  const segmentRows = chunks.map((chunk, index) => {
    const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] : '';
    const end = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] : '';
    const speaker = chunk.speakerName || chunk.speaker || chunk.label || '';
    return {
      '№': index + 1,
      'Начало': Number.isFinite(start) ? formatTime(start) : '',
      'Конец': Number.isFinite(end) ? formatTime(end) : '',
      'Говорящий': speaker,
      'Реплика': normalizeText(chunk.text),
    };
  });
  const segmentsSheet = segmentRows.length
    ? XLSX.utils.json_to_sheet(segmentRows)
    : XLSX.utils.aoa_to_sheet([['№', 'Начало', 'Конец', 'Говорящий', 'Реплика'], ['', '', '', '', text]]);
  segmentsSheet['!cols'] = [{ wch: 7 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, segmentsSheet, 'Сегменты');
  XLSX.writeFile(workbook, `${safeBaseName()}_transcript.xlsx`, { compression: true });
}

async function downloadExcel() {
  const text = els.transcript?.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');

  try {
    showToast('Готовлю Excel…');
    const ExcelJS = await loadExcelJs();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Speech Lab';
    workbook.created = new Date();
    workbook.modified = new Date();

    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    const headerFont = { name: 'Arial', bold: true, color: { argb: 'FF000000' } };
    const bodyFont = { name: 'Arial', color: { argb: 'FF000000' } };
    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      left: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      bottom: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      right: { style: 'thin', color: { argb: 'FFB7B7B7' } },
    };

    const summary = workbook.addWorksheet('Текст', { views: [{ state: 'frozen', ySplit: 1 }] });
    summary.columns = [{ width: 24 }, { width: 105 }];
    const summaryRows = [
      ['Параметр', 'Значение'],
      ['Источник', state.selectedFile?.name || 'Диктофон'],
      ['Длительность', formatTime(state.currentDuration)],
      ['Количество слов', text.split(/\s+/u).filter(Boolean).length],
      ['Версия Speech Lab', APP_BUILD.version],
      ['Сборка', `${APP_BUILD.date} ${APP_BUILD.time}`],
      ['Дата выгрузки', new Date().toLocaleString('ru-RU')],
      [],
      ['Распознанный текст', ''],
      ['', text],
    ];
    summary.addRows(summaryRows);
    summary.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = bodyFont;
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });
    [1, 9].forEach((rowNumber) => {
      const row = summary.getRow(rowNumber);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.border = thinBorder;
      });
    });
    summary.getRow(10).height = 90;

    const segments = workbook.addWorksheet('Сегменты', { views: [{ state: 'frozen', ySplit: 1 }] });
    segments.columns = [
      { header: '№', key: 'num', width: 7 },
      { header: 'Начало', key: 'start', width: 13 },
      { header: 'Конец', key: 'end', width: 13 },
      { header: 'Говорящий', key: 'speaker', width: 22 },
      { header: 'Реплика', key: 'text', width: 90 },
    ];
    const chunks = Array.isArray(state.lastOutput?.chunks) ? state.lastOutput.chunks : [];
    if (chunks.length) {
      chunks.forEach((chunk, index) => {
        const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] : '';
        const end = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] : '';
        segments.addRow({
          num: index + 1,
          start: Number.isFinite(start) ? formatTime(start) : '',
          end: Number.isFinite(end) ? formatTime(end) : '',
          speaker: chunk.speakerName || chunk.speaker || chunk.label || '',
          text: normalizeText(chunk.text),
        });
      });
    } else {
      segments.addRow({ num: 1, start: '', end: '', speaker: '', text });
    }
    segments.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = rowNumber === 1 ? headerFont : bodyFont;
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = thinBorder;
        if (rowNumber === 1) cell.fill = headerFill;
      });
    });
    segments.autoFilter = 'A1:E1';

    const buffer = await workbook.xlsx.writeBuffer();
    saveBlob(
      new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${safeBaseName()}_transcript.xlsx`,
    );
    showToast('Excel-файл скачан');
  } catch (styledError) {
    console.warn('Styled XLSX export fallback:', styledError);
    try {
      await downloadExcelWithSheetJs(text);
      showToast('Excel-файл скачан');
    } catch (xlsxError) {
      console.warn('XLSX export fallback:', xlsxError);
      fallbackExcelCsv(text);
      showToast('XLSX недоступен — сохранён Excel-совместимый CSV');
    }
  }
}

function downloadRecording() {
  const blob = state.lastRecordingBlob || state.capture.finalBlob || state.dictaphone.finalBlob;
  if (!blob) return showToast('Записи пока нет', 'error');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `speech-lab_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function updateAutoCaptureUi() {
  const auto = Boolean(els.autoCaptureToggle?.checked);
  els.manualSourceWrap?.classList.toggle('hidden', auto);
  if (els.captureModeBadge) els.captureModeBadge.textContent = auto ? 'AUTO' : 'MANUAL';
  if (els.captureModeHint) {
    els.captureModeHint.textContent = auto
      ? 'АВТО: использую тип последнего источника и начну запись сразу после обязательного подтверждения браузера.'
      : 'РУЧНОЙ: выбери, какой тип источника браузеру предложить первым.';
  }
  if (els.startCaptureBtnText) els.startCaptureBtnText.textContent = auto ? 'НАЙТИ И НАЧАТЬ' : 'ВЫБРАТЬ И НАЧАТЬ';
}

function sourceLabel(value) {
  if (value === 'window') return 'окно приложения';
  if (value === 'monitor') return 'экран';
  return 'вкладка браузера';
}

function getPreferredSurface() {
  if (!els.autoCaptureToggle?.checked) return els.manualSourceSelect?.value || 'browser';
  return localStorage.getItem('speech-lab-last-surface') || 'browser';
}

function stopMediaStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function updateCaptureTimer() {
  const seconds = (Date.now() - state.capture.startedAt) / 1000;
  if (els.recordTimer) els.recordTimer.textContent = formatTime(seconds);
}

function chooseRecorderMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return types.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

async function startCapture() {
  if (state.dictaphone.recorder) return showToast('Сначала останови диктофон', 'error');
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
    return showToast('Для живого захвата нужен актуальный Chrome или Edge по HTTPS.', 'error');
  }

  const surface = getPreferredSurface();
  const constraints = {
    video: { displaySurface: surface },
    audio: true,
    preferCurrentTab: surface === 'browser',
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
    surfaceSwitching: 'include',
  };

  try {
    if (els.captureStatusText) els.captureStatusText.textContent = 'ВЫБЕРИ ИСТОЧНИК В ОКНЕ БРАУЗЕРА';
    const displayStream = await navigator.mediaDevices.getDisplayMedia(constraints);
    const displayAudio = displayStream.getAudioTracks();
    if (!displayAudio.length) {
      stopMediaStream(displayStream);
      throw new Error('У выбранного источника нет аудиодорожки. Выбери вкладку встречи и включи «Поделиться аудио».');
    }

    let micStream = null;
    if (els.micToggle?.checked) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      } catch (error) {
        console.warn('Microphone unavailable:', error);
      }
    }

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    const systemSource = audioContext.createMediaStreamSource(new MediaStream(displayAudio));
    systemSource.connect(destination);
    if (micStream?.getAudioTracks().length) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
    }

    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
    state.capture.displayStream = displayStream;
    state.capture.micStream = micStream;
    state.capture.audioContext = audioContext;
    state.capture.recorder = recorder;
    state.capture.chunks = [];
    state.capture.startedAt = Date.now();
    state.capture.finalBlob = null;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) state.capture.chunks.push(event.data);
    });
    recorder.addEventListener('stop', finishCaptureRecording, { once: true });
    recorder.start(1000);

    const actualSurface = displayStream.getVideoTracks()[0]?.getSettings?.().displaySurface || surface;
    localStorage.setItem('speech-lab-last-surface', actualSurface);
    if (els.lastSourceText) els.lastSourceText.textContent = sourceLabel(actualSurface);

    if (els.captureStatusText) els.captureStatusText.textContent = 'ИДЁТ ЛОКАЛЬНАЯ ЗАПИСЬ';
    els.captureStatus?.classList.remove('idle');
    els.captureStatus?.classList.add('recording');
    els.systemIndicator?.classList.add('active');
    if (els.systemStatus) els.systemStatus.textContent = 'Звук встречи: подключён';
    els.micIndicator?.classList.toggle('active', Boolean(micStream?.getAudioTracks().length));
    if (els.micStatus) els.micStatus.textContent = micStream?.getAudioTracks().length ? 'Микрофон: подключён' : 'Микрофон: выключен';
    els.startCaptureBtn?.classList.add('hidden');
    els.stopCaptureBtn?.classList.remove('hidden');
    state.capture.timer = setInterval(updateCaptureTimer, 500);
    updateCaptureTimer();

    displayStream.getVideoTracks()[0]?.addEventListener('ended', () => stopCapture(), { once: true });
  } catch (error) {
    console.error(error);
    const message = error?.name === 'NotAllowedError'
      ? 'Захват отменён или не разрешён браузером.'
      : (error?.message || 'Не удалось начать захват.');
    if (els.captureStatusText) els.captureStatusText.textContent = 'ГОТОВ К ЗАХВАТУ';
    showToast(message, 'error');
  }
}

function stopCapture() {
  const recorder = state.capture.recorder;
  if (!recorder) return;
  clearInterval(state.capture.timer);
  state.capture.timer = null;
  if (recorder.state !== 'inactive') recorder.stop();
  stopMediaStream(state.capture.displayStream);
  stopMediaStream(state.capture.micStream);
}

async function finishCaptureRecording() {
  const type = state.capture.recorder?.mimeType || 'audio/webm';
  const blob = new Blob(state.capture.chunks, { type });
  state.capture.finalBlob = blob;
  state.lastRecordingBlob = blob;
  state.capture.chunks = [];
  await state.capture.audioContext?.close().catch(() => {});
  state.capture.audioContext = null;
  state.capture.recorder = null;
  state.capture.displayStream = null;
  state.capture.micStream = null;

  els.captureStatus?.classList.remove('recording');
  els.captureStatus?.classList.add('idle');
  if (els.captureStatusText) els.captureStatusText.textContent = 'ЗАПИСЬ ГОТОВА';
  els.systemIndicator?.classList.remove('active');
  els.micIndicator?.classList.remove('active');
  if (els.systemStatus) els.systemStatus.textContent = 'Звук встречи: отключён';
  if (els.micStatus) els.micStatus.textContent = 'Микрофон: отключён';
  els.stopCaptureBtn?.classList.add('hidden');
  els.startCaptureBtn?.classList.remove('hidden');

  const file = new File([blob], `meeting_${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
  selectFile(file, { recording: true, label: 'ЗАПИСЬ ВСТРЕЧИ' });
  state.lastRecordingBlob = blob;
  showToast('Локальная запись готова');

  if (els.autoTranscribeToggle?.checked) {
    transcribe();
  }
}

function updateDictaphoneTimer() {
  const seconds = (Date.now() - state.dictaphone.startedAt) / 1000;
  if (els.dictaphoneTimer) els.dictaphoneTimer.textContent = formatTime(seconds);
}

async function startDictaphone() {
  if (state.capture.recorder) return showToast('Сначала останови захват встречи', 'error');
  if (state.transcribing) return showToast('Сначала останови распознавание', 'error');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showToast('Диктофон требует актуальный Chrome/Edge и HTTPS.', 'error');
  }

  try {
    if (els.dictaphoneStatusText) els.dictaphoneStatusText.textContent = 'ЗАПРАШИВАЮ МИКРОФОН';
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    const mimeType = chooseRecorderMimeType();
    const recorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined);
    state.dictaphone.micStream = micStream;
    state.dictaphone.recorder = recorder;
    state.dictaphone.chunks = [];
    state.dictaphone.startedAt = Date.now();
    state.dictaphone.finalBlob = null;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) state.dictaphone.chunks.push(event.data);
    });
    recorder.addEventListener('stop', finishDictaphoneRecording, { once: true });
    recorder.start(1000);

    els.dictaphoneStatus?.classList.remove('idle');
    els.dictaphoneStatus?.classList.add('recording');
    if (els.dictaphoneStatusText) els.dictaphoneStatusText.textContent = 'ИДЁТ ЗАПИСЬ';
    els.dictaphoneMicIndicator?.classList.add('active');
    if (els.dictaphoneMicStatus) els.dictaphoneMicStatus.textContent = 'Микрофон: подключён';
    els.startDictaphoneBtn?.classList.add('hidden');
    els.stopDictaphoneBtn?.classList.remove('hidden');
    state.dictaphone.timer = setInterval(updateDictaphoneTimer, 500);
    updateDictaphoneTimer();
  } catch (error) {
    console.error(error);
    const message = error?.name === 'NotAllowedError'
      ? 'Доступ к микрофону не разрешён.'
      : (error?.message || 'Не удалось включить диктофон.');
    if (els.dictaphoneStatusText) els.dictaphoneStatusText.textContent = 'ГОТОВ К ЗАПИСИ';
    showToast(message, 'error');
  }
}

function stopDictaphone() {
  const recorder = state.dictaphone.recorder;
  if (!recorder) return;
  clearInterval(state.dictaphone.timer);
  state.dictaphone.timer = null;
  if (recorder.state !== 'inactive') recorder.stop();
  stopMediaStream(state.dictaphone.micStream);
}

async function finishDictaphoneRecording() {
  const type = state.dictaphone.recorder?.mimeType || 'audio/webm';
  const blob = new Blob(state.dictaphone.chunks, { type });
  state.dictaphone.finalBlob = blob;
  state.lastRecordingBlob = blob;
  state.dictaphone.chunks = [];
  state.dictaphone.recorder = null;
  state.dictaphone.micStream = null;

  els.dictaphoneStatus?.classList.remove('recording');
  els.dictaphoneStatus?.classList.add('idle');
  if (els.dictaphoneStatusText) els.dictaphoneStatusText.textContent = 'ЗАПИСЬ ГОТОВА';
  if (els.dictaphoneTimer) els.dictaphoneTimer.textContent = formatTime((Date.now() - state.dictaphone.startedAt) / 1000);
  els.dictaphoneMicIndicator?.classList.remove('active');
  if (els.dictaphoneMicStatus) els.dictaphoneMicStatus.textContent = 'Микрофон: отключён';
  els.stopDictaphoneBtn?.classList.add('hidden');
  els.startDictaphoneBtn?.classList.remove('hidden');

  const file = new File([blob], `dictaphone_${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
  selectFile(file, { recording: true, label: 'ДИКТОФОН' });
  state.lastRecordingBlob = blob;
  showToast('Запись диктофона готова');

  if (els.dictaphoneAutoTranscribeToggle?.checked) {
    transcribe();
  }
}

function renderBuildInfo() {
  if (els.appVersion) els.appVersion.textContent = APP_BUILD.version;
  if (els.appBuildTime) els.appBuildTime.textContent = `${APP_BUILD.date} · ${APP_BUILD.time}`;
  if (els.footerBuild) els.footerBuild.textContent = `Версия ${APP_BUILD.version} · сборка ${APP_BUILD.date} ${APP_BUILD.time}`;
}

function initPersistentUi() {
  renderBuildInfo();
  const last = localStorage.getItem('speech-lab-last-surface');
  if (els.lastSourceText) els.lastSourceText.textContent = last ? sourceLabel(last) : 'ещё не выбран';
  updateAutoCaptureUi();
  if (els.speakerLabelsToggle && els.speakerConfig) {
    els.speakerConfig.classList.toggle('hidden', !els.speakerLabelsToggle.checked);
  }
  if (els.engineHint) {
    els.engineHint.textContent = hasWebGPU()
      ? 'Ускорение: WebGPU доступен. AI работает в отдельном Worker.'
      : 'AI работает в отдельном Worker. Для длинных записей режим «Авто» сам выберет более лёгкую модель.';
  }
}

els.liveModeBtn?.addEventListener('click', () => updateMode('live'));
els.dictaphoneModeBtn?.addEventListener('click', () => updateMode('dictaphone'));
els.fileModeBtn?.addEventListener('click', () => updateMode('file'));
els.fileInput?.addEventListener('change', (event) => selectFile(event.target.files?.[0]));
els.removeFileBtn?.addEventListener('click', clearFile);
els.transcribeBtn?.addEventListener('click', transcribe);
els.copyBtn?.addEventListener('click', copyTranscript);
els.downloadExcelBtn?.addEventListener('click', downloadExcel);
els.downloadBtn?.addEventListener('click', downloadTranscript);
els.downloadAudioBtn?.addEventListener('click', downloadRecording);
els.autoCaptureToggle?.addEventListener('change', updateAutoCaptureUi);
els.startCaptureBtn?.addEventListener('click', startCapture);
els.stopCaptureBtn?.addEventListener('click', stopCapture);
els.startDictaphoneBtn?.addEventListener('click', startDictaphone);
els.stopDictaphoneBtn?.addEventListener('click', stopDictaphone);
els.speakerLabelsToggle?.addEventListener('change', () => {
  els.speakerConfig?.classList.toggle('hidden', !els.speakerLabelsToggle.checked);
});

for (const type of ['dragenter', 'dragover']) {
  els.dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    if (!state.transcribing) els.dropzone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  els.dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('dragging');
  });
}
els.dropzone?.addEventListener('drop', (event) => {
  if (state.transcribing) return;
  selectFile(event.dataTransfer?.files?.[0]);
});

els.audioPreview?.addEventListener('loadedmetadata', () => {
  if (!Number.isFinite(els.audioPreview.duration)) return;
  state.currentDuration = els.audioPreview.duration;
  if (els.fileMeta) {
    els.fileMeta.textContent = `${formatBytes(state.selectedFile?.size || 0)} · ${formatTime(state.currentDuration)} · ${state.selectedFile?.type || 'медиафайл'}`;
  }
});

els.transcript?.addEventListener('input', () => {
  const text = els.transcript.value.trim();
  if (els.wordCount) els.wordCount.textContent = String(text ? text.split(/\s+/u).filter(Boolean).length : 0);
});

window.addEventListener('beforeunload', () => {
  terminateWorker();
  stopMediaStream(state.capture.displayStream);
  stopMediaStream(state.capture.micStream);
  stopMediaStream(state.dictaphone.micStream);
});

initPersistentUi();
updateMode('live');
