(() => {
  'use strict';

  // Entirely isolated page: no global Speech Lab state, handlers, or shared DOM IDs.
  const MAX_BYTES = 300 * 1024 * 1024;
  const MAX_SECONDS = 90 * 60;
  const $ = (id) => document.getElementById(id);
  const ui = {
    fileInput: $('videoFile'), drop: $('videoDrop'),
    details: $('videoFileDetails'), fileName: $('videoFileName'), fileMeta: $('videoFileMeta'),
    clear: $('videoClearButton'), previewWrap: $('videoPreviewWrap'), preview: $('videoPreview'),
    language: $('videoLanguage'), quality: $('videoQuality'),
    start: $('videoStartBtn'), startLabel: $('videoStartLabel'),
    progress: $('videoProgress'), progressValue: $('videoProgressValue'), progressBar: $('videoProgressBar'),
    status: $('videoStatus'), note: $('videoStatusNote'), error: $('videoError'),
    empty: $('videoEmpty'), result: $('videoResult'), text: $('videoText'),
    words: $('videoWordCount'), duration: $('videoDuration'), segments: $('videoSegmentCount'),
    copy: $('videoCopy'), txt: $('videoTxt'), srt: $('videoSrt'),
  };

  const state = { file: null, url: null, busy: false, cancelled: false,
    session: 0, ffmpeg: null, worker: null, duration: 0, segments: [], lastProgress: 0 };

  function prettyBytes(bytes) {
    return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' МБ'
      : (bytes / 1024).toFixed(1) + ' КБ';
  }
  function clock(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((x) => String(x).padStart(2, '0')).join(':');
  }
  function setError(text) {
    ui.error.hidden = !text;
    ui.error.textContent = text || '';
  }
  function report(value, heading, detail) {
    const progress = Math.max(state.lastProgress, Math.min(100, Math.max(0, value)));
    state.lastProgress = progress;
    ui.progress.hidden = false;
    ui.progressBar.style.width = progress.toFixed(1) + '%';
    ui.progressValue.textContent = Math.round(progress) + '%';
    ui.status.textContent = heading;
    ui.note.textContent = detail;
  }
  function resetResult() {
    state.segments = [];
    state.duration = 0;
    ui.empty.hidden = false;
    ui.result.hidden = true;
    ui.text.value = '';
    ui.words.textContent = '0';
    ui.duration.textContent = '—';
    ui.segments.textContent = '0';
    ui.copy.disabled = true;
    ui.txt.disabled = true;
    ui.srt.disabled = true;
    state.lastProgress = 0;
    ui.progress.hidden = true;
    setError('');
  }
  function updateWords() {
    const text = ui.text.value.trim();
    ui.words.textContent = String(text ? text.split(/\s+/u).length : 0);
    ui.copy.disabled = !text;
    ui.txt.disabled = !text;
  }
  function showText(value, segments = null) {
    if (segments) state.segments = segments;
    ui.empty.hidden = true;
    ui.result.hidden = false;
    ui.text.value = value || '';
    ui.duration.textContent = clock(state.duration);
    ui.segments.textContent = String(state.segments.length);
    ui.srt.disabled = state.segments.length === 0;
    updateWords();
  }
  function select(file) {
    if (state.busy) return;
    resetResult();
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    state.file = null;
    ui.fileInput.value = '';
    ui.preview.removeAttribute('src');
    ui.preview.load();
    ui.previewWrap.hidden = true;
    ui.details.hidden = true;
    ui.start.disabled = true;
    if (!file) return;
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    if (!file.type.startsWith('video/') && !['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(extension)) {
      setError('Выбери видеофайл: MP4, MOV, MKV, WEBM, AVI или M4V.');
      return;
    }
    if (!file.size) { setError('Видеофайл пустой.'); return; }
    if (file.size > MAX_BYTES) {
      setError('Файл больше 300 МБ. Раздели видео на части или уменьши размер.');
      return;
    }
    state.file = file;
    ui.fileName.textContent = file.name;
    ui.fileMeta.textContent = prettyBytes(file.size) + ' · ' + (file.type || 'видеофайл');
    ui.details.hidden = false;
    ui.start.disabled = false;
    state.url = URL.createObjectURL(file);
    ui.preview.src = state.url;
    ui.previewWrap.hidden = false;
  }
  function busy(isBusy) {
    state.busy = isBusy;
    ui.fileInput.disabled = isBusy;
    ui.clear.disabled = isBusy;
    ui.language.disabled = isBusy;
    ui.quality.disabled = isBusy;
    ui.start.disabled = !state.file;
    ui.startLabel.textContent = isBusy ? 'ОСТАНОВИТЬ ОБРАБОТКУ' : 'РАСПОЗНАТЬ ВИДЕО';
  }
  function stop() {
    state.cancelled = true;
    state.session += 1; // Ignore any event from an obsolete FFmpeg/Whisper job.
    state.ffmpeg?.terminate();
    state.worker?.terminate();
    state.ffmpeg = null;
    state.worker = null;
    busy(false);
    report(0, 'ОСТАНОВЛЕНО', 'Обработка остановлена. Для повторного запуска нажми «Распознать видео».');
  }

  function webGpuAvailable() {
    return navigator.gpu?.requestAdapter?.().then(Boolean).catch(() => false) || Promise.resolve(false);
  }

  async function extractAudio(file, isCurrent) {
    report(3, 'ЗАГРУЖАЮ ДЕКОДЕР', 'При первом запуске загружается FFmpeg; видео остаётся на этом устройстве.');
    const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js');
    if (!isCurrent()) return null;
    const ffmpeg = new FFmpeg();
    state.ffmpeg = ffmpeg;
    ffmpeg.on('progress', ({ progress }) => {
      if (isCurrent() && Number.isFinite(progress)) {
        report(13 + Math.max(0, Math.min(1, progress)) * 11,
          'ИЗВЛЕКАЮ ЗВУК', 'Преобразую аудиодорожку видео в моно 16 кГц…');
      }
    });

    // Worker wrapper is same-origin; its ESM dependency is served by a CORS CDN.
    await ffmpeg.load({
      classWorkerURL: new URL('./video-ffmpeg-worker.js', location.href).href,
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
      wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
    });
    if (!isCurrent()) return null;
    report(12, 'ЗАГРУЖАЮ ВИДЕО', 'Подготавливаю файл в локальной памяти браузера…');
    const inputName = 'input-video.bin';
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    if (!isCurrent()) return null;
    report(15, 'ИЗВЛЕКАЮ ЗВУК', 'Аудиодорожка будет декодирована без передачи видео в интернет.');

    const exitCode = await ffmpeg.exec([
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', inputName,
      '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      '-f', 's16le', 'speech.pcm',
    ]);
    if (!isCurrent()) return null;
    if (exitCode !== 0) {
      throw new Error('Не удалось извлечь звук. Проверь, что видео содержит аудиодорожку, или попробуй MP4/WebM.');
    }
    const raw = await ffmpeg.readFile('speech.pcm');
    if (!isCurrent()) return null;
    if (!(raw instanceof Uint8Array) || raw.byteLength < 2 || raw.byteLength % 2) {
      throw new Error('Видеофайл не содержит доступной звуковой дорожки.');
    }
    const count = raw.byteLength / 2;
    const duration = count / 16000;
    if (duration > MAX_SECONDS) {
      throw new Error('Видео длиннее 90 минут. Раздели его на части.');
    }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const audio = new Float32Array(count);
    for (let i = 0; i < count; i++) audio[i] = view.getInt16(i * 2, true) / 32768;
    state.duration = duration;
    report(25, 'ЗВУК ГОТОВ', clock(duration) + ' · запущу локальное распознавание.');
    // Reclaim WASM video file memory before loading the Whisper model.
    ffmpeg.terminate();
    if (state.ffmpeg === ffmpeg) state.ffmpeg = null;
    return audio;
  }

  async function transcribe(audio, isCurrent) {
    const jobId = 'video-' + state.session;
    const hasGpu = await webGpuAvailable();
    if (!isCurrent()) return;
    const worker = new Worker('./transcription-worker.js?build=video-isolated-20261109', { type: 'module' });
    state.worker = worker;
    const quality = ui.quality.value;
    const profile = {
      fast: { chunk: 29, overlap: 0, detailed: false },
      balanced: { chunk: 28, overlap: 3, detailed: true },
      accurate: { chunk: 27, overlap: 4, detailed: true },
    }[quality];
    report(27, 'ЗАПУСКАЮ AI', 'Использую Whisper в отдельном Web Worker.');
    await new Promise((resolve, reject) => {
      worker.onerror = (event) => { event.preventDefault?.(); reject(new Error(event.message || 'Ошибка AI Worker.')); };
      worker.onmessageerror = () => reject(new Error('Не удалось получить ответ AI Worker.'));
      worker.onmessage = ({ data: m = {} }) => {
        if (!isCurrent() || m.jobId !== jobId) return;
        if (m.type === 'model-progress') {
          report(27 + Math.max(0, Math.min(100, m.progress || 0)) * .18,
            'ЗАГРУЖАЮ AI-МОДЕЛЬ', m.file || 'Первый запуск может занять время.');
        } else if (m.type === 'status' || m.type === 'engine') {
          report(46, 'WHISPER', m.message || 'AI-модель загружена.');
        } else if (m.type === 'backend-fallback') {
          ui.note.textContent = m.message || 'Пробую резервную модель.';
        } else if (m.type === 'chunk-progress') {
          const ratio = m.total ? m.index / m.total : 0;
          report(47 + Math.max(0, Math.min(1, ratio)) * 51,
            'РАСПОЗНАЮ РЕЧЬ', 'Фрагмент ' + (m.index || 0) + ' из ' + (m.total || '?'));
          if (m.partialText) {
            const current = ui.text.value;
            showText((current + ' ' + m.partialText).trim());
          }
        } else if (m.type === 'result') {
          const output = m.output || {};
          const segments = Array.isArray(output.chunks) ? output.chunks
            .filter((x) => x && String(x.text || '').trim())
            .map((x) => ({ text: String(x.text).trim(), timestamp: [
              Number.isFinite(x.timestamp?.[0]) ? Math.max(0, x.timestamp[0]) : 0,
              Number.isFinite(x.timestamp?.[1]) ? Math.max(0, x.timestamp[1]) : state.duration,
            ] })) : [];
          showText(String(output.text || '').trim(), segments);
          report(100, 'ГОТОВО', ui.text.value ? 'Текст готов для редактирования и скачивания.' :
            'Речь не обнаружена. Проверь громкость видео и выбранный язык.');
          resolve();
        } else if (m.type === 'error') {
          reject(new Error(m.message || 'Whisper не смог распознать файл.'));
        } else if (m.type === 'cancelled') {
          reject(new Error('Обработка остановлена.'));
        }
      };
      worker.postMessage({
        type: 'transcribe', jobId, audioBuffer: audio.buffer,
        modelId: 'auto', preferredDevice: hasGpu ? 'webgpu' : 'wasm',
        language: ui.language.value,
        quality,
        cleanup: 'strict',
        chunkSeconds: profile.chunk,
        overlapSeconds: profile.overlap,
        detailedTimestamps: profile.detailed,
        useVad: true, vadThreshold: 0.0035,
      }, [audio.buffer]);
    });
  }

  async function start() {
    if (state.busy) { stop(); return; }
    if (!state.file) return;
    const file = state.file;
    state.cancelled = false;
    const session = ++state.session;
    const isCurrent = () => state.session === session && !state.cancelled;
    resetResult();
    busy(true);
    try {
      const audio = await extractAudio(file, isCurrent);
      if (!isCurrent() || !audio) return;
      await transcribe(audio, isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      console.error('[Video transcription]', error);
      const description = String(error?.message || 'Неизвестная ошибка обработки.');
      setError(description + ' Если видео не удалось открыть, попробуй перекодировать его в MP4 (H.264 + AAC).');
      report(state.lastProgress, 'ОШИБКА', 'Уже распознанный текст, если он есть, остаётся доступным.');
    } finally {
      if (isCurrent()) {
        state.ffmpeg?.terminate();
        state.worker?.terminate();
        state.ffmpeg = null;
        state.worker = null;
        busy(false);
      }
    }
  }

  function download(text, filename, type) {
    const blob = new Blob(['\ufeff', text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function baseName() {
    return (state.file?.name || 'video').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
  }
  function srtTime(seconds) {
    const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const mm = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    return hh + ':' + mm + ':' + ss + ',' + String(ms % 1000).padStart(3, '0');
  }

  ui.fileInput.addEventListener('change', () => select(ui.fileInput.files?.[0]));
  ui.clear.addEventListener('click', () => select(null));
  ui.start.addEventListener('click', start);
  ui.text.addEventListener('input', updateWords);
  ui.copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ui.text.value); ui.copy.textContent = 'СКОПИРОВАНО ✓'; }
    catch { ui.text.select(); ui.copy.textContent = 'ВЫДЕЛЕНО · CTRL+C'; }
    setTimeout(() => { ui.copy.textContent = 'СКОПИРОВАТЬ'; }, 1800);
  });
  ui.txt.addEventListener('click', () => download(ui.text.value, baseName() + '_транскрибация.txt', 'text/plain;charset=utf-8'));
  ui.srt.addEventListener('click', () => {
    const entries = state.segments.map((s, i) =>
      (i + 1) + '\n' + srtTime(s.timestamp[0]) + ' --> ' +
      srtTime(Math.max(s.timestamp[0] + .1, s.timestamp[1])) + '\n' + s.text + '\n').join('\n');
    download(entries, baseName() + '_субтитры.srt', 'text/plain;charset=utf-8');
  });
  ['dragenter', 'dragover'].forEach((eventName) => ui.drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!state.busy) ui.drop.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((eventName) => ui.drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    ui.drop.classList.remove('dragover');
  }));
  ui.drop.addEventListener('drop', (event) => {
    if (!state.busy) select(event.dataTransfer?.files?.[0]);
  });
  ui.preview.addEventListener('loadedmetadata', () => {
    if (!state.file || !Number.isFinite(ui.preview.duration)) return;
    if (ui.preview.duration > MAX_SECONDS) {
      setError('Видео длиннее 90 минут. Раздели его на части.');
      ui.start.disabled = true;
    }
  });
  window.addEventListener('pagehide', () => {
    state.ffmpeg?.terminate();
    state.worker?.terminate();
    if (state.url) URL.revokeObjectURL(state.url);
  });
})();