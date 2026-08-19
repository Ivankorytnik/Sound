import { pipeline, env, AutoProcessor, AutoModel, AutoModelForAudioFrameClassification } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

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
  speakerLabelsToggle: document.querySelector('#speakerLabelsToggle'),
  speakerConfig: document.querySelector('#speakerConfig'),
  mySpeakerName: document.querySelector('#mySpeakerName'),
  speakerName1: document.querySelector('#speakerName1'),
  speakerName2: document.querySelector('#speakerName2'),
  speakerName3: document.querySelector('#speakerName3'),
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

const DIARIZATION_MODEL_ID = 'onnx-community/pyannote-segmentation-3.0';
const SPEAKER_EMBEDDING_MODEL_ID = 'Xenova/wavlm-base-plus-sv';
let diarizationModelsPromise = null;
let lastSpeakerSegments = null;

let displayStream = null;
let micStream = null;
let mixedStream = null;
let audioContext = null;
let mediaRecorder = null;
let systemRecorder = null;
let micRecorder = null;
let recordedChunks = [];
let systemRecordedChunks = [];
let micRecordedChunks = [];
let capturedSpeakerFiles = null;
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

function speakerInputElements() {
  return [els.mySpeakerName, els.speakerName1, els.speakerName2, els.speakerName3].filter(Boolean);
}

function getSpeakerName(speakerKey) {
  if (speakerKey === 'you') return (els.mySpeakerName?.value || 'ВЫ').trim() || 'ВЫ';
  const match = /^remote-(\d+)$/.exec(String(speakerKey || ''));
  if (match) {
    const index = Number(match[1]);
    const input = [els.speakerName1, els.speakerName2, els.speakerName3][index];
    return (input?.value || `СПИКЕР ${index + 1}`).trim() || `СПИКЕР ${index + 1}`;
  }
  return 'СОБЕСЕДНИК';
}

function applySpeakerNames(segments = []) {
  return segments.map((segment) => ({ ...segment, speaker: getSpeakerName(segment.speakerKey) }));
}

function saveSpeakerNames() {
  try {
    localStorage.setItem('speechLabSpeakerNames', JSON.stringify(speakerInputElements().map((input) => input.value)));
  } catch {}
}

