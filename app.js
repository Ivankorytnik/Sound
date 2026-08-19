import {
  pipeline,
  env,
  AutoProcessor,
  AutoModel,
  AutoModelForAudioFrameClassification,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;

const $ = (selector) => document.querySelector(selector);
const els = {
  fileInput: $('#fileInput'), dropzone: $('#dropzone'), fileCard: $('#fileCard'), fileLabel: $('#fileLabel'),
  fileName: $('#fileName'), fileMeta: $('#fileMeta'), removeFileBtn: $('#removeFileBtn'), audioPreview: $('#audioPreview'),
  languageSelect: $('#languageSelect'), modelSelect: $('#modelSelect'), qualitySelect: $('#qualitySelect'), cleanupSelect: $('#cleanupSelect'), transcribeBtn: $('#transcribeBtn'),
  transcribeBtnText: $('#transcribeBtnText'), progressWrap: $('#progressWrap'), progressBar: $('#progressBar'),
  progressValue: $('#progressValue'), statusText: $('#statusText'), statusNote: $('#statusNote'), resultEmpty: $('#resultEmpty'),
  resultBlock: $('#resultBlock'), transcript: $('#transcript'), wordCount: $('#wordCount'), segmentCount: $('#segmentCount'),
  audioDuration: $('#audioDuration'), segmentsList: $('#segmentsList'), segmentsBox: $('#segmentsBox'), copyBtn: $('#copyBtn'),
  downloadBtn: $('#downloadBtn'), toast: $('#toast'),

  liveModeBtn: $('#liveModeBtn'), fileModeBtn: $('#fileModeBtn'), liveMode: $('#liveMode'), fileMode: $('#fileMode'),
  autoCaptureToggle: $('#autoCaptureToggle'), captureModeBadge: $('#captureModeBadge'), captureModeHint: $('#captureModeHint'),
  manualSourceWrap: $('#manualSourceWrap'), manualSourceSelect: $('#manualSourceSelect'), lastSourceText: $('#lastSourceText'),
  micToggle: $('#micToggle'), autoTranscribeToggle: $('#autoTranscribeToggle'), speakerLabelsToggle: $('#speakerLabelsToggle'),
  speakerConfig: $('#speakerConfig'), mySpeakerName: $('#mySpeakerName'), speakerName1: $('#speakerName1'),
  speakerName2: $('#speakerName2'), speakerName3: $('#speakerName3'), captureStatus: $('#captureStatus'),
  captureStatusText: $('#captureStatusText'), recordTimer: $('#recordTimer'), systemIndicator: $('#systemIndicator'),
  systemStatus: $('#systemStatus'), micIndicator: $('#micIndicator'), micStatus: $('#micStatus'),
  startCaptureBtn: $('#startCaptureBtn'), startCaptureBtnText: $('#startCaptureBtnText'), stopCaptureBtn: $('#stopCaptureBtn'),
  downloadAudioBtn: $('#downloadAudioBtn'),
};

const STORAGE = {
  auto: 'speech-lab:auto-capture',
  source: 'speech-lab:last-source',
  names: 'speech-lab:speaker-names',
};

let selectedFile = null;
let previewUrl = null;
let currentDuration = 0;
let busy = false;
let activeMode = 'live';
let lastStructuredSegments = [];
let captureSession = null;
let recordingBlob = null;
let recordingFilename = 'speech-lab-recording.webm';

const transcriberCache = new Map();
let diarizationAssets = null;

function showToast(message, type = 'ok') {
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
  return h
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
  els.qualitySelect.disabled = value;
  els.cleanupSelect.disabled = value;
  els.removeFileBtn.disabled = value;
  els.startCaptureBtn.disabled = value || Boolean(captureSession);
  els.transcribeBtnText.textContent = value ? 'ОБРАБАТЫВАЮ…' : 'РАСПОЗНАТЬ РЕЧЬ';
}

function resetResult() {
  lastStructuredSegments = [];
  els.resultEmpty.classList.remove('hidden');
  els.resultBlock.classList.add('hidden');
  els.transcript.value = '';
  els.wordCount.textContent = '0';
  els.segmentCount.textContent = '0';
  els.audioDuration.textContent = '—';
  els.segmentsList.innerHTML = '';
  els.segmentsBox.open = false;
}

function sourceName(surface) {
  if (surface === 'window') return 'окно приложения';
  if (surface === 'monitor') return 'экран';
  return 'вкладка браузера';
}

function readSpeakerNames() {
  return {
    you: (els.mySpeakerName.value || 'ВЫ').trim(),
    'remote-0': (els.speakerName1.value || 'Спикер 1').trim(),
    'remote-1': (els.speakerName2.value || 'Спикер 2').trim(),
    'remote-2': (els.speakerName3.value || 'Спикер 3').trim(),
    remote: 'Собеседник',
  };
}

function saveSpeakerNames() {
  const names = [els.mySpeakerName.value, els.speakerName1.value, els.speakerName2.value, els.speakerName3.value];
  localStorage.setItem(STORAGE.names, JSON.stringify(names));
  rerenderStructuredTranscript();
}

function loadSpeakerNames() {
  try {
    const names = JSON.parse(localStorage.getItem(STORAGE.names) || 'null');
    if (Array.isArray(names) && names.length === 4) {
      [els.mySpeakerName.value, els.speakerName1.value, els.speakerName2.value, els.speakerName3.value] = names;
    }
  } catch { /* ignore */ }
}

function renderSegments(chunks = []) {
  els.segmentsList.innerHTML = '';
  if (!Array.isArray(chunks) || chunks.length === 0) {
    els.segmentsBox.classList.add('hidden');
    return;
  }
  els.segmentsBox.classList.remove('hidden');
  const names = readSpeakerNames();

  for (const chunk of chunks) {
    const row = document.createElement('div');
    row.className = 'segment';
    if (chunk.suspicious) row.classList.add('suspicious');

    const time = document.createElement('div');
    time.className = 'segment-time';
    const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] : chunk.start;
    const end = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] : chunk.end;
    time.textContent = `${formatTime(start)}${Number.isFinite(end) ? `–${formatTime(end)}` : ''}`;

    const text = document.createElement('div');
    text.className = 'segment-text';
    if (chunk.speakerKey) {
      const speaker = document.createElement('strong');
      speaker.className = 'segment-speaker';
      speaker.textContent = `${names[chunk.speakerKey] || chunk.speakerKey}: `;
      text.append(speaker, document.createTextNode(String(chunk.text || '').trim()));
    } else {
      text.textContent = String(chunk.text || '').trim();
    }
    row.append(time, text);
    els.segmentsList.append(row);
  }
}

