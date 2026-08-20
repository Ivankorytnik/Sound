const BUILD = {
  version: 'v1.2.0',
  displayTime: '20.08.2026 · 08:09',
  id: 'v1.2.0-20260820-0809',
};

const els = Object.fromEntries([
  'fileInput','dropzone','fileCard','fileLabel','fileName','fileMeta','removeFileBtn','audioPreview','downloadAudioBtn',
  'languageSelect','modelSelect','qualitySelect','cleanupSelect','engineHint','transcribeBtn','transcribeBtnText',
  'progressWrap','progressBar','progressValue','statusText','statusNote','resultEmpty','resultBlock','transcript',
  'wordCount','segmentCount','audioDuration','segmentsList','segmentsBox','copyBtn','downloadBtn','downloadExcelBtn','toast',
  'liveModeBtn','dictaphoneModeBtn','fileModeBtn','liveMode','dictaphoneMode','fileMode',
  'autoCaptureToggle','captureModeBadge','captureModeHint','manualSourceWrap','manualSourceSelect','lastSourceText',
  'micToggle','autoTranscribeToggle','speakerLabelsToggle','speakerConfig','mySpeakerName','speakerName1','speakerName2','speakerName3',
  'captureStatus','captureStatusText','recordTimer','systemIndicator','systemStatus','micIndicator','micStatus',
  'startCaptureBtn','startCaptureBtnText','stopCaptureBtn',
  'dictaphoneAutoTranscribeToggle','dictaphoneStatus','dictaphoneStatusText','dictaphoneTimer','dictaphoneMicIndicator','dictaphoneMicStatus',
  'startDictaphoneBtn','stopDictaphoneBtn','appVersion','appBuildTime','footerBuild','buildBadge',
].map((id) => [id, document.getElementById(id)]));

const state = {
  mode: 'live',
  selectedFile: null,
  previewUrl: null,
  recordedBlob: null,
  recordedName: '',
  currentDuration: 0,
  busy: false,
  worker: null,
  jobId: 0,
  jobStartedAt: 0,
  activeProfile: null,
  output: { text: '', chunks: [] },
  dictaphone: null,
  live: null,
};

function showToast(message, type = 'ok') {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle('error', type === 'error');
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `≈ ${Math.max(1, Math.round(seconds))} сек`;
  const min = Math.ceil(seconds / 60);
  return `≈ ${min} мин`;
}

function setProgress(percent, title, note = '') {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  els.progressWrap?.classList.remove('hidden');
  if (els.progressBar) els.progressBar.style.width = `${value}%`;
  if (els.progressValue) els.progressValue.textContent = `${value}%`;
  if (els.statusText) els.statusText.textContent = title;
  if (els.statusNote) els.statusNote.textContent = note;
}

function setBusy(value) {
  state.busy = value;
  if (els.transcribeBtn) els.transcribeBtn.disabled = !state.selectedFile && !value;
  for (const control of [els.fileInput, els.languageSelect, els.modelSelect, els.qualitySelect, els.cleanupSelect, els.removeFileBtn]) {
    if (control) control.disabled = value;
  }
  if (els.transcribeBtnText) els.transcribeBtnText.textContent = value ? 'ОСТАНОВИТЬ' : 'РАСПОЗНАТЬ РЕЧЬ';
}