function restoreSpeakerNames() {
  try {
    const saved = JSON.parse(localStorage.getItem('speechLabSpeakerNames') || 'null');
    if (!Array.isArray(saved)) return;
    speakerInputElements().forEach((input, index) => {
      if (typeof saved[index] === 'string' && saved[index].trim()) input.value = saved[index].slice(0, 32);
    });
  } catch {}
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
  els.speakerLabelsToggle.disabled = value || Boolean(mediaRecorder);
  for (const input of speakerInputElements()) input.disabled = value || Boolean(mediaRecorder) || !els.speakerLabelsToggle.checked;
  els.speakerConfig?.classList.toggle('disabled', !els.speakerLabelsToggle.checked);
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
  lastSpeakerSegments = null;
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

async function decodeToMono16k(file, updateGlobalDuration = true) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Браузер не поддерживает AudioContext.');

  const context = new AudioContextClass();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    if (updateGlobalDuration) currentDuration = decoded.duration;

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

    if (chunk.speaker) {
      row.classList.add('with-speaker');
      const speaker = document.createElement('div');
      const speakerType = chunk.speakerKey === 'you' ? 'you' : 'remote';
      speaker.className = `segment-speaker speaker-${speakerType}`;
      speaker.textContent = chunk.speaker;
      row.append(time, speaker, text);
    } else {
      row.append(time, text);
    }
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

function getTranscriptionOptions() {
  const options = {
    task: 'transcribe',
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  };
  if (els.languageSelect.value !== 'auto') options.language = els.languageSelect.value;
  return options;
}

function mergeSpeakerSegments(segments) {
  const ordered = segments
    .filter((segment) => segment?.text)
    .sort((a, b) => (a.timestamp?.[0] ?? 0) - (b.timestamp?.[0] ?? 0));

  const merged = [];
  for (const segment of ordered) {
    const start = Number.isFinite(segment.timestamp?.[0]) ? segment.timestamp[0] : 0;
    const end = Number.isFinite(segment.timestamp?.[1]) ? segment.timestamp[1] : start;
    const previous = merged.at(-1);
    const previousEnd = Number.isFinite(previous?.timestamp?.[1]) ? previous.timestamp[1] : previous?.timestamp?.[0] ?? 0;

    if (previous && previous.speakerKey === segment.speakerKey && start - previousEnd <= 1.15) {
      previous.text = appendToken(previous.text, segment.text);
      previous.timestamp[1] = Math.max(previousEnd, end);
    } else {
      merged.push({ ...segment, timestamp: [start, end] });
    }
  }
  return merged;
}

function renderSpeakerResult(rawSegments, duration) {
  lastSpeakerSegments = rawSegments.map((segment) => ({ ...segment, timestamp: [...segment.timestamp] }));
  const segments = applySpeakerNames(lastSpeakerSegments);
  const transcript = segments.map((segment) => {
    const start = Number.isFinite(segment.timestamp?.[0]) ? segment.timestamp[0] : 0;
    return `[${formatTime(start)}] ${segment.speaker}: ${segment.text}`;
  }).join('\n\n');

  els.transcript.value = transcript;
  const speechText = segments.map((segment) => segment.text).join(' ');
  const words = speechText ? speechText.split(/\s+/u).filter(Boolean).length : 0;
  els.wordCount.textContent = String(words);
  els.segmentCount.textContent = String(segments.length);
  els.audioDuration.textContent = formatTime(duration);
  renderSegments(segments);
  els.resultEmpty.classList.add('hidden');
  els.resultBlock.classList.remove('hidden');
}

function rerenderNamedSpeakerResult() {
  if (!lastSpeakerSegments?.length) return;
  const duration = currentDuration;
  const raw = lastSpeakerSegments.map((segment) => ({ ...segment, timestamp: [...segment.timestamp] }));
  renderSpeakerResult(raw, duration);
}

function appendToken(base, token) {
  const left = String(base || '').trim();
  const right = String(token || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (/^[,.;:!?…%)\]}»]/u.test(right)) return `${left}${right}`;
  if (/[\[(«]$/u.test(left)) return `${left}${right}`;
  return `${left} ${right}`;
}

function wordTimestampOptions() {
  const options = {
    task: 'transcribe',
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
  };
  if (els.languageSelect.value !== 'auto') options.language = els.languageSelect.value;
  return options;
}

async function getDiarizationModels() {
  if (diarizationModelsPromise) return diarizationModelsPromise;

  const progressCallback = (data) => {
    if (!data) return;
    if (data.status === 'progress' && Number.isFinite(data.progress)) {
      const mapped = 18 + Math.max(0, Math.min(100, data.progress)) * 0.10;
      setProgress(mapped, 'Загружаю модели голосов', data.file ? `Файл: ${data.file}` : 'PyAnnote + WavLM');
    }
  };

  diarizationModelsPromise = Promise.all([
    AutoProcessor.from_pretrained(DIARIZATION_MODEL_ID, { progress_callback: progressCallback }),
    AutoModelForAudioFrameClassification.from_pretrained(DIARIZATION_MODEL_ID, {
      device: 'wasm',
      dtype: 'fp32',
      progress_callback: progressCallback,
    }),
    AutoProcessor.from_pretrained(SPEAKER_EMBEDDING_MODEL_ID, { progress_callback: progressCallback }),
    AutoModel.from_pretrained(SPEAKER_EMBEDDING_MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: progressCallback,
    }),
  ]).catch((error) => {
    diarizationModelsPromise = null;
    throw error;
  });

  return diarizationModelsPromise;
}

function normalizeVector(values) {
  const source = Array.from(values || [], Number);
  let norm = 0;
  for (const value of source) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(source, (value) => value / norm);
}

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function updateCentroid(cluster, embedding) {
  if (!cluster.centroid) {
    cluster.centroid = Float32Array.from(embedding);
    cluster.count = 1;
    return;
  }
  const nextCount = cluster.count + 1;
  for (let i = 0; i < cluster.centroid.length; i++) {
    cluster.centroid[i] = ((cluster.centroid[i] * cluster.count) + embedding[i]) / nextCount;
  }
  cluster.centroid = normalizeVector(cluster.centroid);
  cluster.count = nextCount;
}

