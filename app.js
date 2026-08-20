const BUILD = {
  version: 'v1.3.1',
  date: '20.08.2026',
  time: '12:06',
  stamp: 'v1.3.1-20260820-1206',
};

const $ = (selector) => document.querySelector(selector);

const els = {
  buildBadge: $('#buildBadge'),
  appVersion: $('#appVersion'),
  appBuildTime: $('#appBuildTime'),
  footerBuild: $('#footerBuild'),

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

  dropzone: $('#dropzone'),
  fileInput: $('#fileInput'),
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
  engineHint: $('#engineHint'),
  transcribeBtn: $('#transcribeBtn'),
  transcribeBtnText: $('#transcribeBtnText'),
  progressWrap: $('#progressWrap'),
  statusText: $('#statusText'),
  progressValue: $('#progressValue'),
  progressBar: $('#progressBar'),
  statusNote: $('#statusNote'),

  resultEmpty: $('#resultEmpty'),
  resultBlock: $('#resultBlock'),
  wordCount: $('#wordCount'),
  segmentCount: $('#segmentCount'),
  audioDuration: $('#audioDuration'),
  transcript: $('#transcript'),
  copyBtn: $('#copyBtn'),
  downloadExcelBtn: $('#downloadExcelBtn'),
  downloadBtn: $('#downloadBtn'),
  segmentsBox: $('#segmentsBox'),
  segmentsList: $('#segmentsList'),
  toast: $('#toast'),
};

let activeMode = 'live';
let selectedFile = null;
let selectedFileLabel = 'ФАЙЛ';
let previewUrl = null;
let downloadableAudioBlob = null;
let currentDuration = 0;
let currentOutput = { text: '', chunks: [] };
let busy = false;
let worker = null;
let activeJobId = null;
let jobStartedAt = 0;
let partialTranscript = '';

let liveDisplayStream = null;
let liveMicStream = null;
let liveAudioContext = null;
let liveRecorder = null;
let liveChunks = [];
let liveTimerId = null;
let liveStartedAt = 0;
let stoppingLive = false;

let dictaphoneStream = null;
let dictaphoneRecorder = null;
let dictaphoneChunks = [];
let dictaphoneTimerId = null;
let dictaphoneStartedAt = 0;


function safeStorageGet(key) {
  try { return window.localStorage?.getItem(key) || null; } catch { return null; }
}

function safeStorageSet(key, value) {
  try { window.localStorage?.setItem(key, value); } catch { /* storage can be blocked */ }
}