function renderPlainResult(output) {
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

function renderStructuredResult(segments) {
  lastStructuredSegments = [...segments].sort((a, b) => a.start - b.start);
  rerenderStructuredTranscript();
  els.resultEmpty.classList.add('hidden');
  els.resultBlock.classList.remove('hidden');
}

function rerenderStructuredTranscript() {
  if (!lastStructuredSegments.length) return;
  const names = readSpeakerNames();
  els.transcript.value = lastStructuredSegments
    .map((s) => `[${formatTime(s.start)}] ${names[s.speakerKey] || s.speakerKey}: ${String(s.text || '').trim()}`)
    .join('\n\n');
  const text = els.transcript.value.trim();
  els.wordCount.textContent = String(text ? text.split(/\s+/u).filter(Boolean).length : 0);
  els.segmentCount.textContent = String(lastStructuredSegments.length);
  els.audioDuration.textContent = formatTime(currentDuration);
  renderSegments(lastStructuredSegments);
}

function revokePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function setSelectedFile(file, label = 'ФАЙЛ') {
  selectedFile = file;
  resetResult();
  els.progressWrap.classList.add('hidden');
  els.fileLabel.textContent = label;
  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
  els.fileCard.classList.remove('hidden');
  els.transcribeBtn.disabled = busy;
  revokePreview();
  previewUrl = URL.createObjectURL(file);
  els.audioPreview.src = previewUrl;
  els.audioPreview.classList.remove('hidden');
}

function clearFile() {
  if (busy || captureSession) return;
  selectedFile = null;
  currentDuration = 0;
  els.fileInput.value = '';
  els.fileCard.classList.add('hidden');
  els.audioPreview.classList.add('hidden');
  els.audioPreview.removeAttribute('src');
  revokePreview();
  els.transcribeBtn.disabled = true;
  els.progressWrap.classList.add('hidden');
  resetResult();
}

function looksLikeMedia(file) {
  const extOk = /\.(mp3|wav|m4a|aac|ogg|webm|mp4|mpeg|mpga)$/i.test(file.name);
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || extOk;
}

function selectFile(file) {
  if (!file) return;
  if (!looksLikeMedia(file)) return showToast('Нужен аудио- или видеофайл', 'error');
  setSelectedFile(file);
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
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return { audio: resampleLinear(mono, decoded.sampleRate, 16000), duration: decoded.duration };
  } catch {
    throw new Error('Не удалось прочитать аудиодорожку. Попробуй MP3, WAV, M4A или WEBM.');
  } finally {
    await audioContext.close().catch(() => {});
  }
}

async function getTranscriber(modelId) {
  if (transcriberCache.has(modelId)) return transcriberCache.get(modelId);
  setProgress(12, 'Загружаю AI-модель', 'Скачивается только модель. Аудио остаётся в браузере.');
  const transcriber = await pipeline('automatic-speech-recognition', modelId, {
    progress_callback: (data) => {
      if (data?.status === 'progress' && Number.isFinite(data.progress)) {
        const mapped = 12 + Math.max(0, Math.min(100, data.progress)) * 0.43;
        setProgress(mapped, 'Загружаю AI-модель', data.file ? `Файл модели: ${data.file}` : 'Подготовка модели…');
      } else if (data?.status === 'ready') {
        setProgress(56, 'Модель готова', 'Модель работает локально в этой вкладке.');
      }
    },
  });
  transcriberCache.set(modelId, transcriber);
  return transcriber;
}