function resetResult() {
  state.output = { text: '', chunks: [] };
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

function safeBaseName(name = 'transcript') {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').slice(0, 80) || 'transcript';
}

function looksLikeMedia(file) {
  return !!file && (file.type?.startsWith('audio/') || file.type?.startsWith('video/') || /\.(mp3|wav|m4a|aac|ogg|webm|mp4|mpeg|mpga)$/i.test(file.name || ''));
}

function revokePreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

function setMediaFile(file, label = 'ФАЙЛ', recordedBlob = null) {
  if (!looksLikeMedia(file)) {
    showToast('Нужен аудио- или видеофайл', 'error');
    return;
  }
  state.selectedFile = file;
  state.recordedBlob = recordedBlob;
  state.recordedName = file.name;
  state.currentDuration = 0;
  resetResult();

  if (els.fileLabel) els.fileLabel.textContent = label.toUpperCase();
  if (els.fileName) els.fileName.textContent = file.name;
  if (els.fileMeta) els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
  els.fileCard?.classList.remove('hidden');
  if (els.transcribeBtn) els.transcribeBtn.disabled = false;

  revokePreview();
  state.previewUrl = URL.createObjectURL(file);
  if (els.audioPreview) {
    els.audioPreview.src = state.previewUrl;
    els.audioPreview.classList.remove('hidden');
  }
  els.downloadAudioBtn?.classList.toggle('hidden', !recordedBlob);
}

function clearFile() {
  if (state.busy) return;
  state.selectedFile = null;
  state.recordedBlob = null;
  state.recordedName = '';
  state.currentDuration = 0;
  if (els.fileInput) els.fileInput.value = '';
  els.fileCard?.classList.add('hidden');
  els.audioPreview?.classList.add('hidden');
  els.audioPreview?.removeAttribute('src');
  els.downloadAudioBtn?.classList.add('hidden');
  revokePreview();
  if (els.transcribeBtn) els.transcribeBtn.disabled = true;
  els.progressWrap?.classList.add('hidden');
  resetResult();
}

function renderSegments(chunks = []) {
  if (!els.segmentsList || !els.segmentsBox) return;
  els.segmentsList.innerHTML = '';
  if (!Array.isArray(chunks) || !chunks.length) {
    els.segmentsBox.classList.add('hidden');
    return;
  }
  els.segmentsBox.classList.remove('hidden');
  for (const chunk of chunks) {
    const row = document.createElement('div');
    row.className = 'segment';
    const time = document.createElement('div');
    time.className = 'segment-time';
    const [start, end] = Array.isArray(chunk.timestamp) ? chunk.timestamp : [null, null];
    time.textContent = `${formatTime(start)}${Number.isFinite(end) ? `–${formatTime(end)}` : ''}`;
    const text = document.createElement('div');
    text.className = 'segment-text';
    const speaker = chunk.speaker ? `${chunk.speaker}: ` : '';
    text.textContent = `${speaker}${String(chunk.text || '').trim()}`;
    row.append(time, text);
    els.segmentsList.append(row);
  }
}

function renderResult(output) {
  const text = String(output?.text || '').trim();
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  state.output = { ...output, text, chunks };
  if (els.transcript) els.transcript.value = text;
  const words = text ? text.split(/\s+/u).filter(Boolean).length : 0;
  if (els.wordCount) els.wordCount.textContent = String(words);
  if (els.segmentCount) els.segmentCount.textContent = String(chunks.length);
  if (els.audioDuration) els.audioDuration.textContent = formatTime(state.currentDuration);
  renderSegments(chunks);
  els.resultEmpty?.classList.add('hidden');
  els.resultBlock?.classList.remove('hidden');
}

async function decodeToMono16k(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineAudioContextClass) throw new Error('Браузер не поддерживает Web Audio API.');

  setProgress(3, 'Читаю аудио', 'Декодирование выполняет встроенный аудиодвижок браузера.');
  const context = new AudioContextClass();
  let decoded;
  try {
    const arrayBuffer = await file.arrayBuffer();
    decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    state.currentDuration = decoded.duration;
  } catch (error) {
    throw new Error('Не удалось открыть аудио. Попробуй MP3, WAV, M4A или WEBM.');
  } finally {
    await context.close().catch(() => {});
  }

  setProgress(7, 'Подготавливаю аудио', `${formatTime(decoded.duration)} · ресэмплинг 16 кГц без тяжёлого JS-цикла`);
  const targetRate = 16000;
  const targetLength = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContextClass(1, targetLength, targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  source.disconnect();
  // Не делаем ещё одну копию 16 kHz массива: на 20–60 минутных файлах
  // это десятки/сотни мегабайт лишней памяти и заметный риск зависания вкладки.
  const samples = rendered.getChannelData(0);
  return samples;
}

function hasWebGPU() {
  return !!navigator.gpu;
}

function resolveProfile() {
  const duration = state.currentDuration || 0;
  const requestedQuality = els.qualitySelect?.value || 'auto';
  const requestedModel = els.modelSelect?.value || 'auto';
  const gpu = hasWebGPU();

  // v1.2: AUTO больше не ухудшает длинные чистые записи до Tiny.
  // Баланс — основной режим для обычных разговоров любой разумной длины.
  let mode = requestedQuality === 'auto' ? 'balanced' : requestedQuality;
  if (!['fast', 'balanced', 'accurate', 'noisy'].includes(mode)) mode = 'balanced';

  let modelId = requestedModel;
  if (modelId === 'auto') {
    modelId = mode === 'fast'
      ? 'onnx-community/whisper-tiny'
      : 'onnx-community/whisper-base';
  }

  // Если пользователь сам выбрал Small — не подменяем модель молча.
  // Только предупреждаем: на CPU длинная запись действительно может идти долго.
  if (!gpu && duration >= 8 * 60 && modelId.includes('whisper-small')) {
    showToast('Whisper Small на CPU будет заметно медленнее Base');
  }

  const profiles = {
    fast: {
      chunkSeconds: 29,
      overlapSeconds: 0,
      returnTimestamps: false,
      useVad: true,
    },
    balanced: {
      chunkSeconds: 28,
      overlapSeconds: 1.5,
      returnTimestamps: false,
      useVad: true,
    },
    accurate: {
      chunkSeconds: 25,
      overlapSeconds: 2.0,
      returnTimestamps: true,
      useVad: true,
    },
    noisy: {
      chunkSeconds: 18,
      overlapSeconds: 1.0,
      returnTimestamps: true,
      useVad: true,
    },
  };

  return {
    mode,
    modelId,
    preferredDevice: gpu ? 'webgpu' : 'wasm',
    language: els.languageSelect?.value || 'russian',
    cleanup: els.cleanupSelect?.value || 'strict',
    ...profiles[mode],
  };
}

function ensureWorker() {
  if (state.worker) return state.worker;
  const worker = new Worker(`./transcription-worker.js?build=${encodeURIComponent(BUILD.id)}`, { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (event) => {
    console.error(event);
    failJob('Ошибка фонового AI Worker. Обнови страницу и попробуй ещё раз.');
  });
  state.worker = worker;
  return worker;
}

function terminateWorker() {
  if (state.worker) state.worker.terminate();
  state.worker = null;
}

function handleWorkerMessage(event) {
  const msg = event.data || {};
  if (msg.jobId !== state.jobId) return;

  if (msg.type === 'status') {
    setProgress(10, msg.message || 'Готовлю AI-модель', 'Интерфейс работает отдельно — вкладка не должна зависать.');
    return;
  }
  if (msg.type === 'model-progress') {
    const mapped = 10 + Math.round((msg.progress || 0) * 0.18);
    setProgress(mapped, 'Загружаю AI-модель', msg.file ? `Модель: ${msg.file}` : 'Первый запуск дольше; затем модель берётся из кэша.');
    return;
  }
  if (msg.type === 'engine') {
    const modelName = msg.modelId?.includes('tiny') ? 'Whisper Tiny' : msg.modelId?.includes('base') ? 'Whisper Base' : 'Whisper';
    const deviceName = msg.device === 'webgpu' ? 'WebGPU' : 'WASM/CPU';
    if (els.engineHint) els.engineHint.textContent = `${({ fast: 'БЫСТРО', balanced: 'БАЛАНС', accurate: 'ТОЧНО', noisy: 'ШУМ' })[state.activeProfile?.mode] || 'AI'} · ${modelName} · ${deviceName} · фоновый Worker`;
    setProgress(29, 'Модель готова', `${modelName} · ${deviceName}. Начинаю распознавание.`);
    return;
  }
  if (msg.type === 'backend-fallback') {
    if (els.engineHint) els.engineHint.textContent = 'WebGPU не запустился — переключаюсь на WASM/CPU.';
    return;
  }
  if (msg.type === 'chunk-progress') {
    const fraction = msg.total ? msg.index / msg.total : 0;
    const percent = 30 + fraction * 68;
    const eta = formatEta(msg.etaSeconds);
    const speed = Number.isFinite(msg.realtimeFactor) ? ` · ${msg.realtimeFactor.toFixed(2)}× от длительности` : '';
    const skipped = msg.skipped ? ` · пропущено тишины: ${msg.skipped}` : '';
    setProgress(percent, `Распознаю: ${msg.index} из ${msg.total}`, `${eta}${speed}${skipped}`.replace(/^ · /, ''));
    return;
  }
  if (msg.type === 'partial') {
    // Показываем уже распознанный текст во время обработки, не дожидаясь конца файла.
    renderResult({ text: msg.text || '', chunks: msg.chunks || [] });
    return;
  }
  if (msg.type === 'result') {
    setProgress(100, 'Готово', `Обработка заняла ${formatTime((performance.now() - state.jobStartedAt) / 1000)}.`);
    renderResult(msg.output || {});
    setBusy(false);
    showToast('Распознавание завершено');
    return;
  }
  if (msg.type === 'cancelled') {
    setProgress(0, 'Остановлено', 'Распознавание отменено.');
    setBusy(false);
    return;
  }
  if (msg.type === 'error') {
    console.error(msg.message, msg.stack || '');
    failJob(msg.message || 'Ошибка распознавания.');
  }
}

function failJob(message) {
  setProgress(0, 'Ошибка', message);
  setBusy(false);
  showToast(message, 'error');
}

async function startTranscription() {
  if (!state.selectedFile) return;
  if (state.busy) {
    stopTranscription();
    return;
  }

  setBusy(true);
  resetResult();
  state.jobId += 1;
  const jobId = state.jobId;
  state.jobStartedAt = performance.now();

  try {
    const audio = await decodeToMono16k(state.selectedFile);
    if (jobId !== state.jobId || !state.busy) return;
    const profile = resolveProfile();
    state.activeProfile = profile;

    const modelName = profile.modelId.includes('tiny') ? 'Tiny' : profile.modelId.includes('base') ? 'Base' : 'Small';
    const device = profile.preferredDevice === 'webgpu' ? 'WebGPU' : 'CPU/WASM';
    if (els.engineHint) els.engineHint.textContent = `${({ fast: 'БЫСТРО', balanced: 'БАЛАНС', accurate: 'ТОЧНО', noisy: 'ШУМ' })[profile.mode] || profile.mode.toUpperCase()} · Whisper ${modelName} · ${device} · Worker`;
    setProgress(9, 'Передаю аудио в Worker', `${formatTime(state.currentDuration)} · ${modelName} · ${profile.returnTimestamps ? 'точные таймкоды' : `таймкоды по блокам · перекрытие ${profile.overlapSeconds} сек`}`);

    const worker = ensureWorker();
    worker.postMessage({
      type: 'transcribe',
      jobId,
      audioBuffer: audio.buffer,
      ...profile,
    }, [audio.buffer]);
  } catch (error) {
    console.error(error);
    failJob(error?.message || 'Не удалось подготовить аудио.');
  }
}

function stopTranscription() {
  if (!state.busy) return;
  state.jobId += 1;
  terminateWorker();
  setBusy(false);
  setProgress(0, 'Остановлено', 'Фоновый Worker остановлен. Можно запустить снова.');
}

async function copyTranscript() {
  const text = els.transcript?.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.transcript.focus();
    els.transcript.select();
    document.execCommand('copy');
  }
  showToast('Текст скопирован');
}

function downloadText() {
  const text = els.transcript?.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, `${safeBaseName(state.selectedFile?.name)}_transcript.txt`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let xlsxModulePromise = null;
async function loadXlsx() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  }
  return xlsxModulePromise;
}

