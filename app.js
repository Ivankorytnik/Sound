import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;

const els = {
  fileInput: document.querySelector('#fileInput'),
  dropzone: document.querySelector('#dropzone'),
  fileCard: document.querySelector('#fileCard'),
  fileLabel: document.querySelector('#fileLabel'),
  fileName: document.querySelector('#fileName'),
  fileMeta: document.querySelector('#fileMeta'),
  removeFileBtn: document.querySelector('#removeFileBtn'),
  audioPreview: document.querySelector('#audioPreview'),
  downloadAudioBtn: document.querySelector('#downloadAudioBtn'),
  languageSelect: document.querySelector('#languageSelect'),
  modelSelect: document.querySelector('#modelSelect'),
  transcribeBtn: document.querySelector('#transcribeBtn'),
  transcribeBtnText: document.querySelector('#transcribeBtnText'),
  progressWrap: document.querySelector('#progressWrap'),
  progressBar: document.querySelector('#progressBar'),
  progressValue: document.querySelector('#progressValue'),
  statusText: document.querySelector('#statusText'),
  statusNote: document.querySelector('#statusNote'),
  resultEmpty: document.querySelector('#resultEmpty'),
  resultBlock: document.querySelector('#resultBlock'),
  transcript: document.querySelector('#transcript'),
  wordCount: document.querySelector('#wordCount'),
  segmentCount: document.querySelector('#segmentCount'),
  audioDuration: document.querySelector('#audioDuration'),
  segmentsList: document.querySelector('#segmentsList'),
  segmentsBox: document.querySelector('#segmentsBox'),
  copyBtn: document.querySelector('#copyBtn'),
  downloadBtn: document.querySelector('#downloadBtn'),
  toast: document.querySelector('#toast'),
  liveModeBtn: document.querySelector('#liveModeBtn'),
  fileModeBtn: document.querySelector('#fileModeBtn'),
  liveMode: document.querySelector('#liveMode'),
  fileMode: document.querySelector('#fileMode'),
  micToggle: document.querySelector('#micToggle'),
  autoTranscribeToggle: document.querySelector('#autoTranscribeToggle'),
  startCaptureBtn: document.querySelector('#startCaptureBtn'),
  stopCaptureBtn: document.querySelector('#stopCaptureBtn'),
  captureStatus: document.querySelector('#captureStatus'),
  captureStatusText: document.querySelector('#captureStatusText'),
  recordTimer: document.querySelector('#recordTimer'),
  systemIndicator: document.querySelector('#systemIndicator'),
  systemStatus: document.querySelector('#systemStatus'),
  micIndicator: document.querySelector('#micIndicator'),
  micStatus: document.querySelector('#micStatus'),
};

let selectedFile = null;
let selectedFileSource = 'file';
let previewUrl = null;
let currentDuration = 0;
let busy = false;
let activeMode = 'live';
const transcriberCache = new Map();

let displayStream = null;
let micStream = null;
let mixedStream = null;
let audioContext = null;
let mediaRecorder = null;
let recordedChunks = [];
let captureStartedAt = 0;
let captureTimerId = null;
let captureStopping = false;

function showToast(message, type = 'ok') {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', type === 'error');
  els.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove('show'), 2600);
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
  els.progressWrap.classList.remove('hidden');
  els.progressBar.style.width = `${value}%`;
  els.progressValue.textContent = `${value}%`;
  els.statusText.textContent = title;
  els.statusNote.textContent = note;
}

function setBusy(value) {
  busy = value;
  els.transcribeBtn.disabled = value || !selectedFile;
  els.fileInput.disabled = value;
  els.languageSelect.disabled = value;
  els.modelSelect.disabled = value;
  els.removeFileBtn.disabled = value;
  els.startCaptureBtn.disabled = value || Boolean(mediaRecorder);
  els.liveModeBtn.disabled = value || Boolean(mediaRecorder);
  els.fileModeBtn.disabled = value || Boolean(mediaRecorder);
  els.transcribeBtnText.textContent = value ? 'ОБРАБАТЫВАЮ…' : 'РАСПОЗНАТЬ РЕЧЬ';
}

function setMode(mode) {
  if (busy || mediaRecorder) return;
  activeMode = mode;
  const isLive = mode === 'live';
  els.liveMode.classList.toggle('hidden', !isLive);
  els.fileMode.classList.toggle('hidden', isLive);
  els.liveModeBtn.classList.toggle('active', isLive);
  els.fileModeBtn.classList.toggle('active', !isLive);
  els.liveModeBtn.setAttribute('aria-selected', String(isLive));
  els.fileModeBtn.setAttribute('aria-selected', String(!isLive));
}