function showToast(message, type = 'ok') {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle('error', type === 'error');
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function setBuildInfo() {
  if (els.appVersion) els.appVersion.textContent = BUILD.version;
  if (els.appBuildTime) els.appBuildTime.textContent = `${BUILD.date} · ${BUILD.time}`;
  if (els.footerBuild) els.footerBuild.textContent = `Версия ${BUILD.version} · сборка ${BUILD.date} ${BUILD.time}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
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

function safeFileBase(name = 'speech-lab') {
  return String(name)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'speech-lab';
}

function setIndicator(indicator, on) {
  if (!indicator) return;
  indicator.classList.toggle('active', Boolean(on));
  indicator.classList.toggle('on', Boolean(on));
}

function setCaptureStatus(text, state = 'idle') {
  if (els.captureStatusText) els.captureStatusText.textContent = text;
  if (els.captureStatus) {
    els.captureStatus.classList.remove('idle', 'recording', 'error', 'active');
    els.captureStatus.classList.add(state);
  }
}

function setDictaphoneStatus(text, state = 'idle') {
  if (els.dictaphoneStatusText) els.dictaphoneStatusText.textContent = text;
  if (els.dictaphoneStatus) {
    els.dictaphoneStatus.classList.remove('idle', 'recording', 'error', 'active');
    els.dictaphoneStatus.classList.add(state);
  }
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
  busy = value;
  if (els.transcribeBtn) els.transcribeBtn.disabled = !value && !selectedFile;
  if (els.fileInput) els.fileInput.disabled = value;
  if (els.languageSelect) els.languageSelect.disabled = value;
  if (els.modelSelect) els.modelSelect.disabled = value;
  if (els.qualitySelect) els.qualitySelect.disabled = value;
  if (els.cleanupSelect) els.cleanupSelect.disabled = value;
  if (els.removeFileBtn) els.removeFileBtn.disabled = value;
  if (els.transcribeBtnText) els.transcribeBtnText.textContent = value ? 'ОСТАНОВИТЬ' : 'РАСПОЗНАТЬ РЕЧЬ';
}

function switchMode(mode) {
  const map = {
    live: [els.liveModeBtn, els.liveMode],
    dictaphone: [els.dictaphoneModeBtn, els.dictaphoneMode],
    file: [els.fileModeBtn, els.fileMode],
  };
  if (!map[mode]) return;
  activeMode = mode;

  for (const [name, [button, section]] of Object.entries(map)) {
    const active = name === mode;
    button?.classList.toggle('active', active);
    button?.setAttribute('aria-selected', String(active));
    section?.classList.toggle('hidden', !active);
  }

  if (mode === 'file') {
    requestAnimationFrame(() => els.dropzone?.focus?.());
  }
}

function resetResult() {
  currentOutput = { text: '', chunks: [] };
  partialTranscript = '';
  els.resultEmpty?.classList.remove('hidden');
  els.resultBlock?.classList.add('hidden');
  if (els.transcript) els.transcript.value = '';
  if (els.wordCount) els.wordCount.textContent = '0';
  if (els.segmentCount) els.segmentCount.textContent = '0';
  if (els.audioDuration) els.audioDuration.textContent = '—';
  if (els.segmentsList) els.segmentsList.innerHTML = '';
  if (els.segmentsBox) els.segmentsBox.open = false;
}

function renderSegments(chunks = []) {
  if (!els.segmentsList || !els.segmentsBox) return;
  els.segmentsList.innerHTML = '';
  els.segmentsBox.classList.toggle('hidden', !chunks.length);

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
    const speaker = chunk.speaker ? `${chunk.speaker}: ` : '';
    text.textContent = `${speaker}${String(chunk.text || '').trim()}`;

    row.append(time, text);
    els.segmentsList.append(row);
  }
}

function renderResult(output, sourceDuration = currentDuration) {
  currentOutput = output || { text: '', chunks: [] };
  const text = String(currentOutput.text || '').trim();
  const chunks = Array.isArray(currentOutput.chunks) ? currentOutput.chunks : [];
  if (els.transcript) els.transcript.value = text;
  const words = text ? text.split(/\s+/u).filter(Boolean).length : 0;
  if (els.wordCount) els.wordCount.textContent = String(words);
  if (els.segmentCount) els.segmentCount.textContent = String(chunks.length);
  if (els.audioDuration) els.audioDuration.textContent = formatTime(sourceDuration);
  renderSegments(chunks);
  els.resultEmpty?.classList.add('hidden');
  els.resultBlock?.classList.remove('hidden');
}

function renderPartialText(text) {
  partialTranscript = `${partialTranscript} ${String(text || '').trim()}`.replace(/\s+/g, ' ').trim();
  if (!partialTranscript) return;
  els.resultEmpty?.classList.add('hidden');
  els.resultBlock?.classList.remove('hidden');
  if (els.transcript) els.transcript.value = partialTranscript;
  if (els.wordCount) els.wordCount.textContent = String(partialTranscript.split(/\s+/u).filter(Boolean).length);
  if (els.audioDuration) els.audioDuration.textContent = formatTime(currentDuration);
}

function looksLikeMedia(file) {
  if (!file) return false;
  const extOk = /\.(mp3|wav|m4a|aac|ogg|webm|mp4|mpeg|mpga)$/i.test(file.name || '');
  return String(file.type || '').startsWith('audio/') || String(file.type || '').startsWith('video/') || extOk;
}

function revokePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function selectFile(file, { label = 'ФАЙЛ', downloadableBlob = null, preserveResult = false } = {}) {
  if (!file) return;
  if (!looksLikeMedia(file)) {
    showToast('Нужен аудио- или видеофайл', 'error');
    return;
  }

  selectedFile = file;
  selectedFileLabel = label;
  downloadableAudioBlob = downloadableBlob;
  currentDuration = 0;
  if (!preserveResult) resetResult();

  if (els.fileLabel) els.fileLabel.textContent = label;
  if (els.fileName) els.fileName.textContent = file.name;
  if (els.fileMeta) els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
  els.fileCard?.classList.remove('hidden');
  if (els.transcribeBtn) els.transcribeBtn.disabled = false;

  revokePreview();
  previewUrl = URL.createObjectURL(file);
  if (els.audioPreview) {
    els.audioPreview.src = previewUrl;
    els.audioPreview.classList.remove('hidden');
  }
  els.downloadAudioBtn?.classList.toggle('hidden', !downloadableBlob);
}

function clearFile() {
  if (busy) return;
  selectedFile = null;
  selectedFileLabel = 'ФАЙЛ';
  downloadableAudioBlob = null;
  currentDuration = 0;
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

function updateCaptureModeUI() {
  const auto = Boolean(els.autoCaptureToggle?.checked);
  if (els.captureModeBadge) els.captureModeBadge.textContent = auto ? 'AUTO' : 'MANUAL';
  els.manualSourceWrap?.classList.toggle('hidden', auto);
  if (els.startCaptureBtnText) els.startCaptureBtnText.textContent = auto ? 'НАЙТИ И НАЧАТЬ' : 'ВЫБРАТЬ И НАЧАТЬ';
  if (els.captureModeHint) {
    els.captureModeHint.textContent = auto
      ? 'АВТО: предложу последний удачный тип источника и сразу начну запись после подтверждения браузера.'
      : 'РУЧНОЙ: выбери, что предложить первым — вкладку, окно приложения или экран.';
  }
}

function sourceLabel(surface) {
  if (surface === 'browser') return 'вкладка браузера';
  if (surface === 'window') return 'окно приложения';
  if (surface === 'monitor') return 'экран целиком';
  return 'источник экрана';
}

function preferredSurface() {
  if (!els.autoCaptureToggle?.checked) return els.manualSourceSelect?.value || 'browser';
  return safeStorageGet('speechLabLastDisplaySurface') || 'browser';
}

function supportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function recorderExtension(mimeType = '') {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

function makeRecorder(stream) {
  if (!window.MediaRecorder) throw new Error('Этот браузер не поддерживает MediaRecorder. Используй актуальный Chrome или Edge.');
  const mimeType = supportedMimeType();
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
}

function startTimer(kind) {
  const live = kind === 'live';
  const started = Date.now();
  if (live) liveStartedAt = started;
  else dictaphoneStartedAt = started;

  const render = () => {
    const elapsed = (Date.now() - started) / 1000;
    if (live && els.recordTimer) els.recordTimer.textContent = formatTime(elapsed);
    if (!live && els.dictaphoneTimer) els.dictaphoneTimer.textContent = formatTime(elapsed);
  };
  render();
  const id = setInterval(render, 500);
  if (live) liveTimerId = id;
  else dictaphoneTimerId = id;
}

function stopTimer(kind) {
  if (kind === 'live') {
    clearInterval(liveTimerId);
    liveTimerId = null;
  } else {
    clearInterval(dictaphoneTimerId);
    dictaphoneTimerId = null;
  }
}

async function startDictaphone() {
  if (dictaphoneRecorder?.state === 'recording') return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('Микрофон недоступен в этом браузере', 'error');
    return;
  }

  try {
    setDictaphoneStatus('ЗАПРАШИВАЮ МИКРОФОН…', 'active');
    dictaphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    dictaphoneChunks = [];
    dictaphoneRecorder = makeRecorder(dictaphoneStream);
    dictaphoneRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) dictaphoneChunks.push(event.data);
    });
    dictaphoneRecorder.addEventListener('stop', finalizeDictaphone, { once: true });
    dictaphoneRecorder.start(1000);

    setIndicator(els.dictaphoneMicIndicator, true);
    if (els.dictaphoneMicStatus) els.dictaphoneMicStatus.textContent = 'Микрофон: запись идёт';
    setDictaphoneStatus('ИДЁТ ЗАПИСЬ', 'recording');
    els.startDictaphoneBtn?.classList.add('hidden');
    els.stopDictaphoneBtn?.classList.remove('hidden');
    startTimer('dictaphone');
    showToast('Диктофон запущен');
  } catch (error) {
    console.error(error);
    setDictaphoneStatus('НЕ УДАЛОСЬ ПОДКЛЮЧИТЬ МИКРОФОН', 'error');
    showToast(error?.name === 'NotAllowedError' ? 'Разреши доступ к микрофону' : (error?.message || 'Ошибка микрофона'), 'error');
  }
}

function stopDictaphone() {
  if (!dictaphoneRecorder || dictaphoneRecorder.state === 'inactive') return;
  setDictaphoneStatus('СОХРАНЯЮ ЗАПИСЬ…', 'active');
  stopTimer('dictaphone');
  dictaphoneRecorder.stop();
  dictaphoneStream?.getTracks().forEach((track) => track.stop());
}

async function finalizeDictaphone() {
  const mimeType = dictaphoneRecorder?.mimeType || dictaphoneChunks[0]?.type || 'audio/webm';
  const blob = new Blob(dictaphoneChunks, { type: mimeType });
  const ext = recorderExtension(mimeType);
  const file = new File([blob], `dictaphone_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type: mimeType });

  setIndicator(els.dictaphoneMicIndicator, false);
  if (els.dictaphoneMicStatus) els.dictaphoneMicStatus.textContent = 'Микрофон: запись завершена';
  setDictaphoneStatus('ЗАПИСЬ ГОТОВА', 'idle');
  els.startDictaphoneBtn?.classList.remove('hidden');
  els.stopDictaphoneBtn?.classList.add('hidden');
  selectFile(file, { label: 'ДИКТОФОН', downloadableBlob: blob });
  showToast('Запись диктофона готова');

  if (els.dictaphoneAutoTranscribeToggle?.checked) {
    await transcribeSelectedFile();
  }
}