async function downloadExcel() {
  const text = els.transcript?.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  try {
    showToast('Готовлю Excel…');
    const XLSX = await loadXlsx();
    const metaRows = [
      ['Параметр', 'Значение'],
      ['Версия', BUILD.version],
      ['Сборка', BUILD.displayTime],
      ['Источник', state.selectedFile?.name || '—'],
      ['Длительность', formatTime(state.currentDuration)],
      ['Модель', state.activeProfile?.modelId || '—'],
      ['Режим', state.activeProfile?.mode || '—'],
      [],
      ['Распознанный текст', text],
    ];
    const segmentRows = [['Начало', 'Конец', 'Говорящий', 'Текст']];
    for (const item of state.output.chunks || []) {
      const [start, end] = item.timestamp || [];
      segmentRows.push([formatTime(start), formatTime(end), item.speaker || '', item.text || '']);
    }

    const wb = XLSX.utils.book_new();
    const wsText = XLSX.utils.aoa_to_sheet(metaRows);
    const wsSegments = XLSX.utils.aoa_to_sheet(segmentRows);
    wsText['!cols'] = [{ wch: 22 }, { wch: 120 }];
    wsSegments['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsText, 'Текст');
    XLSX.utils.book_append_sheet(wb, wsSegments, 'Сегменты');
    XLSX.writeFile(wb, `${safeBaseName(state.selectedFile?.name)}_transcript.xlsx`);
    showToast('Excel сохранён');
  } catch (error) {
    console.error(error);
    showToast('Не удалось создать Excel. Проверь интернет для загрузки библиотеки.', 'error');
  }
}

function updateWordCount() {
  const text = els.transcript?.value.trim() || '';
  if (els.wordCount) els.wordCount.textContent = String(text ? text.split(/\s+/u).filter(Boolean).length : 0);
}

function switchMode(mode) {
  state.mode = mode;
  for (const name of ['live', 'dictaphone', 'file']) {
    els[`${name}Mode`]?.classList.toggle('hidden', name !== mode);
    const btn = els[`${name}ModeBtn`];
    btn?.classList.toggle('active', name === mode);
    btn?.setAttribute('aria-selected', String(name === mode));
  }
}

function makeRecorder(stream, onStop) {
  const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) chunks.push(event.data);
  });
  recorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    onStop(blob);
  }, { once: true });
  return recorder;
}