function assignGlobalSpeaker(embedding, clusters, maxSpeakers = 3) {
  if (!clusters.length) {
    clusters.push({ centroid: Float32Array.from(embedding), count: 1 });
    return 0;
  }

  let bestIndex = 0;
  let bestScore = -Infinity;
  clusters.forEach((cluster, index) => {
    const score = cosineSimilarity(embedding, cluster.centroid);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  // Speaker-verification scores vary by microphone and codec. This threshold is
  // intentionally conservative; once all configured speakers exist, choose the
  // closest voice instead of inventing a fourth participant.
  const sameSpeakerThreshold = 0.76;
  if (bestScore < sameSpeakerThreshold && clusters.length < maxSpeakers) {
    clusters.push({ centroid: Float32Array.from(embedding), count: 1 });
    return clusters.length - 1;
  }

  updateCentroid(clusters[bestIndex], embedding);
  return bestIndex;
}

function concatFloat32(parts, maxSamples) {
  const total = Math.min(maxSamples, parts.reduce((sum, part) => sum + part.length, 0));
  const output = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    if (offset >= total) break;
    const take = Math.min(part.length, total - offset);
    output.set(part.subarray(0, take), offset);
    offset += take;
  }
  return output;
}

function buildVoiceSample(chunkAudio, localSegments, sampleRate = 16000) {
  const parts = localSegments
    .map((segment) => {
      const start = Math.max(0, Math.floor(segment.start * sampleRate));
      const end = Math.min(chunkAudio.length, Math.ceil(segment.end * sampleRate));
      return chunkAudio.slice(start, end);
    })
    .filter((part) => part.length >= Math.floor(sampleRate * 0.18))
    .sort((a, b) => b.length - a.length);

  return concatFloat32(parts, sampleRate * 3.2);
}

async function computeSpeakerEmbedding(audio, processor, model) {
  if (!audio?.length || audio.length < 4800) return null;
  const inputs = await processor(audio);
  const outputs = await model(inputs);
  const values = outputs?.embeddings?.data || outputs?.logits?.data;
  if (!values?.length) return null;
  return normalizeVector(values);
}

function mergeDiarizationSegments(segments) {
  const sorted = segments
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const segment of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.speakerKey === segment.speakerKey && segment.start - previous.end <= 0.22) {
      previous.end = Math.max(previous.end, segment.end);
      previous.confidence = Math.max(previous.confidence || 0, segment.confidence || 0);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

async function diarizeRemoteAudio(audio, maxSpeakers = 3) {
  const [segmentationProcessor, segmentationModel, embeddingProcessor, embeddingModel] = await getDiarizationModels();
  const sampleRate = 16000;
  const chunkSamples = sampleRate * 10;
  const totalChunks = Math.max(1, Math.ceil(audio.length / chunkSamples));
  const globalClusters = [];
  const globalSegments = [];

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const sampleStart = chunkIndex * chunkSamples;
    const sampleEnd = Math.min(audio.length, sampleStart + chunkSamples);
    const chunkAudio = audio.slice(sampleStart, sampleEnd);
    const offsetSeconds = sampleStart / sampleRate;

    setProgress(
      30 + ((chunkIndex + 1) / totalChunks) * 30,
      'Разделяю голоса',
      `Фрагмент ${chunkIndex + 1} из ${totalChunks} · связываю одинаковые голоса между фрагментами`,
    );

    const modelAudio = chunkAudio.length === chunkSamples
      ? chunkAudio
      : (() => {
          const padded = new Float32Array(chunkSamples);
          padded.set(chunkAudio);
          return padded;
        })();
    const inputs = await segmentationProcessor(modelAudio);
    const { logits } = await segmentationModel(inputs);
    const result = segmentationProcessor.post_process_speaker_diarization(logits, chunkAudio.length)?.[0] || [];
    const usable = result.filter((segment) =>
      Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) &&
      segment.end - segment.start >= 0.16 &&
      (segment.confidence ?? 1) >= 0.30
    );

    const byLocalSpeaker = new Map();
    for (const segment of usable) {
      const key = String(segment.id);
      if (!byLocalSpeaker.has(key)) byLocalSpeaker.set(key, []);
      byLocalSpeaker.get(key).push(segment);
    }

    for (const localSegments of byLocalSpeaker.values()) {
      const voiceSample = buildVoiceSample(chunkAudio, localSegments, sampleRate);
      const embedding = await computeSpeakerEmbedding(voiceSample, embeddingProcessor, embeddingModel);
      if (!embedding) continue;
      const globalSpeaker = assignGlobalSpeaker(embedding, globalClusters, maxSpeakers);

      for (const segment of localSegments) {
        globalSegments.push({
          start: offsetSeconds + segment.start,
          end: offsetSeconds + segment.end,
          speakerKey: `remote-${globalSpeaker}`,
          confidence: segment.confidence,
        });
      }
    }
  }

  return mergeDiarizationSegments(globalSegments);
}