function resetResult() {
  els.resultEmpty.classList.remove('hidden');
  els.resultBlock.classList.add('hidden');
  els.transcript.value = '';
  els.wordCount.textContent = '0';
  els.segmentCount.textContent = '0';
  els.audioDuration.textContent = '—';
  els.segmentsList.innerHTML = '';
  els.segmentsBox.open = false;
}

function clearFile() {
  if (busy || mediaRecorder) return;
  selectedFile = null;
  selectedFileSource = 'file';
  currentDuration = 0;
  els.fileInput.value = '';
  els.fileCard.classList.add('hidden');
  els.audioPreview.classList.add('hidden');
  els.audioPreview.removeAttribute('src');
  els.downloadAudioBtn.classList.add('hidden');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  els.transcribeBtn.disabled = true;
  els.progressWrap.classList.add('hidden');
  setProgress(0, 'Подготовка…');
  els.progressWrap.classList.add('hidden');
  resetResult();
}

function looksLikeMedia(file) {
  const extOk = /\.(mp3|wav|m4a|aac|ogg|webm|mp4|mpeg|mpga)$/i.test(file.name);
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || extOk;
}

function selectFile(file, source = 'file') {
  if (!file) return;
  if (!looksLikeMedia(file)) {
    showToast('Нужен аудио- или видеофайл', 'error');
    return;
  }

  selectedFile = file;
  selectedFileSource = source;
  resetResult();
  els.progressWrap.classList.add('hidden');
  els.fileLabel.textContent = source === 'capture' ? 'ЗАПИСЬ РАЗГОВОРА' : 'ФАЙЛ';
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
  els.fileCard.classList.remove('hidden');
  els.transcribeBtn.disabled = false;

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  els.audioPreview.src = previewUrl;
  els.audioPreview.classList.remove('hidden');
  els.downloadAudioBtn.classList.toggle('hidden', source !== 'capture');
}

function resampleLinear(input, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const weight = sourceIndex - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }
  return output;
}

async function decodeToMono16k(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Браузер не поддерживает AudioContext.');

  const context = new AudioContextClass();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    currentDuration = decoded.duration;

    const mono = new Float32Array(decoded.length);
    const channelCount = decoded.numberOfChannels;

    for (let channel = 0; channel < channelCount; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / channelCount;
    }

    return resampleLinear(mono, decoded.sampleRate, 16000);
  } catch (error) {
    console.error(error);
    throw new Error('Не удалось прочитать аудиодорожку. Попробуй MP3, WAV, M4A или WEBM.');
  } finally {
    await context.close().catch(() => {});
  }
}

async function getTranscriber(modelId) {
  if (transcriberCache.has(modelId)) {
    setProgress(58, 'Модель готова', 'Использую модель из текущей сессии.');
    return transcriberCache.get(modelId);
  }

  setProgress(12, 'Загружаю AI-модель', 'При первом запуске браузер скачивает файлы модели.');

  const transcriber = await pipeline('automatic-speech-recognition', modelId, {
    progress_callback: (data) => {
      if (!data) return;
      if (data.status === 'progress' && Number.isFinite(data.progress)) {
        const mapped = 12 + (Math.max(0, Math.min(100, data.progress)) * 0.43);
        setProgress(mapped, 'Загружаю AI-модель', data.file ? `Файл модели: ${data.file}` : 'Подготовка модели…');
      } else if (data.status === 'ready') {
        setProgress(56, 'Модель готова', 'Перехожу к распознаванию речи.');
      }
    },
  });

  transcriberCache.set(modelId, transcriber);
  return transcriber;
}

function renderSegments(chunks = []) {
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
    text.textContent = String(chunk.text || '').trim();

    row.append(time, text);
    els.segmentsList.append(row);
  }
}

function renderResult(output) {
  const text = String(output?.text || '').trim();
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];

  els.transcript.value = text;
  const words = text ? text.split(/\s+/u).filter(Boolean).length : 0;
  els.wordCount.textContent = String(words);
  els.segmentCount.textContent = String(chunks.length);
  els.audioDuration.textContent = formatTime(currentDuration);
  renderSegments(chunks);

  els.resultEmpty.classList.add('hidden');
  els.resultBlock.classList.remove('hidden');
}