function startTimer(target, startedAt) {
  const tick = () => {
    if (target) target.textContent = formatTime((Date.now() - startedAt) / 1000);
  };
  tick();
  return setInterval(tick, 500);
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function startDictaphone() {
  if (state.dictaphone) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const startedAt = Date.now();
    const recorder = makeRecorder(stream, async (blob) => {
      stopStream(stream);
      clearInterval(state.dictaphone?.timer);
      state.dictaphone = null;
      els.startDictaphoneBtn?.classList.remove('hidden');
      els.stopDictaphoneBtn?.classList.add('hidden');
      els.dictaphoneStatus?.classList.remove('recording');
      if (els.dictaphoneStatusText) els.dictaphoneStatusText.textContent = 'ЗАПИСЬ ГОТОВА';
      if (els.dictaphoneMicStatus) els.dictaphoneMicStatus.textContent = 'Микрофон: запись завершена';
      els.dictaphoneMicIndicator?.classList.remove('active');
      const file = new File([blob], `dictaphone_${Date.now()}.webm`, { type: blob.type });
      setMediaFile(file, 'ДИКТОФОН', blob);
      if (els.dictaphoneAutoTranscribeToggle?.checked) await startTranscription();
    });
    state.dictaphone = { stream, recorder, timer: startTimer(els.dictaphoneTimer, startedAt) };
    recorder.start(1000);
    els.startDictaphoneBtn?.classList.add('hidden');
    els.stopDictaphoneBtn?.classList.remove('hidden');
    els.dictaphoneStatus?.classList.add('recording');
    if (els.dictaphoneStatusText) els.dictaphoneStatusText.textContent = 'ИДЁТ ЗАПИСЬ';
    if (els.dictaphoneMicStatus) els.dictaphoneMicStatus.textContent = 'Микрофон: подключён';
    els.dictaphoneMicIndicator?.classList.add('active');
  } catch (error) {
    showToast('Не удалось получить доступ к микрофону', 'error');
  }
}