function findSpeakerForInterval(start, end, diarizationSegments) {
  const safeStart = Number.isFinite(start) ? start : 0;
  const safeEnd = Number.isFinite(end) ? end : safeStart;
  const midpoint = (safeStart + safeEnd) / 2;
  let best = null;
  let bestOverlap = -1;

  for (const segment of diarizationSegments) {
    const overlap = Math.max(0, Math.min(safeEnd, segment.end) - Math.max(safeStart, segment.start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = segment;
    }
  }

  if (bestOverlap > 0) return best?.speakerKey || 'remote-0';

  let nearest = null;
  let nearestDistance = Infinity;
  for (const segment of diarizationSegments) {
    const distance = midpoint < segment.start ? segment.start - midpoint : midpoint > segment.end ? midpoint - segment.end : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = segment;
    }
  }
  return nearestDistance <= 1.2 ? (nearest?.speakerKey || 'remote-0') : 'remote-0';
}

function wordsToSpeakerSegments(output, diarizationSegments, fallbackSpeakerKey = 'remote-0') {
  const words = Array.isArray(output?.chunks) ? output.chunks : [];
  const text = String(output?.text || '').trim();
  if (!words.length) {
    return text ? [{ text, timestamp: [0, currentDuration || null], speakerKey: fallbackSpeakerKey }] : [];
  }

  const tagged = words
    .map((word) => {
      const start = Number.isFinite(word?.timestamp?.[0]) ? word.timestamp[0] : 0;
      const end = Number.isFinite(word?.timestamp?.[1]) ? word.timestamp[1] : start;
      return {
        text: String(word?.text || '').trim(),
        timestamp: [start, end],
        speakerKey: diarizationSegments?.length
          ? findSpeakerForInterval(start, end, diarizationSegments)
          : fallbackSpeakerKey,
      };
    })
    .filter((word) => word.text);

  return mergeSpeakerSegments(tagged);
}

async function transcribeWithWordTimestamps(transcriber, audio) {
  try {
    return await transcriber(audio, wordTimestampOptions());
  } catch (error) {
    console.warn('Word timestamps unavailable, falling back to segment timestamps.', error);
    return transcriber(audio, getTranscriptionOptions());
  }
}

