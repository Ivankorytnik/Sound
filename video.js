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
    sourceFile: $('videoSourceFile'), sourceUrl: $('videoSourceUrl'), urlPanel: $('videoUrlPanel'),
    urlInput: $('videoSourceInput'), checkUrl: $('videoCheckUrl'), mediaOptions: $('videoMediaOptions'),
    downloadQuality: $('videoDownloadQuality'), audioFormat: $('videoAudioFormat'),
    downloadVideo: $('videoDownloadVideo'), downloadAudio: $('videoDownloadAudio'),
    audioHint: $('videoAudioHint'), audioPreview: $('videoAudioPreview'), cancel: $('videoCancel'),
  };

  const state = { file: null, url: null, busy: false, cancelled: false,
    source: null, mode: 'file', controller: null, cachedPCM: null, cachedDuration: 0,
    audioBlob: null, audioType: null, audioUrl: null, overLimit: false, pendingReject: null,
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
    if (value === null) {
      ui.progress.hidden = false;
      ui.progressBar.style.width = '0%';
      ui.progressValue.textContent = '';
      ui.status.textContent = heading;
      ui.note.textContent = detail;
      return;
    }
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
  function clearAudio() {
    state.cachedPCM = null;
    state.cachedDuration = 0;
    state.audioBlob = null;
    state.audioType = null;
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
    ui.audioPreview.pause();
    ui.audioPreview.removeAttribute('src');
    ui.audioPreview.load();
    ui.audioPreview.hidden = true;
  }
  function refreshActions() {
    const valid = !!state.source && !state.overLimit;
    const hasAudio = valid && state.source.hasAudio !== false;
    ui.start.disabled = state.busy ? false : !hasAudio;
    ui.downloadVideo.disabled = state.busy || !valid;
    ui.downloadAudio.disabled = state.busy || !hasAudio;
    ui.mediaOptions.hidden = !state.source;
    ui.audioHint.textContent = state.source?.hasAudio === false ? 'В этом видео нет аудиодорожки' :
      state.source?.hasAudio === true ? 'В видео есть аудиодорожка.' :
      'Наличие аудиодорожки проверяется при обработке файла.';
    ui.start.title = ui.downloadAudio.title = state.source?.hasAudio === false ?
      'В этом видео нет аудиодорожки' : state.overLimit ? 'Видео длиннее 90 минут' : '';
    ui.downloadQuality.disabled = true; // A direct file has exactly one original variant.
    ui.downloadQuality.title = 'По прямой ссылке доступен только исходный файл.';
  }
  function showSource() {
    const source = state.source;
    ui.details.hidden = !source;
    if (source) {
      ui.fileName.textContent = source.name;
      ui.fileMeta.textContent = [source.size ? prettyBytes(source.size) : 'Размер неизвестен',
        source.type || 'видеофайл', source.duration ? clock(source.duration) : 'Длительность уточняется при обработке'].join(' · ');
      ui.downloadQuality.options[0].textContent = source.height ?
        'Исходное · ' + Math.round(source.height) + 'p' : 'Исходное качество';
    }
    refreshActions();
  }
  function select(file) {
    if (state.busy) return;
    state.session += 1;
    resetResult();
    clearAudio();
    state.overLimit = false;
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    state.file = null;
    state.source = null;
    ui.fileInput.value = '';
    ui.preview.pause();
    ui.preview.removeAttribute('src');
    ui.preview.load();
    ui.previewWrap.hidden = true;
    showSource();
    if (!file) return;
    const extension = (file.name.split('.').pop() || '').toLowerCase();
    if (!file.type.startsWith('video/') && !['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(extension)) {
      setError('Выбери видеофайл: MP4, MOV, MKV, WEBM, AVI или M4V.'); return;
    }
    if (!file.size) { setError('Видеофайл пустой.'); return; }
    if (file.size > MAX_BYTES) {
      setError('Файл больше 300 МБ. Раздели видео на части или уменьши размер.'); return;
    }
    state.file = file;
    state.source = { name: file.name, size: file.size, type: file.type, hasAudio: null };
    state.url = URL.createObjectURL(file);
    ui.preview.src = state.url;
    ui.previewWrap.hidden = false;
    showSource();
  }
  function busy(isBusy) {
    state.busy = isBusy;
    for (const control of [ui.fileInput, ui.clear, ui.language, ui.quality, ui.sourceFile,
      ui.sourceUrl, ui.checkUrl, ui.urlInput, ui.audioFormat]) control.disabled = isBusy;
    ui.cancel.hidden = !isBusy;
    ui.startLabel.textContent = isBusy ? 'ОСТАНОВИТЬ ОБРАБОТКУ' : 'РАСПОЗНАТЬ РЕЧЬ';
    refreshActions();
  }
  function stop() {
    state.cancelled = true;
    state.session += 1;
    state.controller?.abort();
    state.pendingReject?.(new DOMException('Отменено', 'AbortError'));
    state.pendingReject = null;
    state.ffmpeg?.terminate();
    state.worker?.terminate();
    state.ffmpeg = null;
    state.worker = null;
    busy(false);
    report(null, 'ОТМЕНЕНО', 'Обработка остановлена. Можно запустить действие снова.');
  }
  function sourceMode(mode) {
    if (state.busy) return;
    select(null);
    state.mode = mode;
    ui.sourceFile.setAttribute('aria-pressed', String(mode === 'file'));
    ui.sourceUrl.setAttribute('aria-pressed', String(mode === 'url'));
    ui.drop.hidden = mode !== 'file';
    ui.urlPanel.hidden = mode !== 'url';
  }
  function readableError(error) {
    if (error?.name === 'TimeoutError') return 'Источник не ответил вовремя. Попробуй ещё раз.';
    if (error instanceof TypeError) return 'Браузер не смог получить видео. Проверь ссылку и соединение. Источник может запрещать загрузку с других сайтов (CORS). Можно скачать файл самостоятельно и загрузить его сюда.';
    return String(error?.message || 'Не удалось обработать видео.');
  }
  async function checkUrl() {
    if (state.busy) return;
    select(null);
    const session = ++state.session;
    state.cancelled = false;
    state.controller = new AbortController();
    const controller = state.controller;
    const timer = setTimeout(() => controller.abort(new DOMException('Источник не ответил вовремя', 'TimeoutError')), 30000);
    busy(true);
    report(null, 'ПРОВЕРКА', 'Проверяю доступность и метаданные. Видео целиком не загружается.');
    try {
      const source = await window.SpeechVideoSource.probe(ui.urlInput.value.trim(), state.controller.signal);
      if (session !== state.session) return;
      state.source = source;
      showSource();
      report(null, 'ССЫЛКА ПРОВЕРЕНА', 'Выбери действие. Будет загружен исходный видеофайл.');
    } catch (error) {
      if (session === state.session) { setError(readableError(error)); report(null, 'ОШИБКА', 'Проверь ссылку или загрузи видеофайл.'); }
    } finally {
      clearTimeout(timer);
      if (session === state.session) { state.controller = null; busy(false); }
    }
  }
  async function getFile(isCurrent) {
    if (state.file) return state.file;
    if (!state.source?.url) throw new Error('Сначала выбери видео или проверь ссылку.');
    report(null, 'ПОЛУЧЕНИЕ МЕДИА', 'Загружаю видео на это устройство.');
    const file = await window.SpeechVideoSource.retrieve(state.source, state.controller.signal, (done, total) => {
      if (isCurrent()) report(null, 'ПОЛУЧЕНИЕ МЕДИА', prettyBytes(done) + (total ? ' из ' + prettyBytes(total) : ''));
    });
    if (!isCurrent()) return null;
    const metadata = window.SpeechVideoSource.mp4Metadata(new Uint8Array(await file.arrayBuffer()));
    if (!isCurrent()) return null;
    if (metadata.duration > MAX_SECONDS) {
      state.overLimit = true; throw new Error('Видео длиннее 90 минут. Раздели его на части.');
    }
    Object.assign(state.source, metadata);
    state.file = file;
    state.url = URL.createObjectURL(file);
    ui.preview.src = state.url;
    ui.previewWrap.hidden = false;
    showSource();
    return file;
  }

  function webGpuAvailable() {
    return navigator.gpu?.requestAdapter?.().then(Boolean).catch(() => false) || Promise.resolve(false);
  }

  async function extractAudio(file, isCurrent) {
    if (state.cachedPCM) {
      state.duration = state.cachedDuration;
      return state.cachedPCM.slice();
    }
    report(null, 'ЗАГРУЖАЮ ДЕКОДЕР', 'При первом запуске загружается FFmpeg; видео остаётся на этом устройстве.');
    const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js');
    if (!isCurrent()) return null;
    const ffmpeg = new FFmpeg();
    state.ffmpeg = ffmpeg;
    let noAudio = false;
    ffmpeg.on('log', ({ message }) => {
      if (/matches no streams|does not contain any stream|no audio/i.test(message)) noAudio = true;
    });
    ffmpeg.on('progress', ({ progress }) => {
      if (isCurrent() && Number.isFinite(progress)) {
        report(null,
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
    report(null, 'ПОДГОТОВКА', 'Подготавливаю файл в локальной памяти браузера…');
    const inputName = 'input-video.bin';
    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    if (!isCurrent()) return null;
    report(null, 'ИЗВЛЕКАЮ ЗВУК', 'Аудиодорожка будет декодирована без передачи видео в интернет.');

    const exitCode = await ffmpeg.exec([
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', inputName,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(MAX_SECONDS + 1),
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      '-f', 's16le', 'speech.pcm',
    ]);
    if (!isCurrent()) return null;
    if (exitCode !== 0 && noAudio) {
      state.source.hasAudio = false;
      refreshActions();
      throw new Error('В этом видео нет аудиодорожки');
    }
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
      state.overLimit = true;
      throw new Error('Видео длиннее 90 минут. Раздели его на части.');
    }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const audio = new Float32Array(count);
    for (let i = 0; i < count; i++) audio[i] = view.getInt16(i * 2, true) / 32768;
    state.duration = duration;
    state.cachedDuration = duration;
    state.cachedPCM = audio.slice();
    state.source.hasAudio = true;
    refreshActions();
    report(null, 'ЗВУК ГОТОВ', clock(duration) + ' · аудиодорожка подготовлена.');
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
    report(null, 'ЗАПУСКАЮ AI', 'Использую Whisper в отдельном Web Worker.');
    await new Promise((resolve, reject) => {
      state.pendingReject = reject;
      worker.onerror = (event) => { event.preventDefault?.(); reject(new Error(event.message || 'Ошибка AI Worker.')); };
      worker.onmessageerror = () => reject(new Error('Не удалось получить ответ AI Worker.'));
      worker.onmessage = ({ data: m = {} }) => {
        if (!isCurrent() || m.jobId !== jobId) return;
        if (m.type === 'model-progress') {
          report(null,
            'ЗАГРУЖАЮ AI-МОДЕЛЬ', m.file || 'Первый запуск может занять время.');
        } else if (m.type === 'status' || m.type === 'engine') {
          report(null, 'WHISPER', m.message || 'AI-модель загружена.');
        } else if (m.type === 'backend-fallback') {
          ui.note.textContent = m.message || 'Пробую резервную модель.';
        } else if (m.type === 'chunk-progress') {
          report(null,
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

  async function prepareAudioFile(file, format, isCurrent) {
    if (state.audioBlob && state.audioType === format) return state.audioBlob;
    // Decode once to validate audio/duration and preserve PCM for subsequent Whisper runs.
    if (!state.cachedPCM) await extractAudio(file, isCurrent);
    if (!isCurrent()) return null;
    report(null, 'ПОДГОТОВКА АУДИО', 'Создаю ' + format.toUpperCase() + ' на этом устройстве.');
    const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js');
    if (!isCurrent()) return null;
    const ffmpeg = new FFmpeg();
    state.ffmpeg = ffmpeg;
    await ffmpeg.load({
      classWorkerURL: new URL('./video-ffmpeg-worker.js', location.href).href,
      coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
      wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
    });
    if (!isCurrent()) return null;
    await ffmpeg.writeFile('source.bin', new Uint8Array(await file.arrayBuffer()));
    if (!isCurrent()) return null;
    const output = 'audio.' + format;
    const common = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'source.bin',
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1'];
    let code = await ffmpeg.exec([...common, '-c:a', 'copy', output]);
    if (!isCurrent()) return null;
    if (code !== 0) code = await ffmpeg.exec([...common, '-c:a', format === 'mp3' ? 'libmp3lame' : 'aac', '-b:a', '128k', output]);
    if (!isCurrent()) return null;
    if (code !== 0) throw new Error('Не удалось создать ' + format.toUpperCase() + '. Попробуй другой формат аудио.');
    const data = await ffmpeg.readFile(output);
    if (!isCurrent()) return null;
    if (!data.byteLength) throw new Error('Аудиофайл пустой.');
    const blob = new Blob([data], { type: format === 'mp3' ? 'audio/mpeg' : 'audio/mp4' });
    state.audioBlob = blob;
    state.audioType = format;
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(blob);
    ui.audioPreview.src = state.audioUrl;
    ui.audioPreview.hidden = false;
    ffmpeg.terminate();
    if (state.ffmpeg === ffmpeg) state.ffmpeg = null;
    return blob;
  }
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function perform(action) {
    if (state.busy) { if (action === 'transcribe') stop(); return; }
    if (!state.source || state.overLimit) return;
    state.cancelled = false;
    const session = ++state.session;
    const isCurrent = () => state.session === session && !state.cancelled;
    if (action === 'transcribe') resetResult();
    else { state.lastProgress = 0; setError(''); }
    state.controller = new AbortController();
    const controller = state.controller;
    const timer = setTimeout(() => {
      if (isCurrent()) controller.abort(new DOMException('Загрузка заняла слишком много времени', 'TimeoutError'));
    }, 10 * 60 * 1000);
    busy(true);
    try {
      const file = await getFile(isCurrent);
      clearTimeout(timer);
      if (!isCurrent() || !file) return;
      if (action === 'video') {
        saveBlob(file, state.source.name);
        report(null, 'ГОТОВО', 'Файл передан браузеру для сохранения. Сохранён исходный формат, без перекодирования.');
      } else if (action === 'audio') {
        const format = ui.audioFormat.value;
        const blob = await prepareAudioFile(file, format, isCurrent);
        if (isCurrent() && blob) {
          saveBlob(blob, baseName() + '.' + format);
          report(null, 'ГОТОВО', 'Аудио готово для прослушивания и передано браузеру для сохранения.');
        }
      } else {
        const audio = await extractAudio(file, isCurrent);
        if (!isCurrent() || !audio) return;
        await transcribe(audio, isCurrent);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setError(readableError(error));
      report(null, 'ОШИБКА', 'Если часть текста уже распознана, она остаётся доступной.');
    } finally {
      clearTimeout(timer);
      if (isCurrent()) {
        state.ffmpeg?.terminate(); state.worker?.terminate();
        state.ffmpeg = null; state.worker = null; state.controller = null;
        state.pendingReject = null;
        busy(false);
      }
    }
  }
  function start() { return perform('transcribe'); }

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
    return (state.source?.name || state.file?.name || 'video').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
  }
  function srtTime(seconds) {
    const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const mm = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    return hh + ':' + mm + ':' + ss + ',' + String(ms % 1000).padStart(3, '0');
  }

  ui.sourceFile.addEventListener('click', () => sourceMode('file'));
  ui.sourceUrl.addEventListener('click', () => sourceMode('url'));
  ui.checkUrl.addEventListener('click', checkUrl);
  ui.urlInput.addEventListener('input', () => { if (!state.busy) select(null); });
  ui.urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') checkUrl(); });
  ui.downloadVideo.addEventListener('click', () => perform('video'));
  ui.downloadAudio.addEventListener('click', () => perform('audio'));
  ui.cancel.addEventListener('click', stop);
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
    if (!state.busy && state.mode === 'file') select(event.dataTransfer?.files?.[0]);
  });
  ui.preview.addEventListener('loadedmetadata', () => {
    if (!state.file || !Number.isFinite(ui.preview.duration) || ui.preview.currentSrc !== state.url) return;
    state.source.duration = ui.preview.duration;
    if (ui.preview.duration > MAX_SECONDS) {
      setError('Видео длиннее 90 минут. Раздели его на части.');
      state.overLimit = true;
    }
    showSource();
  });
  window.addEventListener('pagehide', () => {
    state.controller?.abort();
    clearAudio();
    state.ffmpeg?.terminate();
    state.worker?.terminate();
    if (state.url) URL.revokeObjectURL(state.url);
  });
  refreshActions();
})();