async function createMixedAudioStream(systemStream, micStream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Браузер не поддерживает Web Audio API.');
  liveAudioContext = new AudioContextClass();
  const destination = liveAudioContext.createMediaStreamDestination();

  const systemTracks = systemStream.getAudioTracks();
  if (!systemTracks.length) throw new Error('В выбранном источнике нет аудио. Включи «Поделиться аудио» в окне браузера.');

  const systemOnly = new MediaStream(systemTracks);
  const systemSource = liveAudioContext.createMediaStreamSource(systemOnly);
  systemSource.connect(destination);

  if (micStream?.getAudioTracks().length) {
    const micSource = liveAudioContext.createMediaStreamSource(new MediaStream(micStream.getAudioTracks()));
    micSource.connect(destination);
  }

  return destination.stream;
}

async function startLiveCapture() {
  if (liveRecorder?.state === 'recording') return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast('Захват экрана недоступен. Открой сайт по HTTPS в Chrome/Edge.', 'error');
    return;
  }

  try {
    stoppingLive = false;
    setCaptureStatus('ВЫБЕРИ ИСТОЧНИК В ОКНЕ БРАУЗЕРА…', 'active');
    const surface = preferredSurface();

    const displayOptions = {
      video: { displaySurface: surface },
      audio: true,
      preferCurrentTab: surface === 'browser',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: 'include',
    };

    liveDisplayStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
    const audioTracks = liveDisplayStream.getAudioTracks();
    if (!audioTracks.length) {
      liveDisplayStream.getTracks().forEach((track) => track.stop());
      liveDisplayStream = null;
      throw new Error('Звук не передаётся. Повтори выбор и включи «Поделиться аудио» / «Share audio».');
    }

    const videoTrack = liveDisplayStream.getVideoTracks()[0];
    const actualSurface = videoTrack?.getSettings?.().displaySurface || surface;
    safeStorageSet('speechLabLastDisplaySurface', actualSurface);
    if (els.lastSourceText) els.lastSourceText.textContent = sourceLabel(actualSurface);

    if (els.micToggle?.checked) {
      try {
        liveMicStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (micError) {
        liveMicStream = null;
        showToast('Звук встречи пишется, но микрофон не подключён', 'error');
      }
    }

    const mixedStream = await createMixedAudioStream(liveDisplayStream, liveMicStream);
    liveChunks = [];
    liveRecorder = makeRecorder(mixedStream);
    liveRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) liveChunks.push(event.data);
    });
    liveRecorder.addEventListener('stop', finalizeLiveCapture, { once: true });
    liveRecorder.start(1000);

    setIndicator(els.systemIndicator, true);
    if (els.systemStatus) els.systemStatus.textContent = `Звук встречи: подключён · ${sourceLabel(actualSurface)}`;
    setIndicator(els.micIndicator, Boolean(liveMicStream));
    if (els.micStatus) els.micStatus.textContent = liveMicStream ? 'Микрофон: подключён' : 'Микрофон: выключен';
    setCaptureStatus('ИДЁТ ЗАПИСЬ', 'recording');
    els.startCaptureBtn?.classList.add('hidden');
    els.stopCaptureBtn?.classList.remove('hidden');
    startTimer('live');

    const endTrack = videoTrack || audioTracks[0];
    endTrack?.addEventListener('ended', () => {
      if (!stoppingLive && liveRecorder?.state === 'recording') stopLiveCapture();
    }, { once: true });

    showToast('Захват звука начался');
  } catch (error) {
    console.error(error);
    const cancelled = error?.name === 'NotAllowedError' || error?.name === 'AbortError';
    setCaptureStatus(cancelled ? 'ВЫБОР ИСТОЧНИКА ОТМЕНЁН' : 'ОШИБКА ЗАХВАТА', cancelled ? 'idle' : 'error');
    showToast(cancelled ? 'Источник не выбран' : (error?.message || 'Не удалось начать захват'), 'error');
    cleanupLiveSources();
  }
}