async function transcribeSpeakerFiles() {
  if (!capturedSpeakerFiles?.system || busy || mediaRecorder) return;
  setBusy(true);
  resetResult();

  try {
    const systemFile = capturedSpeakerFiles.system;
    const micFile = capturedSpeakerFiles.mic;
    const duration = capturedSpeakerFiles.duration || currentDuration;

    setProgress(3, 'Готовлю дорожки', 'Отдельно читаю звук встречи и ваш микрофон.');
    const systemAudio = await decodeToMono16k(systemFile, false);
    let micAudio = null;
    if (micFile) micAudio = await decodeToMono16k(micFile, false);

    setProgress(10, 'Загружаю Whisper', 'После Whisper загрузятся модели разделения голосов.');
    const transcriber = await getTranscriber(els.modelSelect.value);

    let diarizationSegments = [];
    let diarizationWarning = '';
    try {
      setProgress(18, 'Загружаю модели голосов', 'PyAnnote определит смену голосов, WavLM свяжет одинаковых людей между фрагментами.');
      diarizationSegments = await diarizeRemoteAudio(systemAudio, 3);
      if (!diarizationSegments.length) throw new Error('Не найдено устойчивых голосовых сегментов.');
    } catch (error) {
      console.error('Speaker diarization failed', error);
      diarizationWarning = error?.message || 'Разделение удалённых голосов недоступно.';
      diarizationSegments = [];
    }

    setProgress(66, 'Распознаю встречу', diarizationSegments.length ? 'Привязываю слова Whisper к найденным голосам.' : 'Распознаю без разделения удалённых голосов.');
    const systemOutput = await transcribeWithWordTimestamps(transcriber, systemAudio);
    const remoteSegments = wordsToSpeakerSegments(
      systemOutput,
      diarizationSegments,
      diarizationSegments.length ? 'remote-0' : 'remote-unknown',
    );

    const allSegments = [...remoteSegments];
    if (micAudio) {
      setProgress(86, 'Распознаю ваш микрофон', `Дорожка будет помечена как «${getSpeakerName('you')}».`);
      const micOutput = await transcribeWithWordTimestamps(transcriber, micAudio);
      allSegments.push(...wordsToSpeakerSegments(micOutput, [], 'you'));
    }

    const merged = mergeSpeakerSegments(allSegments);
    const detectedRemote = new Set(diarizationSegments.map((segment) => segment.speakerKey)).size;
    const note = diarizationWarning
      ? `Текст готов, но голоса разделить не удалось: ${diarizationWarning}`
      : `Определено удалённых голосов: ${detectedRemote || 1}. Проверь имена по первым репликам.`;
    setProgress(100, 'Готово', note);
    renderSpeakerResult(merged, duration);
    showToast(diarizationWarning ? 'Текст готов, но проверь разделение голосов' : 'Говорящие разделены по голосам', diarizationWarning ? 'error' : 'ok');
  } catch (error) {
    console.error(error);
    const message = error?.message || 'Не удалось разделить говорящих.';
    setProgress(0, 'Ошибка', message);
    showToast(message, 'error');
  } finally {
    setBusy(false);
  }
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
    const options = getTranscriptionOptions();
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

function createAudioRecorder(stream, chunks, mimeType) {
  if (!stream?.getAudioTracks().length) return null;
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
    : new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) chunks.push(event.data);
  });
  return recorder;
}

function stopRecorderAndWait(recorder) {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve();
  return new Promise((resolve) => {
    recorder.addEventListener('stop', resolve, { once: true });
    try {
      recorder.stop();
    } catch {
      resolve();
    }
  });
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
  systemRecorder = null;
  micRecorder = null;
  captureStartedAt = 0;
}

function setCaptureUi(active) {
  els.startCaptureBtn.classList.toggle('hidden', active);
  els.stopCaptureBtn.classList.toggle('hidden', !active);
  els.liveModeBtn.disabled = active || busy;
  els.fileModeBtn.disabled = active || busy;
  els.micToggle.disabled = active;
  els.autoTranscribeToggle.disabled = active;
  els.speakerLabelsToggle.disabled = active;
  for (const input of speakerInputElements()) input.disabled = active || busy || !els.speakerLabelsToggle.checked;
  els.speakerConfig?.classList.toggle('disabled', !els.speakerLabelsToggle.checked);
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
  systemRecordedChunks = [];
  micRecordedChunks = [];
  capturedSpeakerFiles = null;
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
    mediaRecorder = createAudioRecorder(mixedStream, recordedChunks, mimeType);
    systemRecorder = createAudioRecorder(new MediaStream(displayAudioTracks), systemRecordedChunks, mimeType);
    micRecorder = micStream?.getAudioTracks().length
      ? createAudioRecorder(new MediaStream(micStream.getAudioTracks()), micRecordedChunks, mimeType)
      : null;

    for (const recorder of [mediaRecorder, systemRecorder, micRecorder].filter(Boolean)) {
      recorder.addEventListener('error', (event) => {
        console.error('MediaRecorder error', event.error || event);
        showToast('Ошибка записи звука', 'error');
      });
    }

    for (const track of displayStream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (mediaRecorder?.state === 'recording') stopCapture();
      }, { once: true });
    }

    captureStartedAt = performance.now();
    els.recordTimer.textContent = '00:00';
    captureTimerId = window.setInterval(updateCaptureTimer, 500);
    setCaptureUi(true);
    systemRecorder?.start(1000);
    micRecorder?.start(1000);
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