const QUALITY_PRESETS = {
  noisy: {
    label: 'шумная/старая запись',
    maxWindowSeconds: 18,
    minSpeechSeconds: 0.42,
    mergeGapSeconds: 0.55,
    padSeconds: 0.28,
    energyMultiplier: 2.7,
    minEnergy: 0.0035,
    noRepeatNgram: 4,
    repetitionPenalty: 1.12,
    verifySuspicious: true,
  },
  accurate: {
    label: 'обычная запись',
    maxWindowSeconds: 24,
    minSpeechSeconds: 0.32,
    mergeGapSeconds: 0.42,
    padSeconds: 0.22,
    energyMultiplier: 2.35,
    minEnergy: 0.0028,
    noRepeatNgram: 4,
    repetitionPenalty: 1.08,
    verifySuspicious: true,
  },
  fast: {
    label: 'быстрый режим',
    maxWindowSeconds: 30,
    minSpeechSeconds: 0,
    mergeGapSeconds: 0,
    padSeconds: 0,
    energyMultiplier: 0,
    minEnergy: 0,
    noRepeatNgram: 3,
    repetitionPenalty: 1.04,
    verifySuspicious: false,
  },
};

function qualityConfig() {
  return QUALITY_PRESETS[els.qualitySelect?.value] || QUALITY_PRESETS.noisy;
}

function asrOptions(extra = {}) {
  const cfg = qualityConfig();
  const options = {
    task: 'transcribe',
    return_timestamps: true,
    do_sample: false,
    top_k: 0,
    no_repeat_ngram_size: cfg.noRepeatNgram,
    repetition_penalty: cfg.repetitionPenalty,
    ...extra,
  };
  if (els.languageSelect.value !== 'auto') options.language = els.languageSelect.value;
  return options;
}

function normalizeAudio(input) {
  if (!input?.length) return input;
  const out = new Float32Array(input.length);
  let mean = 0;
  for (let i = 0; i < input.length; i++) mean += input[i];
  mean /= input.length;
  let peak = 0;
  for (let i = 0; i < input.length; i++) {
    const v = input[i] - mean;
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak < 1e-5) return out;
  const gain = Math.min(3.2, 0.92 / peak);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * gain));
  return out;
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function frameRms(audio, start, end) {
  let sum = 0;
  const stop = Math.min(audio.length, end);
  const n = Math.max(1, stop - start);
  for (let i = start; i < stop; i++) sum += audio[i] * audio[i];
  return Math.sqrt(sum / n);
}

function detectSpeechRegions(audio, cfg) {
  const sampleRate = 16000;
  const frameSamples = Math.round(sampleRate * 0.03);
  const energies = [];
  for (let start = 0; start < audio.length; start += frameSamples) {
    energies.push(frameRms(audio, start, start + frameSamples));
  }
  if (!energies.length) return [];

  const noiseFloor = percentile(energies, 0.18);
  const high = Math.max(cfg.minEnergy, noiseFloor * cfg.energyMultiplier);
  const low = Math.max(cfg.minEnergy * 0.68, noiseFloor * Math.max(1.55, cfg.energyMultiplier * 0.62));
  const startFrames = 3;
  const endFrames = 11;
  const raw = [];
  let active = false;
  let above = 0;
  let below = 0;
  let startFrame = 0;

  for (let i = 0; i < energies.length; i++) {
    const e = energies[i];
    if (!active) {
      above = e >= high ? above + 1 : 0;
      if (above >= startFrames) {
        active = true;
        startFrame = Math.max(0, i - startFrames + 1);
        below = 0;
      }
    } else {
      below = e < low ? below + 1 : 0;
      if (below >= endFrames) {
        const endFrame = Math.max(startFrame + 1, i - below + 1);
        raw.push([startFrame * frameSamples / sampleRate, endFrame * frameSamples / sampleRate]);
        active = false;
        above = 0;
        below = 0;
      }
    }
  }
  if (active) raw.push([startFrame * frameSamples / sampleRate, audio.length / sampleRate]);

  const minLen = cfg.minSpeechSeconds;
  const padded = raw
    .filter(([a, b]) => b - a >= minLen)
    .map(([a, b]) => [Math.max(0, a - cfg.padSeconds), Math.min(audio.length / sampleRate, b + cfg.padSeconds)]);

  const merged = [];
  for (const region of padded) {
    const prev = merged[merged.length - 1];
    if (prev && region[0] - prev[1] <= cfg.mergeGapSeconds) prev[1] = Math.max(prev[1], region[1]);
    else merged.push([...region]);
  }

  const speechSeconds = merged.reduce((sum, [a, b]) => sum + (b - a), 0);
  const duration = audio.length / sampleRate;
  if (!merged.length || speechSeconds < Math.min(0.8, duration * 0.015)) return [];
  return merged;
}

function splitRegions(regions, maxWindowSeconds) {
  const windows = [];
  for (const [start, end] of regions) {
    let cursor = start;
    while (cursor < end - 0.05) {
      const stop = Math.min(end, cursor + maxWindowSeconds);
      windows.push([cursor, stop]);
      cursor = stop;
    }
  }
  return windows;
}