async function transcribe() {
  if (!selectedFile || busy || mediaRecorder) return;
  setBusy(true);
  resetResult();

  try {
    setProgress(3, 'Читаю запись', 'Извлекаю аудио и привожу его к формату 16 кГц mono.');
    const audio = await decodeToMono16k(selectedFile);
    setProgress(10, 'Аудио готово', `${formatTime(currentDuration)} · ${audio.length.toLocaleString('ru-RU')} сэмплов`);

    const transcriber = await getTranscriber(els.modelSelect.value);

    setProgress(68, 'Распознаю речь', 'Обработка выполняется локально в браузере.');
    const options = {
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    };

    if (els.languageSelect.value !== 'auto') {
      options.language = els.languageSelect.value;
    }

    const output = await transcriber(audio, options);
    setProgress(100, 'Готово', 'Текст можно отредактировать, скопировать или скачать.');
    renderResult(output);
    showToast('Распознавание завершено');
  } catch (error) {
    console.error(error);
    const message = error?.message || 'Не удалось распознать запись.';
    setProgress(0, 'Ошибка', message);
    showToast(message, 'error');
  } finally {
    setBusy(false);
  }
}

function setSourceStatus(kind, state, text) {
  const indicator = kind === 'system' ? els.systemIndicator : els.micIndicator;
  const label = kind === 'system' ? els.systemStatus : els.micStatus;
  indicator.className = `source-indicator ${state}`;
  label.textContent = text;
}

function updateCaptureTimer() {
  if (!captureStartedAt) return;
  const elapsed = (performance.now() - captureStartedAt) / 1000;
  els.recordTimer.textContent = formatTime(elapsed);
}

function getRecorderMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function stopTracks(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

async function releaseCaptureResources() {
  window.clearInterval(captureTimerId);
  captureTimerId = null;
  stopTracks(displayStream);
  stopTracks(micStream);
  stopTracks(mixedStream);
  displayStream = null;
  micStream = null;
  mixedStream = null;
  if (audioContext) await audioContext.close().catch(() => {});
  audioContext = null;
  mediaRecorder = null;
  captureStartedAt = 0;
}

function setCaptureUi(active) {
  els.startCaptureBtn.classList.toggle('hidden', active);
  els.stopCaptureBtn.classList.toggle('hidden', !active);
  els.liveModeBtn.disabled = active || busy;
  els.fileModeBtn.disabled = active || busy;
  els.micToggle.disabled = active;
  els.autoTranscribeToggle.disabled = active;
  els.captureStatus.classList.toggle('recording', active);
  els.captureStatus.classList.toggle('idle', !active);
  els.captureStatusText.textContent = active ? 'ИДЁТ ЗАПИСЬ' : 'ГОТОВ К ЗАХВАТУ';
  if (!active) {
    setSourceStatus('system', '', 'Звук встречи: не подключён');
    setSourceStatus('mic', '', 'Микрофон: не подключён');
  }
}

async function startCapture() {
  if (busy || mediaRecorder) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast('Браузер не поддерживает захват экрана', 'error');
    return;
  }
  if (!window.MediaRecorder) {
    showToast('Браузер не поддерживает запись MediaRecorder', 'error');
    return;
  }

  recordedChunks = [];
  captureStopping = false;
  resetResult();
  els.progressWrap.classList.add('hidden');

  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        suppressLocalAudioPlayback: false,
      },
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
    });

    const displayAudioTracks = displayStream.getAudioTracks();
    if (!displayAudioTracks.length) {
      stopTracks(displayStream);
      displayStream = null;
      throw new Error('Аудио не передаётся. Повтори запуск и включи «Поделиться аудио» в окне выбора.');
    }

    setSourceStatus('system', 'active', 'Звук встречи: подключён');

    if (els.micToggle.checked) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        setSourceStatus('mic', 'active', 'Микрофон: подключён');
      } catch (error) {
        console.warn('Microphone unavailable', error);
        micStream = null;
        setSourceStatus('mic', 'warn', 'Микрофон: нет доступа, пишу только встречу');
        showToast('Микрофон недоступен — записываю только звук встречи', 'error');
      }
    } else {
      setSourceStatus('mic', 'off', 'Микрофон: выключен');
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Браузер не поддерживает AudioContext.');

    audioContext = new AudioContextClass();
    await audioContext.resume().catch(() => {});
    const destination = audioContext.createMediaStreamDestination();

    const systemSource = audioContext.createMediaStreamSource(new MediaStream(displayAudioTracks));
    const systemGain = audioContext.createGain();
    systemGain.gain.value = 1;
    systemSource.connect(systemGain).connect(destination);

    if (micStream?.getAudioTracks().length) {
      const micSource = audioContext.createMediaStreamSource(micStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = 1;
      micSource.connect(micGain).connect(destination);
    }

    mixedStream = destination.stream;
    const mimeType = getRecorderMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(mixedStream, { mimeType, audioBitsPerSecond: 128000 })
      : new MediaRecorder(mixedStream);

    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener('error', (event) => {
      console.error('MediaRecorder error', event.error || event);
      showToast('Ошибка записи звука', 'error');
    });

    mediaRecorder.addEventListener('stop', finalizeCapture, { once: true });

    for (const track of displayStream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (mediaRecorder?.state === 'recording') stopCapture();
      }, { once: true });
    }

    captureStartedAt = performance.now();
    els.recordTimer.textContent = '00:00';
    captureTimerId = window.setInterval(updateCaptureTimer, 500);
    setCaptureUi(true);
    mediaRecorder.start(1000);
    showToast('Захват звука начат');
  } catch (error) {
    console.error(error);
    await releaseCaptureResources();
    setCaptureUi(false);
    const cancelled = error?.name === 'NotAllowedError' || error?.name === 'AbortError';
    const message = cancelled ? 'Захват отменён' : (error?.message || 'Не удалось начать захват звука');
    showToast(message, cancelled ? 'ok' : 'error');
  }
}

