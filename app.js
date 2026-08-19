import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;

const els = {
  fileInput: document.querySelector('#fileInput'),
  dropzone: document.querySelector('#dropzone'),
  fileCard: document.querySelector('#fileCard'),
  fileName: document.querySelector('#fileName'),
  fileMeta: document.querySelector('#fileMeta'),
  removeFileBtn: document.querySelector('#removeFileBtn'),
  audioPreview: document.querySelector('#audioPreview'),
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
};

let selectedFile = null;
let previewUrl = null;
let currentDuration = 0;
let busy = false;
const transcriberCache = new Map();

function showToast(message, type = 'ok') {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', type === 'error');
  els.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove('show'), 2200);
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
  els.transcribeBtnText.textContent = value ? 'ОБРАБАТЫВАЮ…' : 'РАСПОЗНАТЬ РЕЧЬ';
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
  if (busy) return;
  selectedFile = null;
  currentDuration = 0;
  els.fileInput.value = '';
  els.fileCard.classList.add('hidden');
  els.audioPreview.classList.add('hidden');
  els.audioPreview.removeAttribute('src');
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

function selectFile(file) {
  if (!file) return;
  if (!looksLikeMedia(file)) {
    showToast('Нужен аудио- или видеофайл', 'error');
    return;
  }

  selectedFile = file;
  resetResult();
  els.progressWrap.classList.add('hidden');
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
  els.fileCard.classList.remove('hidden');
  els.transcribeBtn.disabled = false;

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  els.audioPreview.src = previewUrl;
  els.audioPreview.classList.remove('hidden');
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

  const audioContext = new AudioContextClass();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    currentDuration = decoded.duration;

    const mono = new Float32Array(decoded.length);
    const channelCount = decoded.numberOfChannels;

    for (let channel = 0; channel < channelCount; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / channelCount;
    }

    return resampleLinear(mono, decoded.sampleRate, 16000);
  } catch (error) {
    throw new Error('Не удалось прочитать аудиодорожку. Попробуй MP3, WAV, M4A или WEBM.');
  } finally {
    await audioContext.close().catch(() => {});
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
  if (!selectedFile || busy) return;
  setBusy(true);
  resetResult();

  try {
    setProgress(3, 'Читаю файл', 'Извлекаю аудио и привожу его к формату 16 кГц mono.');
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
    const message = error?.message || 'Не удалось распознать файл.';
    setProgress(0, 'Ошибка', message);
    showToast(message, 'error');
  } finally {
    setBusy(false);
  }
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

els.fileInput.addEventListener('change', (event) => selectFile(event.target.files?.[0]));
els.removeFileBtn.addEventListener('click', clearFile);
els.transcribeBtn.addEventListener('click', transcribe);
els.copyBtn.addEventListener('click', copyTranscript);
els.downloadBtn.addEventListener('click', downloadTranscript);

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
  selectFile(event.dataTransfer?.files?.[0]);
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