function normalizeToken(token) {
  return String(token || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function sameTokenSlice(tokens, a, b, n) {
  for (let j = 0; j < n; j++) {
    if (normalizeToken(tokens[a + j]) !== normalizeToken(tokens[b + j])) return false;
  }
  return true;
}

function collapseRepeatedSentences(text) {
  const parts = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/gu) || [];
  if (parts.length < 3) return String(text || '').trim();
  const out = [];
  let previousKey = '';
  let consecutive = 0;
  for (const part of parts) {
    const key = part.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (key && key === previousKey) {
      consecutive++;
      if (consecutive >= 2) continue;
    } else {
      previousKey = key;
      consecutive = 0;
    }
    out.push(part.trim());
  }
  return out.join(' ').trim();
}

function collapseRepeatedNgrams(text) {
  let tokens = String(text || '').trim().split(/\s+/u).filter(Boolean);
  if (tokens.length < 4) return tokens.join(' ');

  for (let n = 12; n >= 1; n--) {
    const out = [];
    for (let i = 0; i < tokens.length;) {
      if (i + n > tokens.length) { out.push(...tokens.slice(i)); break; }
      let repeats = 1;
      while (i + (repeats + 1) * n <= tokens.length && sameTokenSlice(tokens, i, i + repeats * n, n)) repeats++;
      const threshold = n === 1 ? 4 : 3;
      if (repeats >= threshold) {
        const keepRepeats = n === 1 ? 2 : 1;
        out.push(...tokens.slice(i, i + n * keepRepeats));
        i += n * repeats;
      } else {
        out.push(tokens[i]);
        i++;
      }
    }
    tokens = out;
  }
  return tokens.join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([!?.,])\1{2,}/g, '$1');
}

function repetitionMetrics(text) {
  const words = String(text || '').split(/\s+/u).map(normalizeToken).filter(Boolean);
  if (!words.length) return { score: 0, words: 0, uniqueRatio: 1, dominantRatio: 0 };
  const counts = new Map();
  let maxCount = 0;
  for (const word of words) {
    const c = (counts.get(word) || 0) + 1;
    counts.set(word, c);
    maxCount = Math.max(maxCount, c);
  }
  const uniqueRatio = counts.size / words.length;
  const dominantRatio = maxCount / words.length;
  let repeatedBigrams = 0;
  const bigrams = new Map();
  for (let i = 0; i + 1 < words.length; i++) {
    const key = `${words[i]}\u0001${words[i + 1]}`;
    const c = (bigrams.get(key) || 0) + 1;
    bigrams.set(key, c);
    repeatedBigrams = Math.max(repeatedBigrams, c);
  }
  let score = 0;
  if (words.length >= 8 && dominantRatio >= 0.42) score += 3;
  if (words.length >= 12 && uniqueRatio <= 0.24) score += 2;
  if (words.length >= 12 && repeatedBigrams >= 5) score += 2;
  if (words.length >= 20 && uniqueRatio <= 0.38) score += 1;
  return { score, words: words.length, uniqueRatio, dominantRatio };
}

function cleanChunkText(rawText) {
  const raw = String(rawText || '').replace(/\s+/gu, ' ').trim();
  if (!raw) return { text: '', suspicious: false, changed: false };
  if (els.cleanupSelect?.value === 'off') return { text: raw, suspicious: false, changed: false };

  const before = repetitionMetrics(raw);
  const collapsed = collapseRepeatedNgrams(collapseRepeatedSentences(raw));
  const after = repetitionMetrics(collapsed);
  const severe = before.score >= 4 && before.words >= 8;
  const shrankHard = collapsed.split(/\s+/u).length <= Math.max(2, before.words * 0.35);
  const strict = els.cleanupSelect?.value !== 'standard';

  if (strict && severe && shrankHard) {
    return { text: '[неразборчивая речь / шум]', suspicious: true, changed: true };
  }
  if (strict && after.score >= 5 && after.words >= 10) {
    return { text: '[неразборчивая речь / повтор]', suspicious: true, changed: true };
  }
  return { text: collapsed, suspicious: severe || after.score >= 4, changed: collapsed !== raw };
}

function normalizeOutputChunks(output, offsetSeconds = 0, fallbackDuration = 0) {
  const rawChunks = Array.isArray(output?.chunks) && output.chunks.length
    ? output.chunks
    : [{ text: output?.text || '', timestamp: [0, fallbackDuration || null] }];
  const chunks = [];
  let suspiciousCount = 0;
  for (const chunk of rawChunks) {
    const cleaned = cleanChunkText(chunk.text);
    if (!cleaned.text) continue;
    if (cleaned.suspicious) suspiciousCount++;
    const ts = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, null];
    const start = Number.isFinite(ts[0]) ? ts[0] + offsetSeconds : offsetSeconds;
    const end = Number.isFinite(ts[1]) ? ts[1] + offsetSeconds : null;
    chunks.push({ text: cleaned.text, timestamp: [start, end], suspicious: cleaned.suspicious });
  }
  return { chunks, suspiciousCount };
}

function mergeAdjacentChunks(chunks) {
  const out = [];
  for (const chunk of chunks) {
    const text = String(chunk.text || '').trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.text === text && Number(chunk.timestamp?.[0] || 0) - Number(prev.timestamp?.[1] || prev.timestamp?.[0] || 0) < 1.2) {
      prev.timestamp[1] = chunk.timestamp?.[1] ?? prev.timestamp[1];
      continue;
    }
    out.push({ ...chunk, timestamp: [...(chunk.timestamp || [0, null])] });
  }
  return out;
}