function stopLiveCapture() {
  if (!liveRecorder || liveRecorder.state === 'inactive') return;
  stoppingLive = true;
  setCaptureStatus('СОХРАНЯЮ ЗАПИСЬ…', 'active');
  stopTimer('live');
  liveRecorder.stop();
  liveDisplayStream?.getTracks().forEach((track) => track.stop());
  liveMicStream?.getTracks().forEach((track) => track.stop());
}

function cleanupLiveSources() {
  liveDisplayStream?.getTracks().forEach((track) => track.stop());
  liveMicStream?.getTracks().forEach((track) => track.stop());
  liveDisplayStream = null;
  liveMicStream = null;
  if (liveAudioContext) liveAudioContext.close().catch(() => {});
  liveAudioContext = null;
}

async function finalizeLiveCapture() {
  const mimeType = liveRecorder?.mimeType || liveChunks[0]?.type || 'audio/webm';
  const blob = new Blob(liveChunks, { type: mimeType });
  const ext = recorderExtension(mimeType);
  const file = new File([blob], `meeting_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type: mimeType });

  setIndicator(els.systemIndicator, false);
  setIndicator(els.micIndicator, false);
  if (els.systemStatus) els.systemStatus.textContent = 'Звук встречи: запись завершена';
  if (els.micStatus) els.micStatus.textContent = 'Микрофон: не подключён';
  setCaptureStatus('ЗАПИСЬ ГОТОВА', 'idle');
  els.startCaptureBtn?.classList.remove('hidden');
  els.stopCaptureBtn?.classList.add('hidden');
  cleanupLiveSources();

  selectFile(file, { label: 'ЖИВОЙ РАЗГОВОР', downloadableBlob: blob });
  showToast('Запись встречи готова');
  if (els.autoTranscribeToggle?.checked) await transcribeSelectedFile();
}

async function decodeToMono16k(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Браузер не поддерживает AudioContext.');

  const context = new AudioContextClass();
  try {
    const bytes = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    currentDuration = decoded.duration;

    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const mono = rendered.getChannelData(0);
    return new Float32Array(mono);
  } catch (error) {
    console.error(error);
    throw new Error('Не удалось прочитать аудиодорожку. Попробуй MP3, WAV, M4A, OGG или WEBM.');
  } finally {
    await context.close().catch(() => {});
  }
}

function getProfile() {
  const quality = els.qualitySelect?.value || 'auto';
  const manualModel = els.modelSelect?.value || 'auto';
  let modelId = manualModel;
  if (manualModel === 'auto') {
    modelId = quality === 'fast' ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-base';
  }

  const profiles = {
    fast: { chunkSeconds: 29, overlapSeconds: 0, useVad: true, vadThreshold: 0.0045, noisyMode: false },
    balanced: { chunkSeconds: 28, overlapSeconds: 1.5, useVad: true, vadThreshold: 0.0042, noisyMode: false },
    accurate: { chunkSeconds: 25, overlapSeconds: 2, useVad: true, vadThreshold: 0.0038, noisyMode: false },
    noisy: { chunkSeconds: 18, overlapSeconds: 1.5, useVad: true, vadThreshold: 0.0055, noisyMode: true },
    auto: { chunkSeconds: 28, overlapSeconds: 1.5, useVad: true, vadThreshold: 0.0042, noisyMode: false },
  };

  return {
    quality,
    modelId,
    preferredDevice: navigator.gpu ? 'webgpu' : 'wasm',
    ...profiles[quality] || profiles.auto,
  };
}

function updateEngineHint() {
  if (!els.engineHint) return;
  const profile = getProfile();
  const modelName = profile.modelId.includes('tiny') ? 'Whisper Tiny' : profile.modelId.includes('small') ? 'Whisper Small' : 'Whisper Base';
  const modeName = profile.quality === 'fast' ? 'БЫСТРО' : profile.quality === 'accurate' ? 'ТОЧНО' : profile.quality === 'noisy' ? 'ШУМ' : 'БАЛАНС';
  els.engineHint.textContent = `${modeName} · ${modelName} · ${navigator.gpu ? 'WebGPU при возможности' : 'Worker / WASM'}. Интерфейс не зависит от загрузки AI-библиотеки.`;
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(`./transcription-worker.js?build=${BUILD.stamp}`, { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (event) => {
    console.error('Worker error', event);
    if (busy) {
      setProgress(0, 'Ошибка Worker', 'Не удалось запустить AI-модель. Проверь интернет и перезагрузи страницу.');
      showToast('Ошибка модуля распознавания', 'error');
      finishJob();
    }
  });
  return worker;
}

function handleWorkerMessage(event) {
  const message = event.data || {};
  if (!activeJobId || message.jobId !== activeJobId) return;

  if (message.type === 'model-progress') {
    const mapped = 8 + Math.round((message.progress || 0) * 0.42);
    setProgress(mapped, 'Загружаю AI-модель', message.file ? `Модель: ${message.file}` : 'Первый запуск может занять время.');
    return;
  }

  if (message.type === 'status') {
    setProgress(10, 'Подготавливаю AI', message.message || 'Запуск модели…');
    return;
  }

  if (message.type === 'backend-fallback') {
    setProgress(12, 'Переключаю движок', 'WebGPU недоступен — продолжаю через Worker/WASM.');
    return;
  }

  if (message.type === 'engine') {
    setProgress(52, 'Модель готова', `${message.device === 'webgpu' ? 'WebGPU' : 'WASM'} · начинаю распознавание.`);
    return;
  }

  if (message.type === 'chunk-progress') {
    const ratio = message.total ? message.index / message.total : 0;
    const percent = 52 + Math.round(ratio * 47);
    const elapsed = Math.max(1, (Date.now() - jobStartedAt) / 1000);
    const eta = ratio > 0.02 ? Math.max(0, elapsed * (1 / ratio - 1)) : null;
    const note = `Фрагмент ${message.index} из ${message.total}${message.skipped ? ` · пропущено тишины: ${message.skipped}` : ''}${Number.isFinite(eta) ? ` · осталось ≈ ${formatTime(eta)}` : ''}`;
    setProgress(percent, 'Распознаю речь', note);
    if (message.partialText) renderPartialText(message.partialText);
    return;
  }

  if (message.type === 'result') {
    setProgress(100, 'Готово', 'Текст можно редактировать, копировать и выгружать.');
    renderResult(message.output, currentDuration);
    showToast('Распознавание завершено');
    finishJob();
    return;
  }

  if (message.type === 'cancelled') {
    setProgress(0, 'Остановлено', 'Распознавание остановлено пользователем.');
    showToast('Распознавание остановлено');
    finishJob();
    return;
  }

  if (message.type === 'error') {
    console.error(message);
    setProgress(0, 'Ошибка распознавания', message.message || 'Не удалось обработать запись.');
    showToast(message.message || 'Ошибка распознавания', 'error');
    finishJob();
  }
}

function finishJob() {
  activeJobId = null;
  setBusy(false);
}

function cancelTranscription() {
  if (!busy) return;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  activeJobId = null;
  setBusy(false);
  setProgress(0, 'Остановлено', 'Worker остановлен. Можно запустить распознавание снова.');
  showToast('Распознавание остановлено');
}

async function transcribeSelectedFile() {
  if (!selectedFile || busy) return;
  setBusy(true);
  resetResult();
  partialTranscript = '';

  try {
    setProgress(3, 'Читаю аудио', 'Подготавливаю запись в фоне.');
    const audio = await decodeToMono16k(selectedFile);
    setProgress(7, 'Аудио готово', `${formatTime(currentDuration)} · 16 кГц mono`);

    const profile = getProfile();
    const jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    activeJobId = jobId;
    jobStartedAt = Date.now();

    const targetWorker = ensureWorker();
    targetWorker.postMessage({
      type: 'transcribe',
      jobId,
      audioBuffer: audio.buffer,
      modelId: profile.modelId,
      preferredDevice: profile.preferredDevice,
      language: els.languageSelect?.value || 'russian',
      chunkSeconds: profile.chunkSeconds,
      overlapSeconds: profile.overlapSeconds,
      useVad: profile.useVad,
      vadThreshold: profile.vadThreshold,
      noisyMode: profile.noisyMode,
      cleanupMode: els.cleanupSelect?.value || 'standard',
    }, [audio.buffer]);
  } catch (error) {
    console.error(error);
    setProgress(0, 'Ошибка', error?.message || 'Не удалось подготовить аудио.');
    showToast(error?.message || 'Ошибка аудио', 'error');
    finishJob();
  }
}

async function copyTranscript() {
  const text = els.transcript?.value.trim() || '';
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

function downloadText() {
  const text = els.transcript?.value.trim() || '';
  if (!text) return showToast('Текста пока нет', 'error');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, `${safeFileBase(selectedFile?.name || 'transcript')}_transcript.txt`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadExcel() {
  const text = els.transcript?.value.trim() || '';
  if (!text) return showToast('Текста пока нет', 'error');

  try {
    showToast('Формирую Excel…');
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const workbook = XLSX.utils.book_new();
    const textRows = [
      ['Параметр', 'Значение'],
      ['Версия', BUILD.version],
      ['Сборка', `${BUILD.date} ${BUILD.time}`],
      ['Источник', selectedFileLabel],
      ['Файл', selectedFile?.name || '—'],
      ['Длительность', formatTime(currentDuration)],
      ['Текст', text],
    ];
    const textSheet = XLSX.utils.aoa_to_sheet(textRows);
    textSheet['!cols'] = [{ wch: 22 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(workbook, textSheet, 'Текст');

    const segmentRows = [['Начало', 'Конец', 'Говорящий', 'Текст']];
    const chunks = Array.isArray(currentOutput?.chunks) ? currentOutput.chunks : [];
    for (const chunk of chunks) {
      const [start, end] = Array.isArray(chunk.timestamp) ? chunk.timestamp : [null, null];
      segmentRows.push([formatTime(start), formatTime(end), chunk.speaker || '', chunk.text || '']);
    }
    const segmentSheet = XLSX.utils.aoa_to_sheet(segmentRows);
    segmentSheet['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(workbook, segmentSheet, 'Сегменты');

    XLSX.writeFile(workbook, `${safeFileBase(selectedFile?.name || 'speech_lab')}_transcript.xlsx`);
    showToast('Excel выгружен');
  } catch (error) {
    console.error(error);
    showToast('Не удалось создать Excel. Проверь интернет и повтори.', 'error');
  }
}

function downloadRecordedAudio() {
  if (!downloadableAudioBlob) return showToast('Записи для скачивания пока нет', 'error');
  const ext = recorderExtension(downloadableAudioBlob.type);
  downloadBlob(downloadableAudioBlob, `${safeFileBase(selectedFile?.name || 'speech_recording')}.${ext}`);
}

function bindEvents() {
  els.liveModeBtn?.addEventListener('click', () => switchMode('live'));
  els.dictaphoneModeBtn?.addEventListener('click', () => switchMode('dictaphone'));
  els.fileModeBtn?.addEventListener('click', () => switchMode('file'));

  els.autoCaptureToggle?.addEventListener('change', updateCaptureModeUI);
  els.manualSourceSelect?.addEventListener('change', updateCaptureModeUI);
  els.speakerLabelsToggle?.addEventListener('change', () => {
    els.speakerConfig?.classList.toggle('hidden', !els.speakerLabelsToggle.checked);
  });

  els.startCaptureBtn?.addEventListener('click', startLiveCapture);
  els.stopCaptureBtn?.addEventListener('click', stopLiveCapture);
  els.startDictaphoneBtn?.addEventListener('click', startDictaphone);
  els.stopDictaphoneBtn?.addEventListener('click', stopDictaphone);

  els.fileInput?.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) selectFile(file, { label: 'ФАЙЛ' });
  });
  els.removeFileBtn?.addEventListener('click', clearFile);
  els.downloadAudioBtn?.addEventListener('click', downloadRecordedAudio);

  for (const type of ['dragenter', 'dragover']) {
    els.dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      if (!busy) els.dropzone.classList.add('dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    els.dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove('dragging');
    });
  }
  els.dropzone?.addEventListener('drop', (event) => {
    if (busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) selectFile(file, { label: 'ФАЙЛ' });
  });

  els.audioPreview?.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(els.audioPreview.duration)) {
      currentDuration = els.audioPreview.duration;
      if (els.fileMeta) els.fileMeta.textContent = `${formatBytes(selectedFile?.size || 0)} · ${formatTime(currentDuration)} · ${selectedFile?.type || 'медиафайл'}`;
    }
  });

  els.transcribeBtn?.addEventListener('click', () => {
    if (busy) cancelTranscription();
    else transcribeSelectedFile();
  });
  els.copyBtn?.addEventListener('click', copyTranscript);
  els.downloadExcelBtn?.addEventListener('click', downloadExcel);
  els.downloadBtn?.addEventListener('click', downloadText);

  els.qualitySelect?.addEventListener('change', updateEngineHint);
  els.modelSelect?.addEventListener('change', updateEngineHint);

  els.transcript?.addEventListener('input', () => {
    const text = els.transcript.value.trim();
    if (els.wordCount) els.wordCount.textContent = String(text ? text.split(/\s+/u).filter(Boolean).length : 0);
  });

  window.addEventListener('beforeunload', () => {
    cleanupLiveSources();
    dictaphoneStream?.getTracks().forEach((track) => track.stop());
    worker?.terminate();
  });
}

function init() {
  setBuildInfo();
  bindEvents();
  switchMode('live');
  updateCaptureModeUI();
  updateEngineHint();
  if (els.lastSourceText) {
    const last = safeStorageGet('speechLabLastDisplaySurface');
    els.lastSourceText.textContent = last ? sourceLabel(last) : 'ещё не выбран';
  }
  if (els.speakerConfig && els.speakerLabelsToggle) {
    els.speakerConfig.classList.toggle('hidden', !els.speakerLabelsToggle.checked);
  }
  console.info(`Speech Lab ${BUILD.version} ${BUILD.date} ${BUILD.time} loaded`);
}

init();