async function stopCapture() {
  if (!mediaRecorder || captureStopping) return;
  captureStopping = true;
  els.stopCaptureBtn.disabled = true;
  els.captureStatusText.textContent = 'ЗАВЕРШАЮ ЗАПИСЬ…';

  await Promise.all([
    stopRecorderAndWait(mediaRecorder),
    stopRecorderAndWait(systemRecorder),
    stopRecorderAndWait(micRecorder),
  ]);
  await finalizeCapture();
}

async function finalizeCapture() {
  const elapsed = captureStartedAt ? (performance.now() - captureStartedAt) / 1000 : 0;
  const recorderType = mediaRecorder?.mimeType || 'audio/webm';
  const systemType = systemRecorder?.mimeType || recorderType;
  const micType = micRecorder?.mimeType || recorderType;
  const chunks = recordedChunks.slice();
  const systemChunks = systemRecordedChunks.slice();
  const micChunks = micRecordedChunks.slice();
  const shouldAutoTranscribe = els.autoTranscribeToggle.checked;
  const shouldLabelSpeakers = els.speakerLabelsToggle.checked;

  await releaseCaptureResources();
  setCaptureUi(false);
  els.stopCaptureBtn.disabled = false;
  els.recordTimer.textContent = formatTime(elapsed);
  captureStopping = false;

  if (!chunks.length) {
    showToast('Запись пустая', 'error');
    return;
  }

  const extForType = (type) => type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob(chunks, { type: recorderType });
  const file = new File([blob], `meeting_${stamp}.${extForType(recorderType)}`, { type: recorderType });

  const systemFile = systemChunks.length
    ? new File([new Blob(systemChunks, { type: systemType })], `meeting_remote_${stamp}.${extForType(systemType)}`, { type: systemType })
    : null;
  const micFile = micChunks.length
    ? new File([new Blob(micChunks, { type: micType })], `meeting_you_${stamp}.${extForType(micType)}`, { type: micType })
    : null;

  capturedSpeakerFiles = { system: systemFile, mic: micFile, mixed: file, duration: elapsed };
  currentDuration = elapsed;
  selectFile(file, 'capture');
  currentDuration = elapsed;
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${formatTime(elapsed)} · ${file.type || 'аудиозапись'}`;
  showToast('Запись разговора сохранена');

  if (shouldAutoTranscribe) {
    if (shouldLabelSpeakers && systemFile) await transcribeSpeakerFiles();
    else await transcribe();
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
els.transcribeBtn.addEventListener('click', () => {
  if (selectedFileSource === 'capture' && capturedSpeakerFiles?.system && els.speakerLabelsToggle.checked) {
    transcribeSpeakerFiles();
  } else {
    transcribe();
  }
});
els.speakerLabelsToggle.addEventListener('change', () => {
  els.speakerConfig?.classList.toggle('disabled', !els.speakerLabelsToggle.checked);
  for (const input of speakerInputElements()) input.disabled = busy || Boolean(mediaRecorder) || !els.speakerLabelsToggle.checked;
});
for (const input of speakerInputElements()) {
  input.addEventListener('change', () => {
    saveSpeakerNames();
    rerenderNamedSpeakerResult();
    if (lastSpeakerSegments?.length) showToast('Имена в стенограмме обновлены');
  });
}

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

restoreSpeakerNames();
els.speakerConfig?.classList.toggle('disabled', !els.speakerLabelsToggle.checked);
for (const input of speakerInputElements()) input.disabled = !els.speakerLabelsToggle.checked;

window.addEventListener('beforeunload', () => {
  stopTracks(displayStream);
  stopTracks(micStream);
  stopTracks(mixedStream);
  for (const recorder of [mediaRecorder, systemRecorder, micRecorder]) {
    if (recorder?.state === 'recording') { try { recorder.stop(); } catch {} }
  }
});