async function transcribeWindow(transcriber, audio, startSeconds, cfg, allowVerify = true) {
  const duration = audio.length / 16000;
  const output = await transcriber(audio, asrOptions());
  let normalized = normalizeOutputChunks(output, startSeconds, duration);

  if (allowVerify && cfg.verifySuspicious && normalized.suspiciousCount > 0 && duration >= 8) {
    const mid = Math.floor(audio.length / 2);
    const left = await transcriber(audio.subarray(0, mid), asrOptions({ no_repeat_ngram_size: 3, repetition_penalty: 1.16 }));
    const right = await transcriber(audio.subarray(mid), asrOptions({ no_repeat_ngram_size: 3, repetition_penalty: 1.16 }));
    const leftNorm = normalizeOutputChunks(left, startSeconds, mid / 16000);
    const rightNorm = normalizeOutputChunks(right, startSeconds + mid / 16000, (audio.length - mid) / 16000);
    const retried = [...leftNorm.chunks, ...rightNorm.chunks];
    const retrySuspicious = leftNorm.suspiciousCount + rightNorm.suspiciousCount;
    if (retrySuspicious < normalized.suspiciousCount || retried.length > normalized.chunks.length) {
      normalized = { chunks: retried, suspiciousCount: retrySuspicious };
    }
  }
  return normalized;
}

async function transcribeAudioArray(transcriber, sourceAudio) {
  const cfg = qualityConfig();
  const audio = normalizeAudio(sourceAudio);
  if (!audio?.length) return { text: '', chunks: [] };

  if (els.qualitySelect?.value === 'fast') {
    const output = await transcriber(audio, asrOptions({ chunk_length_s: 30, stride_length_s: 5 }));
    const normalized = normalizeOutputChunks(output, 0, audio.length / 16000);
    const chunks = mergeAdjacentChunks(normalized.chunks);
    return { text: chunks.map((x) => x.text).join(' ').trim(), chunks };
  }

  const regions = detectSpeechRegions(audio, cfg);
  if (!regions.length) {
    const marker = '[речь не обнаружена]';
    return { text: marker, chunks: [{ text: marker, timestamp: [0, audio.length / 16000] }] };
  }
  const windows = splitRegions(regions, cfg.maxWindowSeconds);
  const allChunks = [];
  for (let i = 0; i < windows.length; i++) {
    const [start, end] = windows[i];
    const a = Math.max(0, Math.floor(start * 16000));
    const b = Math.min(audio.length, Math.ceil(end * 16000));
    setProgress(68 + Math.min(24, ((i + 1) / windows.length) * 24), 'Распознаю речь без повторов', `${i + 1} из ${windows.length} · ${formatTime(start)}–${formatTime(end)}`);
    const result = await transcribeWindow(transcriber, audio.subarray(a, b), start, cfg, true);
    allChunks.push(...result.chunks);
  }
  const chunks = mergeAdjacentChunks(allChunks);
  return { text: chunks.map((x) => x.text).join(' ').replace(/\s+/gu, ' ').trim(), chunks };
}