function stopCapture() {
  if (!mediaRecorder || captureStopping) return;
  captureStopping = true;
  els.stopCaptureBtn.disabled = true;
  els.captureStatusText.textContent = 'ЗАВЕРШАЮ ЗАПИСЬ…';

  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    finalizeCapture();
  }
}

async function finalizeCapture() {
  const elapsed = captureStartedAt ? (performance.now() - captureStartedAt) / 1000 : 0;
  const recorderType = mediaRecorder?.mimeType || 'audio/webm';
  const chunks = recordedChunks.slice();
  const shouldAutoTranscribe = els.autoTranscribeToggle.checked;

  await releaseCaptureResources();
  setCaptureUi(false);
  els.stopCaptureBtn.disabled = false;
  els.recordTimer.textContent = formatTime(elapsed);
  captureStopping = false;

  if (!chunks.length) {
    showToast('Запись пустая', 'error');
    return;
  }

  const blob = new Blob(chunks, { type: recorderType });
  const ext = recorderType.includes('mp4') ? 'm4a' : recorderType.includes('ogg') ? 'ogg' : 'webm';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = new File([blob], `meeting_${stamp}.${ext}`, { type: recorderType });
  currentDuration = elapsed;
  selectFile(file, 'capture');
  currentDuration = elapsed;
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${formatTime(elapsed)} · ${file.type || 'аудиозапись'}`;
  showToast('Запись разговора сохранена');

  if (shouldAutoTranscribe) {
    await transcribe();
  }
}


function downloadAudioRecording() {
  if (!selectedFile || selectedFileSource !== 'capture') {
    showToast('Записи разговора пока нет', 'error');
    return;
  }

  const url = URL.createObjectURL(selectedFile);
  const link = document.createElement('a');
  link.href = url;
  link.download = selectedFile.name || 'meeting_recording.webm';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyTranscript() {
  const text = els.transcript.value.trim();
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

function downloadTranscript() {
  const text = els.transcript.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');

  const safeBase = (selectedFile?.name || 'transcript')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_')
    .slice(0, 80) || 'transcript';

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeBase}_transcript.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

els.liveModeBtn.addEventListener('click', () => setMode('live'));
els.fileModeBtn.addEventListener('click', () => setMode('file'));
els.startCaptureBtn.addEventListener('click', startCapture);
els.stopCaptureBtn.addEventListener('click', stopCapture);
els.fileInput.addEventListener('change', (event) => selectFile(event.target.files?.[0], 'file'));
els.removeFileBtn.addEventListener('click', clearFile);
els.transcribeBtn.addEventListener('click', transcribe);
els.copyBtn.addEventListener('click', copyTranscript);
els.downloadBtn.addEventListener('click', downloadTranscript);
els.downloadAudioBtn.addEventListener('click', downloadAudioRecording);

for (const type of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    if (!busy) els.dropzone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('dragging');
  });
}
els.dropzone.addEventListener('drop', (event) => {
  if (busy) return;
  selectFile(event.dataTransfer?.files?.[0], 'file');
});

els.audioPreview.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(els.audioPreview.duration)) {
    currentDuration = els.audioPreview.duration;
    els.fileMeta.textContent = `${formatBytes(selectedFile?.size || 0)} · ${formatTime(currentDuration)} · ${selectedFile?.type || 'медиафайл'}`;
  }
});

els.transcript.addEventListener('input', () => {
  const text = els.transcript.value.trim();
  els.wordCount.textContent = String(text ? text.split(/\s+/u).filter(Boolean).length : 0);
});

window.addEventListener('beforeunload', () => {
  stopTracks(displayStream);
  stopTracks(micStream);
  stopTracks(mixedStream);
});