function stopDictaphone() {
  if (state.dictaphone?.recorder?.state === 'recording') state.dictaphone.recorder.stop();
}

function updateCaptureModeUI() {
  const auto = !!els.autoCaptureToggle?.checked;
  if (els.captureModeBadge) els.captureModeBadge.textContent = auto ? 'AUTO' : 'MANUAL';
  els.manualSourceWrap?.classList.toggle('hidden', auto);
  if (els.startCaptureBtnText) els.startCaptureBtnText.textContent = auto ? 'НАЙТИ И НАЧАТЬ' : 'ВЫБРАТЬ И НАЧАТЬ';
  if (els.captureModeHint) els.captureModeHint.textContent = auto
    ? 'АВТО: браузер предложит подходящий источник. После системного подтверждения запись начнётся сразу.'
    : 'РУЧНОЙ: выбери тип источника, затем подтверди конкретную вкладку/окно в системном окне браузера.';
}

async function startLiveCapture() {
  if (state.live) return;
  try {
    const auto = !!els.autoCaptureToggle?.checked;
    const requested = auto ? (localStorage.getItem('speechlab-last-source') || 'browser') : (els.manualSourceSelect?.value || 'browser');
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      preferCurrentTab: requested === 'browser',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
    });
    const audioTracks = displayStream.getAudioTracks();
    if (!audioTracks.length) {
      stopStream(displayStream);
      throw new Error('В выбранном источнике нет аудио. Выбери вкладку/окно и включи «Поделиться аудио».');
    }
    const displaySettings = displayStream.getVideoTracks()[0]?.getSettings?.() || {};
    const surface = displaySettings.displaySurface || requested;
    localStorage.setItem('speechlab-last-source', surface);
    if (els.lastSourceText) els.lastSourceText.textContent = surface === 'browser' ? 'вкладка браузера' : surface === 'window' ? 'окно приложения' : 'экран';

    let micStream = null;
    if (els.micToggle?.checked) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(new MediaStream(audioTracks)).connect(destination);
    if (micStream?.getAudioTracks().length) audioContext.createMediaStreamSource(micStream).connect(destination);

    const startedAt = Date.now();
    const recorder = makeRecorder(destination.stream, async (blob) => {
      clearInterval(state.live?.timer);
      stopStream(displayStream);
      stopStream(micStream);
      await audioContext.close().catch(() => {});
      state.live = null;
      els.startCaptureBtn?.classList.remove('hidden');
      els.stopCaptureBtn?.classList.add('hidden');
      els.captureStatus?.classList.remove('recording');
      if (els.captureStatusText) els.captureStatusText.textContent = 'ЗАПИСЬ ГОТОВА';
      if (els.systemStatus) els.systemStatus.textContent = 'Звук встречи: запись завершена';
      if (els.micStatus) els.micStatus.textContent = 'Микрофон: запись завершена';
      els.systemIndicator?.classList.remove('active');
      els.micIndicator?.classList.remove('active');
      const file = new File([blob], `meeting_${Date.now()}.webm`, { type: blob.type });
      setMediaFile(file, 'ЖИВОЙ РАЗГОВОР', blob);
      if (els.autoTranscribeToggle?.checked) await startTranscription();
    });

    const timer = startTimer(els.recordTimer, startedAt);
    state.live = { displayStream, micStream, audioContext, recorder, timer };
    recorder.start(1000);
    els.startCaptureBtn?.classList.add('hidden');
    els.stopCaptureBtn?.classList.remove('hidden');
    els.captureStatus?.classList.add('recording');
    if (els.captureStatusText) els.captureStatusText.textContent = 'ИДЁТ ЛОКАЛЬНАЯ ЗАПИСЬ';
    if (els.systemStatus) els.systemStatus.textContent = 'Звук встречи: подключён';
    els.systemIndicator?.classList.add('active');
    if (els.micStatus) els.micStatus.textContent = micStream ? 'Микрофон: подключён' : 'Микрофон: выключен';
    els.micIndicator?.classList.toggle('active', !!micStream);

    displayStream.getVideoTracks()[0]?.addEventListener('ended', stopLiveCapture, { once: true });
  } catch (error) {
    console.error(error);
    showToast(error?.message || 'Не удалось начать захват', 'error');
  }
}