async function transcribe() {
  if (!selectedFile || busy) return;
  setBusy(true);
  resetResult();
  try {
    setProgress(3, 'Читаю файл', 'Аудио декодируется только на этом устройстве.');
    const decoded = await decodeToMono16k(selectedFile);
    currentDuration = decoded.duration;
    setProgress(10, 'Аудио готово', `${formatTime(currentDuration)} · локальная обработка`);
    const transcriber = await getTranscriber(els.modelSelect.value);
    setProgress(68, 'Распознаю речь', 'Аудио не отправляется на сервер.');
    const output = await transcribeAudioArray(transcriber, decoded.audio);
    setProgress(100, 'Готово', 'Текст остаётся в браузере, пока ты сам его не скачаешь.');
    renderPlainResult(output);
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

function concatFloat32(parts, maxSamples = Infinity) {
  const total = Math.min(maxSamples, parts.reduce((sum, p) => sum + p.length, 0));
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    if (offset >= total) break;
    const take = Math.min(part.length, total - offset);
    out.set(part.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return dot / (Math.sqrt(aa) * Math.sqrt(bb) + 1e-12);
}

async function getDiarizationAssets() {
  if (diarizationAssets) return diarizationAssets;
  setProgress(58, 'Загружаю разделение голосов', 'Модели голосов скачиваются один раз и кэшируются браузером.');
  const diarModelId = 'onnx-community/pyannote-segmentation-3.0';
  const svModelId = 'Xenova/wavlm-base-sv';
  const [diarProcessor, diarModel, svProcessor, svModel] = await Promise.all([
    AutoProcessor.from_pretrained(diarModelId),
    AutoModelForAudioFrameClassification.from_pretrained(diarModelId),
    AutoProcessor.from_pretrained(svModelId),
    AutoModel.from_pretrained(svModelId),
  ]);
  diarizationAssets = { diarProcessor, diarModel, svProcessor, svModel };
  return diarizationAssets;
}

async function speakerEmbedding(audio, assets) {
  if (!audio || audio.length < 8000) return null;
  const inputs = await assets.svProcessor(audio);
  const outputs = await assets.svModel(inputs);
  const data = outputs.embeddings?.data;
  return data ? Float32Array.from(data) : null;
}

function updateCentroid(centroid, embedding, count) {
  if (!centroid) return Float32Array.from(embedding);
  const out = new Float32Array(centroid.length);
  for (let i = 0; i < out.length; i++) out[i] = (centroid[i] * count + embedding[i]) / (count + 1);
  return out;
}

async function diarizeAudio(audio) {
  const assets = await getDiarizationAssets();
  const sampleRate = 16000;
  const windowSamples = sampleRate * 10;
  const globalSpeakers = [];
  const allSegments = [];

  for (let offset = 0; offset < audio.length; offset += windowSamples) {
    const windowAudio = audio.subarray(offset, Math.min(audio.length, offset + windowSamples));
    if (windowAudio.length < sampleRate) continue;
    setProgress(64 + Math.min(12, (offset / audio.length) * 12), 'Разделяю голоса', `${formatTime(offset / sampleRate)} из ${formatTime(audio.length / sampleRate)}`);

    const inputs = await assets.diarProcessor(windowAudio);
    const { logits } = await assets.diarModel(inputs);
    const processed = assets.diarProcessor.post_process_speaker_diarization(logits, windowAudio.length)?.[0] || [];
    const ids = [...new Set(processed.map((s) => Number(s.id)).filter(Number.isFinite))];
    const localEmbeddings = new Map();

    for (const id of ids) {
      const pieces = [];
      for (const s of processed.filter((x) => Number(x.id) === id)) {
        const a = Math.max(0, Math.floor(s.start * sampleRate));
        const b = Math.min(windowAudio.length, Math.ceil(s.end * sampleRate));
        if (b - a >= sampleRate * 0.35) pieces.push(windowAudio.subarray(a, b));
      }
      const sample = concatFloat32(pieces, sampleRate * 5);
      localEmbeddings.set(id, await speakerEmbedding(sample, assets));
    }

    const localToGlobal = new Map();
    const usedThisWindow = new Set();
    for (const id of ids) {
      const emb = localEmbeddings.get(id);
      let bestIndex = -1;
      let bestScore = -1;
      if (emb) {
        globalSpeakers.forEach((g, index) => {
          if (usedThisWindow.has(index)) return;
          const score = cosine(emb, g.centroid);
          if (score > bestScore) { bestScore = score; bestIndex = index; }
        });
      }
      if (bestIndex < 0 || bestScore < 0.78) {
        if (globalSpeakers.length < 3 && emb) {
          bestIndex = globalSpeakers.length;
          globalSpeakers.push({ centroid: Float32Array.from(emb), count: 1 });
        } else if (bestIndex < 0) {
          bestIndex = Math.min(Number(id) || 0, 2);
          while (globalSpeakers.length <= bestIndex) globalSpeakers.push({ centroid: new Float32Array(512), count: 0 });
        }
      } else if (emb) {
        const g = globalSpeakers[bestIndex];
        g.centroid = updateCentroid(g.centroid, emb, g.count);
        g.count += 1;
      }
      usedThisWindow.add(bestIndex);
      localToGlobal.set(id, Math.min(bestIndex, 2));
    }

    for (const s of processed) {
      allSegments.push({
        start: offset / sampleRate + s.start,
        end: offset / sampleRate + s.end,
        speaker: localToGlobal.get(Number(s.id)) ?? 0,
        confidence: s.confidence,
      });
    }
  }

  return allSegments.sort((a, b) => a.start - b.start);
}

function assignSpeakerToChunk(chunk, diarSegments) {
  const start = Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[0] || 0) : 0;
  const rawEnd = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] : null;
  const end = Number.isFinite(rawEnd) ? Number(rawEnd) : start + 2;
  const overlap = [0, 0, 0];
  for (const s of diarSegments) {
    const amount = Math.max(0, Math.min(end, s.end) - Math.max(start, s.start));
    if (amount > 0 && s.speaker >= 0 && s.speaker < 3) overlap[s.speaker] += amount;
  }
  let best = 0;
  if (overlap[1] > overlap[best]) best = 1;
  if (overlap[2] > overlap[best]) best = 2;
  return `remote-${best}`;
}

function chunksToStructured(output, speakerResolver) {
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  return chunks
    .map((chunk) => {
      const start = Array.isArray(chunk.timestamp) ? Number(chunk.timestamp[0] || 0) : 0;
      const rawEnd = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] : null;
      const end = Number.isFinite(rawEnd) ? Number(rawEnd) : start + 2;
      return { start, end, text: String(chunk.text || '').trim(), speakerKey: speakerResolver(chunk), suspicious: Boolean(chunk.suspicious) };
    })
    .filter((s) => s.text);
}

async function transcribeLive(systemFile, micFile) {
  setBusy(true);
  resetResult();
  try {
    setProgress(4, 'Готовлю запись', 'Обе аудиодорожки читаются локально.');
    const systemDecoded = await decodeToMono16k(systemFile);
    const micDecoded = micFile ? await decodeToMono16k(micFile) : null;
    currentDuration = Math.max(systemDecoded.duration, micDecoded?.duration || 0);
    const transcriber = await getTranscriber(els.modelSelect.value);

    setProgress(68, 'Распознаю звук встречи', 'Whisper работает в браузере.');
    const systemOutput = await transcribeAudioArray(transcriber, systemDecoded.audio);
    let diarSegments = [];
    if (els.speakerLabelsToggle.checked) {
      try {
        diarSegments = await diarizeAudio(systemDecoded.audio);
      } catch (error) {
        console.warn('Diarization unavailable:', error);
        showToast('Разделение удалённых голосов не загрузилось — оставляю одного собеседника', 'error');
      }
    }

    setProgress(84, 'Распознаю микрофон', micDecoded ? 'Ваш голос обрабатывается отдельно.' : 'Микрофон не записывался.');
    const micOutput = micDecoded ? await transcribeAudioArray(transcriber, micDecoded.audio) : null;

    const remoteSegments = chunksToStructured(systemOutput, (chunk) => (
      diarSegments.length ? assignSpeakerToChunk(chunk, diarSegments) : 'remote-0'
    ));
    const youSegments = micOutput ? chunksToStructured(micOutput, () => 'you') : [];
    const merged = [...remoteSegments, ...youSegments].sort((a, b) => a.start - b.start);

    setProgress(100, 'Готово', 'Запись и стенограмма не отправлялись на сервер.');
    renderStructuredResult(merged);
    showToast('Стенограмма готова');
  } catch (error) {
    console.error(error);
    const message = error?.message || 'Не удалось обработать запись.';
    setProgress(0, 'Ошибка', message);
    showToast(message, 'error');
  } finally {
    setBusy(false);
  }
}

function pickRecorderMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return types.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function makeRecorder(stream, chunks) {
  const mimeType = pickRecorderMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
  return recorder;
}

function stopRecorder(recorder) {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve();
  return new Promise((resolve) => {
    recorder.addEventListener('stop', resolve, { once: true });
    recorder.stop();
  });
}

function updateCaptureUi(recording) {
  els.startCaptureBtn.classList.toggle('hidden', recording);
  els.stopCaptureBtn.classList.toggle('hidden', !recording);
  els.captureStatus.classList.toggle('recording', recording);
  els.captureStatus.classList.toggle('idle', !recording);
  els.captureStatusText.textContent = recording ? 'ЛОКАЛЬНАЯ ЗАПИСЬ' : 'ГОТОВ К ЗАХВАТУ';
}

function startTimer() {
  const tick = () => {
    if (!captureSession) return;
    els.recordTimer.textContent = formatTime((Date.now() - captureSession.startedAt) / 1000);
  };
  tick();
  captureSession.timer = setInterval(tick, 500);
}

function makeDisplayConstraints() {
  const auto = els.autoCaptureToggle.checked;
  const preferred = auto ? (localStorage.getItem(STORAGE.source) || 'browser') : els.manualSourceSelect.value;
  return {
    video: { displaySurface: preferred },
    audio: true,
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: 'include',
  };
}

async function startCapture() {
  if (busy || captureSession) return;
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
    return showToast('Этот браузер не поддерживает захват экрана/аудио', 'error');
  }

  let displayStream = null;
  let micStream = null;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia(makeDisplayConstraints());
    const audioTracks = displayStream.getAudioTracks();
    if (!audioTracks.length) {
      displayStream.getTracks().forEach((track) => track.stop());
      throw new Error('В выбранном источнике нет аудио. Включи «Поделиться аудио» и попробуй снова.');
    }

    if (els.micToggle.checked) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      } catch {
        showToast('Микрофон недоступен — запишу только звук встречи', 'error');
      }
    }

    const systemStream = new MediaStream(audioTracks);
    const micAudioStream = micStream ? new MediaStream(micStream.getAudioTracks()) : null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    const destination = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(systemStream).connect(destination);
    if (micAudioStream?.getAudioTracks().length) audioContext.createMediaStreamSource(micAudioStream).connect(destination);

    const chunks = { system: [], mic: [], mix: [] };
    const systemRecorder = makeRecorder(systemStream, chunks.system);
    const micRecorder = micAudioStream?.getAudioTracks().length ? makeRecorder(micAudioStream, chunks.mic) : null;
    const mixRecorder = makeRecorder(destination.stream, chunks.mix);

    captureSession = {
      displayStream, micStream, audioContext, destination, chunks, systemRecorder, micRecorder, mixRecorder,
      startedAt: Date.now(), timer: null, stopping: false,
    };
    systemRecorder.start(1000);
    micRecorder?.start(1000);
    mixRecorder.start(1000);

    const videoTrack = displayStream.getVideoTracks()[0];
    const surface = videoTrack?.getSettings?.().displaySurface || 'browser';
    localStorage.setItem(STORAGE.source, surface);
    els.lastSourceText.textContent = sourceName(surface);
    els.systemIndicator.classList.add('on');
    els.systemStatus.textContent = `Звук встречи: подключён · ${sourceName(surface)}`;
    els.micIndicator.classList.toggle('on', Boolean(micAudioStream?.getAudioTracks().length));
    els.micStatus.textContent = micAudioStream?.getAudioTracks().length ? 'Микрофон: подключён отдельно' : 'Микрофон: не используется';
    updateCaptureUi(true);
    startTimer();

    videoTrack?.addEventListener('ended', () => stopCapture(), { once: true });
    showToast('Локальный захват начат');
  } catch (error) {
    displayStream?.getTracks().forEach((track) => track.stop());
    micStream?.getTracks().forEach((track) => track.stop());
    console.error(error);
    if (error?.name !== 'NotAllowedError') showToast(error?.message || 'Не удалось начать захват', 'error');
  }
}