function stopLiveCapture() {
  if (state.live?.recorder?.state === 'recording') state.live.recorder.stop();
}

function downloadRecordedAudio() {
  if (!state.recordedBlob) return showToast('Записи пока нет', 'error');
  triggerDownload(state.recordedBlob, state.recordedName || `speechlab_${Date.now()}.webm`);
}

function setupFileDnD() {
  els.fileInput?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) setMediaFile(file, 'ФАЙЛ');
  });
  for (const type of ['dragenter', 'dragover']) {
    els.dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      if (!state.busy) els.dropzone.classList.add('dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    els.dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove('dragging');
    });
  }
  els.dropzone?.addEventListener('drop', (event) => {
    if (state.busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) setMediaFile(file, 'ФАЙЛ');
  });
}

function init() {
  if (els.appVersion) els.appVersion.textContent = BUILD.version;
  if (els.appBuildTime) els.appBuildTime.textContent = BUILD.displayTime;
  if (els.footerBuild) els.footerBuild.textContent = `Версия ${BUILD.version} · сборка ${BUILD.displayTime.replace(' · ', ' ')}`;

  // Новый безопасный дефолт: чистая длинная запись автоматически идёт в FAST.
  if (els.qualitySelect && !['auto', 'fast', 'balanced', 'accurate', 'noisy'].includes(els.qualitySelect.value)) els.qualitySelect.value = 'auto';
  updateCaptureModeUI();
  const last = localStorage.getItem('speechlab-last-source');
  if (last && els.lastSourceText) els.lastSourceText.textContent = last === 'browser' ? 'вкладка браузера' : last === 'window' ? 'окно приложения' : 'экран';

  els.liveModeBtn?.addEventListener('click', () => switchMode('live'));
  els.dictaphoneModeBtn?.addEventListener('click', () => switchMode('dictaphone'));
  els.fileModeBtn?.addEventListener('click', () => switchMode('file'));
  els.autoCaptureToggle?.addEventListener('change', updateCaptureModeUI);
  els.startCaptureBtn?.addEventListener('click', startLiveCapture);
  els.stopCaptureBtn?.addEventListener('click', stopLiveCapture);
  els.startDictaphoneBtn?.addEventListener('click', startDictaphone);
  els.stopDictaphoneBtn?.addEventListener('click', stopDictaphone);
  els.removeFileBtn?.addEventListener('click', clearFile);
  els.transcribeBtn?.addEventListener('click', startTranscription);
  els.copyBtn?.addEventListener('click', copyTranscript);
  els.downloadBtn?.addEventListener('click', downloadText);
  els.downloadExcelBtn?.addEventListener('click', downloadExcel);
  els.downloadAudioBtn?.addEventListener('click', downloadRecordedAudio);
  els.transcript?.addEventListener('input', updateWordCount);
  els.audioPreview?.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(els.audioPreview.duration)) {
      state.currentDuration = els.audioPreview.duration;
      if (els.fileMeta) els.fileMeta.textContent = `${formatBytes(state.selectedFile?.size || 0)} · ${formatTime(state.currentDuration)} · ${state.selectedFile?.type || 'медиафайл'}`;
    }
  });

  setupFileDnD();
  switchMode('live');
}

window.addEventListener('beforeunload', () => {
  terminateWorker();
  stopStream(state.dictaphone?.stream);
  stopStream(state.live?.displayStream);
  stopStream(state.live?.micStream);
  revokePreview();
});

init();