async function stopCapture() {
  const session = captureSession;
  if (!session || session.stopping) return;
  session.stopping = true;
  clearInterval(session.timer);
  els.captureStatusText.textContent = 'ЗАВЕРШАЮ ЗАПИСЬ…';

  await Promise.all([
    stopRecorder(session.systemRecorder),
    stopRecorder(session.micRecorder),
    stopRecorder(session.mixRecorder),
  ]);

  session.displayStream.getTracks().forEach((track) => track.stop());
  session.micStream?.getTracks().forEach((track) => track.stop());
  await session.audioContext.close().catch(() => {});

  const systemBlob = new Blob(session.chunks.system, { type: session.systemRecorder.mimeType || 'audio/webm' });
  const micBlob = session.micRecorder ? new Blob(session.chunks.mic, { type: session.micRecorder.mimeType || 'audio/webm' }) : null;
  const mixBlob = new Blob(session.chunks.mix, { type: session.mixRecorder.mimeType || 'audio/webm' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const systemFile = new File([systemBlob], `meeting-${stamp}-remote.webm`, { type: systemBlob.type });
  const micFile = micBlob?.size ? new File([micBlob], `meeting-${stamp}-you.webm`, { type: micBlob.type }) : null;
  const mixFile = new File([mixBlob], `meeting-${stamp}.webm`, { type: mixBlob.type });

  recordingBlob = mixBlob;
  recordingFilename = mixFile.name;
  captureSession = null;
  els.recordTimer.textContent = '00:00';
  els.systemIndicator.classList.remove('on');
  els.micIndicator.classList.remove('on');
  els.systemStatus.textContent = 'Звук встречи: не подключён';
  els.micStatus.textContent = 'Микрофон: не подключён';
  updateCaptureUi(false);
  els.downloadAudioBtn.classList.remove('hidden');
  setSelectedFile(mixFile, 'ЛОКАЛЬНАЯ ЗАПИСЬ');

  if (els.autoTranscribeToggle.checked && systemBlob.size) {
    await transcribeLive(systemFile, micFile);
  } else {
    showToast('Запись сохранена только в памяти страницы');
  }
}

function downloadRecording() {
  if (!recordingBlob) return showToast('Записи пока нет', 'error');
  const url = URL.createObjectURL(recordingBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = recordingFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateCaptureModeUi() {
  const auto = els.autoCaptureToggle.checked;
  localStorage.setItem(STORAGE.auto, auto ? '1' : '0');
  els.captureModeBadge.textContent = auto ? 'AUTO' : 'MANUAL';
  els.manualSourceWrap.classList.toggle('hidden', auto);
  els.startCaptureBtnText.textContent = auto ? 'НАЙТИ И НАЧАТЬ' : 'ВЫБРАТЬ И НАЧАТЬ';
  els.captureModeHint.textContent = auto
    ? 'АВТО: предложу последний тип источника и сразу начну запись после системного подтверждения.'
    : 'РУЧНОЙ: заранее выбери, что браузер должен предложить — вкладку, окно или экран.';
}

function switchMode(mode) {
  activeMode = mode;
  const live = mode === 'live';
  els.liveMode.classList.toggle('hidden', !live);
  els.fileMode.classList.toggle('hidden', live);
  els.liveModeBtn.classList.toggle('active', live);
  els.fileModeBtn.classList.toggle('active', !live);
  els.liveModeBtn.setAttribute('aria-selected', String(live));
  els.fileModeBtn.setAttribute('aria-selected', String(!live));
}

async function copyTranscript() {
  const text = els.transcript.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  try { await navigator.clipboard.writeText(text); showToast('Текст скопирован'); }
  catch { els.transcript.focus(); els.transcript.select(); document.execCommand('copy'); showToast('Текст скопирован'); }
}

function downloadTranscript() {
  const text = els.transcript.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  const safeBase = (selectedFile?.name || 'transcript').replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').slice(0, 80) || 'transcript';
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
els.startCaptureBtn.addEventListener('click', startCapture);
els.stopCaptureBtn.addEventListener('click', stopCapture);
els.downloadAudioBtn.addEventListener('click', downloadRecording);
els.liveModeBtn.addEventListener('click', () => switchMode('live'));
els.fileModeBtn.addEventListener('click', () => switchMode('file'));
els.autoCaptureToggle.addEventListener('change', updateCaptureModeUi);
els.speakerLabelsToggle.addEventListener('change', () => els.speakerConfig.classList.toggle('hidden', !els.speakerLabelsToggle.checked));

for (const input of [els.mySpeakerName, els.speakerName1, els.speakerName2, els.speakerName3]) input.addEventListener('input', saveSpeakerNames);
for (const type of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(type, (event) => { event.preventDefault(); if (!busy) els.dropzone.classList.add('dragging'); });
}
for (const type of ['dragleave', 'drop']) {
  els.dropzone.addEventListener(type, (event) => { event.preventDefault(); els.dropzone.classList.remove('dragging'); });
}
els.dropzone.addEventListener('drop', (event) => { if (!busy) selectFile(event.dataTransfer?.files?.[0]); });
els.audioPreview.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(els.audioPreview.duration)) {
    currentDuration = els.audioPreview.duration;
    if (selectedFile) els.fileMeta.textContent = `${formatBytes(selectedFile.size)} · ${formatTime(currentDuration)} · ${selectedFile.type || 'медиафайл'}`;
  }
});
els.transcript.addEventListener('input', () => {
  const text = els.transcript.value.trim();
  els.wordCount.textContent = String(text ? text.split(/\s+/u).filter(Boolean).length : 0);
});

loadSpeakerNames();
els.autoCaptureToggle.checked = localStorage.getItem(STORAGE.auto) !== '0';
const lastSurface = localStorage.getItem(STORAGE.source);
if (lastSurface) els.lastSourceText.textContent = sourceName(lastSurface);
updateCaptureModeUi();
switchMode('live');
