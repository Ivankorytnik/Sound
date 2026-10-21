(() => {
  'use strict';

  const BUILD = {
    version: 'v1.6.4',
    date: '21.10.2026',
    time: '10:21',
    key: 'v1.6.4-20261021-01',
  };

  const MAX_FILE_SIZE = 300 * 1024 * 1024;
  const MAX_DURATION_SECONDS = 90 * 60;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    buildBadge: $('#buildBadge'), appVersion: $('#appVersion'), appBuildTime: $('#appBuildTime'), footerBuild: $('#footerBuild'),
    liveModeBtn: $('#liveModeBtn'), dictaphoneModeBtn: $('#dictaphoneModeBtn'), fileModeBtn: $('#fileModeBtn'),
    liveMode: $('#liveMode'), dictaphoneMode: $('#dictaphoneMode'), fileMode: $('#fileMode'),
    captureSourceMode: $('#captureSourceMode'), captureModeBadge: $('#captureModeBadge'), manualModeLabel: $('#manualModeLabel'),
    autoCaptureToggle: $('#autoCaptureToggle'), autoModeLabel: $('#autoModeLabel'), captureModeHint: $('#captureModeHint'),
    manualSourceWrap: $('#manualSourceWrap'), manualSourceSelect: $('#manualSourceSelect'), lastSourceRow: $('#lastSourceRow'), lastSourceText: $('#lastSourceText'),
    micToggle: $('#micToggle'), autoTranscribeToggle: $('#autoTranscribeToggle'), speakerLabelsToggle: $('#speakerLabelsToggle'), speakerConfig: $('#speakerConfig'),
    mySpeakerName: $('#mySpeakerName'), speakerName1: $('#speakerName1'), speakerName2: $('#speakerName2'), speakerName3: $('#speakerName3'),
    captureStatus: $('#captureStatus'), captureStatusText: $('#captureStatusText'), recordTimer: $('#recordTimer'),
    systemIndicator: $('#systemIndicator'), systemStatus: $('#systemStatus'), micIndicator: $('#micIndicator'), micStatus: $('#micStatus'),
    captureDiagnostic: $('#captureDiagnostic'), captureDiagnosticTitle: $('#captureDiagnosticTitle'), captureDiagnosticText: $('#captureDiagnosticText'),
    retryTabCaptureBtn: $('#retryTabCaptureBtn'), testMicBtn: $('#testMicBtn'),
    startCaptureBtn: $('#startCaptureBtn'), startCaptureBtnText: $('#startCaptureBtnText'), stopCaptureBtn: $('#stopCaptureBtn'),
    dictaphoneAutoTranscribeToggle: $('#dictaphoneAutoTranscribeToggle'), dictaphoneStatus: $('#dictaphoneStatus'),
    dictaphoneStatusText: $('#dictaphoneStatusText'), dictaphoneTimer: $('#dictaphoneTimer'), dictaphoneMicIndicator: $('#dictaphoneMicIndicator'),
    dictaphoneMicStatus: $('#dictaphoneMicStatus'), startDictaphoneBtn: $('#startDictaphoneBtn'), stopDictaphoneBtn: $('#stopDictaphoneBtn'),
    fileInput: $('#fileInput'), dropzone: $('#dropzone'), fileCard: $('#fileCard'), fileLabel: $('#fileLabel'), fileName: $('#fileName'), fileMeta: $('#fileMeta'),
    removeFileBtn: $('#removeFileBtn'), audioPreview: $('#audioPreview'), downloadAudioBtn: $('#downloadAudioBtn'),
    languageSelect: $('#languageSelect'), modelSelect: $('#modelSelect'), qualitySelect: $('#qualitySelect'), cleanupSelect: $('#cleanupSelect'), engineHint: $('#engineHint'),
    transcribeBtn: $('#transcribeBtn'), transcribeBtnText: $('#transcribeBtnText'), progressWrap: $('#progressWrap'), progressBar: $('#progressBar'),
    progressValue: $('#progressValue'), statusText: $('#statusText'), statusNote: $('#statusNote'), resultEmpty: $('#resultEmpty'), resultBlock: $('#resultBlock'),
    transcript: $('#transcript'), wordCount: $('#wordCount'), segmentCount: $('#segmentCount'), audioDuration: $('#audioDuration'), segmentsList: $('#segmentsList'),
    segmentsBox: $('#segmentsBox'), copyBtn: $('#copyBtn'), downloadExcelBtn: $('#downloadExcelBtn'), downloadBtn: $('#downloadBtn'), toast: $('#toast'),
  };

  const state = {
    mode: 'live', selectedFile: null, previewUrl: null, recordedBlob: null, currentDuration: 0,
    transcriptionWorker: null, transcriptionJobId: null, transcriptionBusy: false, transcriptionStartedAt: 0,
    displayStream: null, micStream: null, mixContext: null, mixDestination: null, captureRecorder: null, captureChunks: [],
    captureStartedAt: 0, captureTimerId: null, captureStopping: false, captureStarting: false, captureRecordingError: null,
    dictaphoneStream: null, dictaphoneRecorder: null, dictaphoneChunks: [], dictaphoneStartedAt: 0, dictaphoneTimerId: null,
    dictaphoneStarting: false, dictaphoneStopping: false, dictaphoneRecordingError: null,
    lastSegments: [],
  };

  function safeStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function safeStorageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }

  function showToast(message, type = 'ok', timeout = 2600) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('error', type === 'error');
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), timeout);
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
    const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60;
    return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function timestampForFile() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  function setMode(mode) {
    state.mode = mode;
    const map = { live: [els.liveModeBtn, els.liveMode], dictaphone: [els.dictaphoneModeBtn, els.dictaphoneMode], file: [els.fileModeBtn, els.fileMode] };
    for (const [key, [btn, section]] of Object.entries(map)) {
      const active = key === mode;
      btn?.classList.toggle('active', active); btn?.setAttribute('aria-selected', active ? 'true' : 'false');
      section?.classList.toggle('hidden', !active);
    }
  }

  function setIndicator(indicator, textEl, connected, text) {
    indicator?.classList.toggle('connected', !!connected);
    indicator?.classList.toggle('error', connected === false && /ошиб|нет|запрещ|без звука|не передан/i.test(text || ''));
    if (textEl) textEl.textContent = text;
  }

  function setCaptureStatus(kind, text) {
    if (els.captureStatus) els.captureStatus.className = `capture-status ${kind}`;
    if (els.captureStatusText) els.captureStatusText.textContent = text;
  }

  function showCaptureDiagnostic(title, text, options = {}) {
    if (!els.captureDiagnostic) return;
    els.captureDiagnostic.classList.remove('hidden');
    els.captureDiagnostic.classList.toggle('warning', options.warning !== false);
    els.captureDiagnosticTitle.textContent = title;
    els.captureDiagnosticText.textContent = text;
    els.retryTabCaptureBtn?.classList.toggle('hidden', options.retryTab === false);
    els.testMicBtn?.classList.toggle('hidden', options.testMic === false);
  }

  function hideCaptureDiagnostic() { els.captureDiagnostic?.classList.add('hidden'); }

  function preferredSurface() {
    if (!els.autoCaptureToggle?.checked) return els.manualSourceSelect?.value || 'browser';
    return safeStorageGet('speechlab.lastSurface') || 'browser';
  }

  function updateCaptureModeUI() {
    const auto = !!els.autoCaptureToggle?.checked;
    els.captureModeBadge.textContent = auto ? 'AUTO' : 'MANUAL';
    els.manualSourceWrap?.classList.toggle('hidden', auto);
    els.captureModeHint.textContent = auto
      ? 'РЕКОМЕНДУЕМЫЙ: открою системный выбор с последним удачным типом источника. Источник всегда подтверждается вручную в окне браузера.'
      : 'РУЧНОЙ: выбери, какую вкладку системного окна браузера показать первой.';
    els.startCaptureBtnText.textContent = auto ? 'НАЙТИ И НАЧАТЬ' : 'ВЫБРАТЬ И НАЧАТЬ';
  }

  function displaySurfaceLabel(value) {
    return ({ browser: 'Вкладка браузера', window: 'Окно приложения', monitor: 'Экран целиком' })[value] || 'Выбранный источник';
  }

  function mediaErrorMessage(error, what) {
    const name = error?.name || '';
    if (name === 'NotAllowedError') return `${what}: доступ не разрешён. Проверь разрешения сайта в адресной строке браузера.`;
    if (name === 'NotFoundError') return `${what}: подходящее устройство не найдено.`;
    if (name === 'NotReadableError') return `${what}: устройство занято другим приложением или недоступно системе.`;
    if (name === 'AbortError') return `${what}: браузер прервал подключение.`;
    if (name === 'InvalidStateError') return `${what}: запуск должен быть выполнен кликом по кнопке на активной вкладке.`;
    return `${what}: ${error?.message || 'не удалось подключить источник.'}`;
  }

  function chooseRecorderMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  async function getMicrophoneStream() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Браузер не поддерживает доступ к микрофону.');
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }

  async function startCapture() {
  if (state.captureStarting || state.captureStopping || state.captureRecorder) return;
  if (state.transcriptionBusy) return showToast('Сначала останови распознавание.', 'error');
  if (state.dictaphoneStarting || state.dictaphoneRecorder) return showToast('Сначала останови диктофон.', 'error');
  hideCaptureDiagnostic();
  if (!window.isSecureContext) {
    setCaptureStatus('error', 'НУЖЕН HTTPS');
    showCaptureDiagnostic('Браузер заблокировал захват', 'Открой Speech Lab по HTTPS. На обычном HTTP захват аудио недоступен.', { retryTab: false });
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
    setCaptureStatus('error', 'ЗАХВАТ НЕ ПОДДЕРЖИВАЕТСЯ');
    showCaptureDiagnostic('Браузер не поддерживается', 'Используй актуальный Chrome или Edge на компьютере.', { retryTab: false });
    return;
  }
  state.captureStarting = true;
  els.startCaptureBtn.disabled = true;
  try {
    stopMediaStream(state.displayStream);
    stopMediaStream(state.micStream);
    state.displayStream = null;
    state.micStream = null;
    setCaptureStatus('working', 'ВЫБЕРИ ИСТОЧНИК В ОКНЕ БРАУЗЕРА');
    setIndicator(els.systemIndicator, els.systemStatus, null, 'Звук встречи: ожидаю выбор…');
    setIndicator(els.micIndicator, els.micStatus, null, els.micToggle.checked ? 'Микрофон: подключу после выбора…' : 'Микрофон: выключен');
    const surface = preferredSurface();
    const constraints = {
      video: { displaySurface: surface },
      audio: { suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
    };
    try {
      state.displayStream = await navigator.mediaDevices.getDisplayMedia(constraints);
    } catch (error) {
      const cancelled = error?.name === 'NotAllowedError' || error?.name === 'AbortError';
      setCaptureStatus(cancelled ? 'idle' : 'error', cancelled ? 'ВЫБОР ОТМЕНЁН' : 'ОШИБКА ВЫБОРА ИСТОЧНИКА');
      setIndicator(els.systemIndicator, els.systemStatus, false, 'Звук встречи: не подключён');
      setIndicator(els.micIndicator, els.micStatus, false, 'Микрофон: не подключён');
      if (!cancelled) showCaptureDiagnostic('Не удалось открыть источник', mediaErrorMessage(error, 'Захват экрана'), { testMic: true });
      return;
    }
    const videoTrack = state.displayStream.getVideoTracks()[0];
    const actualSurface = videoTrack?.getSettings?.().displaySurface || surface;
    safeStorageSet('speechlab.lastSurface', actualSurface);
    els.lastSourceText.textContent = displaySurfaceLabel(actualSurface);
    let micError = null;
    if (els.micToggle.checked) {
      try { state.micStream = await getMicrophoneStream(); }
      catch (error) { micError = error; state.micStream = null; }
    }
    const systemTracks = state.displayStream.getAudioTracks().filter((t) => t.readyState === 'live');
    const systemOk = systemTracks.length > 0;
    const micOk = !!state.micStream?.getAudioTracks?.().some((t) => t.readyState === 'live');
    setIndicator(els.systemIndicator, els.systemStatus, systemOk, systemOk
      ? `Звук встречи: подключён${systemTracks[0].label ? ` · ${systemTracks[0].label}` : ''}`
      : 'Звук встречи: НЕ ПЕРЕДАН браузером');
    setIndicator(els.micIndicator, els.micStatus, els.micToggle.checked ? micOk : null,
      !els.micToggle.checked ? 'Микрофон: выключен' : micOk ? 'Микрофон: подключён' : mediaErrorMessage(micError, 'Микрофон'));
    if (!systemOk && !micOk) {
      stopMediaStream(state.displayStream);
      stopMediaStream(state.micStream);
      state.displayStream = null;
      state.micStream = null;
      setCaptureStatus('error', 'ИСТОЧНИКИ БЕЗ ЗВУКА');
      showNoSystemAudioHelp(actualSurface, micError);
      return;
    }
    if (!systemOk) showNoSystemAudioHelp(actualSurface, micError, true);
    const recordStream = await buildAudioMix(state.displayStream, state.micStream);
    const mimeType = chooseRecorderMime();
    state.captureChunks = [];
    state.captureRecordingError = null;
    const recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
    state.captureRecorder = recorder;
    recorder.addEventListener('dataavailable', ({ data }) => { if (data?.size) state.captureChunks.push(data); });
    recorder.addEventListener('stop', () => { void finishCaptureRecording(); }, { once: true });
    recorder.addEventListener('error', (event) => {
      state.captureRecordingError = event.error?.message || 'Ошибка MediaRecorder.';
      setCaptureStatus('error', 'ОШИБКА ЗАПИСИ');
      showCaptureDiagnostic('Сбой записи', state.captureRecordingError, { retryTab: true });
      stopCapture();
    });
    recorder.start(1000);
    state.captureStartedAt = Date.now();
    startTimer('capture');
    setCaptureStatus(systemOk ? 'recording' : 'warning', systemOk ? 'ИДЁТ ЗАПИСЬ' : 'ЗАПИСЬ ТОЛЬКО С МИКРОФОНА');
    els.startCaptureBtn.classList.add('hidden');
    els.stopCaptureBtn.classList.remove('hidden');
    videoTrack?.addEventListener('ended', () => stopCapture(), { once: true });
    showToast(systemOk ? 'Захват звука начат' : 'Системный звук не получен — пишется только микрофон', systemOk ? 'ok' : 'error', 4200);
  } catch (error) {
    stopTimer('capture');
    stopMediaStream(state.displayStream);
    stopMediaStream(state.micStream);
    stopMediaStream(state.mixDestination?.stream);
    state.displayStream = null;
    state.micStream = null;
    try { await state.mixContext?.close?.(); } catch {}
    state.mixContext = null;
    state.mixDestination = null;
    state.captureRecorder = null;
    state.captureStopping = false;
    els.startCaptureBtn.classList.remove('hidden');
    els.stopCaptureBtn.classList.add('hidden');
    setCaptureStatus('error', 'НЕ УДАЛОСЬ СОЗДАТЬ ЗАПИСЬ');
    showCaptureDiagnostic('Ошибка записи', error?.message || String(error), { retryTab: true });
  } finally {
    state.captureStarting = false;
    els.startCaptureBtn.disabled = state.transcriptionBusy;
  }
}

  function showNoSystemAudioHelp(surface, micError, micOnly = false) {
    let text;
    if (surface === 'browser') {
      text = 'Вкладка выбрана, но браузер не передал её аудио. Повтори захват, выбери вкладку Zoom/Толк/Meet и включи «Также передавать аудио вкладки» / «Share tab audio» в системном окне.';
    } else if (surface === 'window') {
      text = 'Окно приложения выбрано без аудиодорожки. Для Zoom/Толк в браузере надёжнее выбрать «Вкладка браузера». Для Zoom Desktop попробуй «Экран целиком» с системным аудио — поддержка зависит от ОС и браузера.';
    } else {
      text = 'Экран выбран без системной аудиодорожки. На некоторых ОС браузер не умеет отдавать звук всего экрана. Если встреча открыта в браузере — выбери именно вкладку и включи передачу аудио.';
    }
    if (micError) text += ` Микрофон тоже не подключён: ${mediaErrorMessage(micError, 'микрофон')}`;
    if (micOnly) text += ' Сейчас Speech Lab может записывать только твой микрофон; звук собеседников в запись не попадёт.';
    showCaptureDiagnostic('Звук встречи не получен', text, { retryTab: true, testMic: true });
  }

  async function buildAudioMix(displayStream, micStream) {
  const systemTracks = (displayStream?.getAudioTracks?.() || []).filter((track) => track.readyState === 'live');
  const micTracks = (micStream?.getAudioTracks?.() || []).filter((track) => track.readyState === 'live');
  if (!systemTracks.length && !micTracks.length) throw new Error('Нет доступных аудиодорожек для записи.');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return new MediaStream([...systemTracks, ...micTracks]);
  state.mixContext = new AudioContextClass();
  await state.mixContext.resume();
  if (state.mixContext.state !== 'running') throw new Error('Аудиомикшер не запустился. Проверь разрешение воспроизведения в браузере.');
  state.mixDestination = state.mixContext.createMediaStreamDestination();
  if (systemTracks.length) {
    const source = new MediaStream(systemTracks);
    state.mixContext.createMediaStreamSource(source).connect(state.mixDestination);
  }
  if (micTracks.length) {
    const source = new MediaStream(micTracks);
    state.mixContext.createMediaStreamSource(source).connect(state.mixDestination);
  }
  return state.mixDestination.stream;
}

  function startTimer(kind) {
    const isCapture = kind === 'capture';
    const started = isCapture ? state.captureStartedAt : state.dictaphoneStartedAt;
    const el = isCapture ? els.recordTimer : els.dictaphoneTimer;
    const tick = () => { if (el) el.textContent = formatTime((Date.now() - started) / 1000); };
    tick();
    const id = setInterval(tick, 500);
    if (isCapture) state.captureTimerId = id; else state.dictaphoneTimerId = id;
  }

  function stopTimer(kind) {
    const key = kind === 'capture' ? 'captureTimerId' : 'dictaphoneTimerId';
    clearInterval(state[key]); state[key] = null;
  }

  function stopMediaStream(stream) { stream?.getTracks?.().forEach((track) => { try { track.stop(); } catch {} }); }

  function stopCapture() {
  if (state.captureStopping || !state.captureRecorder) return;
  state.captureStopping = true;
  stopTimer('capture');
  setCaptureStatus('working', 'ЗАВЕРШАЮ ЗАПИСЬ…');
  try {
    if (state.captureRecorder.state !== 'inactive') state.captureRecorder.stop();
  } catch (error) {
    state.captureRecordingError = error?.message || String(error);
    void finishCaptureRecording();
  }
}

  async function finishCaptureRecording() {
  if (!state.captureRecorder) return;
  stopTimer('capture');
  const recorder = state.captureRecorder;
  const duration = Math.max(0, (Date.now() - state.captureStartedAt) / 1000);
  const mime = recorder.mimeType || 'audio/webm';
  const blob = new Blob(state.captureChunks, { type: mime });
  const hadError = !!state.captureRecordingError;
  state.captureRecorder = null;
  stopMediaStream(state.displayStream);
  stopMediaStream(state.micStream);
  stopMediaStream(state.mixDestination?.stream);
  state.displayStream = null;
  state.micStream = null;
  try { await state.mixContext?.close?.(); } catch {}
  state.mixContext = null;
  state.mixDestination = null;
  state.captureStopping = false;
  els.startCaptureBtn.classList.remove('hidden');
  els.startCaptureBtn.disabled = state.transcriptionBusy;
  els.stopCaptureBtn.classList.add('hidden');
  setIndicator(els.systemIndicator, els.systemStatus, null, 'Звук встречи: не подключён');
  setIndicator(els.micIndicator, els.micStatus, null, 'Микрофон: не подключён');
  if (!blob.size) {
    setCaptureStatus('error', 'ПУСТАЯ ЗАПИСЬ');
    showCaptureDiagnostic('Аудиоданные не записались', 'Проверь, что хотя бы один источник подключён.', { retryTab: true });
    return;
  }
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  const file = new File([blob], `meeting_${timestampForFile()}.${ext}`, { type: mime });
  const accepted = selectFile(file, { label: 'ЗАПИСЬ РАЗГОВОРА', duration, keepMode: true, recorded: true });
  if (!accepted) {
    await downloadBlob(blob, file.name);
    showToast('Запись слишком длинная для распознавания — сохранена как аудиофайл.', 'error', 6200);
    return;
  }
  setCaptureStatus(hadError ? 'warning' : 'idle', hadError ? 'ЗАПИСЬ ПРЕРВАНА · АУДИО СОХРАНЕНО' : 'ЗАПИСЬ ГОТОВА');
  if (hadError) showToast('Запись прервалась. Доступную часть можно скачать.', 'error', 5200);
  else if (els.autoTranscribeToggle.checked) await startTranscription();
}

  async function testMicrophone() {
    els.testMicBtn.disabled = true;
    try {
      const stream = await getMicrophoneStream();
      setIndicator(els.micIndicator, els.micStatus, true, 'Микрофон: разрешение работает');
      showToast('Микрофон доступен');
      stopMediaStream(stream);
    } catch (error) {
      setIndicator(els.micIndicator, els.micStatus, false, mediaErrorMessage(error, 'Микрофон'));
      showCaptureDiagnostic('Микрофон недоступен', mediaErrorMessage(error, 'Микрофон'), { retryTab: true, testMic: false });
    } finally { els.testMicBtn.disabled = false; }
  }

  async function startDictaphone() {
  if (state.dictaphoneStarting || state.dictaphoneStopping || state.dictaphoneRecorder) return;
  if (state.transcriptionBusy) return showToast('Сначала останови распознавание.', 'error');
  if (state.captureStarting || state.captureRecorder) return showToast('Сначала останови захват разговора.', 'error');
  if (!window.isSecureContext || !window.MediaRecorder) return showToast('Для диктофона нужен HTTPS и поддержка MediaRecorder.', 'error');
  state.dictaphoneStarting = true;
  els.startDictaphoneBtn.disabled = true;
  try {
    state.dictaphoneStream = await getMicrophoneStream();
    setIndicator(els.dictaphoneMicIndicator, els.dictaphoneMicStatus, true, 'Микрофон: подключён');
    const mimeType = chooseRecorderMime();
    state.dictaphoneChunks = [];
    state.dictaphoneRecordingError = null;
    const recorder = new MediaRecorder(state.dictaphoneStream, mimeType ? { mimeType } : undefined);
    state.dictaphoneRecorder = recorder;
    recorder.addEventListener('dataavailable', ({ data }) => { if (data?.size) state.dictaphoneChunks.push(data); });
    recorder.addEventListener('stop', () => { void finishDictaphone(); }, { once: true });
    recorder.addEventListener('error', (event) => {
      state.dictaphoneRecordingError = event.error?.message || 'Ошибка MediaRecorder.';
      stopDictaphone();
    });
    recorder.start(1000);
    state.dictaphoneStartedAt = Date.now();
    startTimer('dictaphone');
    els.dictaphoneStatus.className = 'capture-status recording';
    els.dictaphoneStatusText.textContent = 'ИДЁТ ЗАПИСЬ';
    els.startDictaphoneBtn.classList.add('hidden');
    els.stopDictaphoneBtn.classList.remove('hidden');
    state.dictaphoneStream.getAudioTracks().forEach((track) => track.addEventListener('ended', stopDictaphone, { once: true }));
  } catch (error) {
    stopTimer('dictaphone');
    stopMediaStream(state.dictaphoneStream);
    state.dictaphoneStream = null;
    state.dictaphoneRecorder = null;
    state.dictaphoneStopping = false;
    els.dictaphoneStatus.className = 'capture-status error';
    els.dictaphoneStatusText.textContent = 'МИКРОФОН НЕДОСТУПЕН';
    setIndicator(els.dictaphoneMicIndicator, els.dictaphoneMicStatus, false, mediaErrorMessage(error, 'Микрофон'));
    showToast(mediaErrorMessage(error, 'Микрофон'), 'error', 4200);
  } finally {
    state.dictaphoneStarting = false;
    els.startDictaphoneBtn.disabled = state.transcriptionBusy;
  }
}

  function stopDictaphone() {
  if (state.dictaphoneStopping || !state.dictaphoneRecorder) return;
  state.dictaphoneStopping = true;
  stopTimer('dictaphone');
  els.dictaphoneStatus.className = 'capture-status working';
  els.dictaphoneStatusText.textContent = 'ЗАВЕРШАЮ ЗАПИСЬ…';
  try {
    if (state.dictaphoneRecorder.state !== 'inactive') state.dictaphoneRecorder.stop();
  } catch (error) {
    state.dictaphoneRecordingError = error?.message || String(error);
    void finishDictaphone();
  }
}

  async function finishDictaphone() {
  if (!state.dictaphoneRecorder) return;
  stopTimer('dictaphone');
  const recorder = state.dictaphoneRecorder;
  const duration = Math.max(0, (Date.now() - state.dictaphoneStartedAt) / 1000);
  const mime = recorder.mimeType || 'audio/webm';
  const blob = new Blob(state.dictaphoneChunks, { type: mime });
  const hadError = !!state.dictaphoneRecordingError;
  state.dictaphoneRecorder = null;
  stopMediaStream(state.dictaphoneStream);
  state.dictaphoneStream = null;
  state.dictaphoneStopping = false;
  els.startDictaphoneBtn.classList.remove('hidden');
  els.startDictaphoneBtn.disabled = state.transcriptionBusy;
  els.stopDictaphoneBtn.classList.add('hidden');
  els.dictaphoneStatus.className = `capture-status ${blob.size ? hadError ? 'warning' : 'idle' : 'error'}`;
  els.dictaphoneStatusText.textContent = !blob.size ? 'ПУСТАЯ ЗАПИСЬ' : hadError ? 'ЗАПИСЬ ПРЕРВАНА · СОХРАНЕНА' : 'ЗАПИСЬ ГОТОВА';
  setIndicator(els.dictaphoneMicIndicator, els.dictaphoneMicStatus, null, 'Микрофон: не подключён');
  if (!blob.size) return showToast('Не удалось сохранить аудио диктофона.', 'error');
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
  const file = new File([blob], `dictaphone_${timestampForFile()}.${ext}`, { type: mime });
  const accepted = selectFile(file, { label: 'ДИКТОФОН', duration, keepMode: true, recorded: true });
  if (!accepted) {
    await downloadBlob(blob, file.name);
    showToast('Запись слишком длинная для распознавания — сохранена как аудиофайл.', 'error', 6200);
    return;
  }
  if (hadError) showToast('Запись прервалась. Доступную часть можно скачать.', 'error', 5200);
  else if (els.dictaphoneAutoTranscribeToggle.checked) await startTranscription();
}

  function looksLikeMedia(file) {
    if (!file) return false;
    return file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|aac|ogg|webm|mp4|mpeg|mpga)$/i.test(file.name || '');
  }

  function validateSelectedFile(file, duration = null) {
  if (!file || file.size === 0) throw new Error('Аудиофайл пустой.');
  if (file.size > MAX_FILE_SIZE) throw new Error('Файл больше 300 МБ. Раздели запись на части.');
  if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) throw new Error('Запись длиннее 90 минут. Раздели её на части.');
}

  function selectFile(file, options = {}) {
  if (state.transcriptionBusy) {
    showToast('Сначала останови распознавание, затем выбери другой файл.', 'error', 4500);
    return false;
  }
  if (!looksLikeMedia(file)) {
    showToast('Нужен аудио- или видеофайл.', 'error');
    return false;
  }
  try { validateSelectedFile(file, options.duration); }
  catch (error) { showToast(error.message, 'error', 5200); return false; }
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  els.audioPreview.pause();
  state.selectedFile = file;
  state.recordedBlob = options.recorded ? file : null;
  state.currentDuration = Number.isFinite(options.duration) ? options.duration : 0;
  resetResult();
  els.fileLabel.textContent = options.label || 'ФАЙЛ';
  els.fileName.textContent = file.name || 'audio';
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
  els.fileCard.classList.remove('hidden');
  els.transcribeBtn.disabled = false;
  els.downloadAudioBtn?.classList.toggle('hidden', !options.recorded);
  state.previewUrl = URL.createObjectURL(file);
  els.audioPreview.src = state.previewUrl;
  els.audioPreview.classList.remove('hidden');
  els.audioPreview.load();
  if (!options.keepMode && state.mode !== 'file') setMode('file');
  updateEngineHint();
  return true;
}

  function clearFile() {
  if (state.transcriptionBusy) return;
  state.selectedFile = null;
  state.recordedBlob = null;
  state.currentDuration = 0;
  state.lastSegments = [];
  els.fileInput.value = '';
  els.fileCard.classList.add('hidden');
  els.audioPreview.pause();
  els.audioPreview.classList.add('hidden');
  els.audioPreview.removeAttribute('src');
  els.audioPreview.load();
  els.downloadAudioBtn?.classList.add('hidden');
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  els.transcribeBtn.disabled = true;
  els.progressWrap.classList.add('hidden');
  resetResult();
}

  function resetResult() {
    els.resultEmpty.classList.remove('hidden'); els.resultBlock.classList.add('hidden'); els.transcript.value = '';
    els.wordCount.textContent = '0'; els.segmentCount.textContent = '0'; els.audioDuration.textContent = '—'; els.segmentsList.innerHTML = '';
    els.segmentsBox.open = false; state.lastSegments = [];
  }

  function setProgress(percent, title, note = '') {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    els.progressWrap.classList.remove('hidden'); els.progressBar.style.width = `${p}%`; els.progressValue.textContent = `${p}%`;
    els.statusText.textContent = title; els.statusNote.textContent = note;
  }

  function setTranscriptionBusy(value) {
  state.transcriptionBusy = value;
  els.transcribeBtn.disabled = !value && !state.selectedFile;
  els.fileInput.disabled = value;
  els.removeFileBtn.disabled = value;
  els.startCaptureBtn.disabled = value || state.captureStarting;
  els.startDictaphoneBtn.disabled = value || state.dictaphoneStarting;
  els.languageSelect.disabled = value;
  els.modelSelect.disabled = value;
  els.qualitySelect.disabled = value;
  els.cleanupSelect.disabled = value;
  els.transcribeBtnText.textContent = value ? 'ОСТАНОВИТЬ' : 'РАСПОЗНАТЬ РЕЧЬ';
}

  function getProfile() {
    let q = els.qualitySelect.value;
    if (q === 'auto') q = 'balanced';
    const profiles = {
      fast: { quality: 'fast', model: 'auto', chunk: 29, overlap: 0, vad: true, detailedTimestamps: false },
      balanced: { quality: 'balanced', model: 'auto', chunk: 28, overlap: 3, vad: true, detailedTimestamps: false },
      accurate: { quality: 'accurate', model: 'auto', chunk: 27, overlap: 4, vad: true, detailedTimestamps: true },
      max: { quality: 'max', model: 'auto', chunk: 26, overlap: 5, vad: true, detailedTimestamps: true },
      noisy: { quality: 'noisy', model: 'auto', chunk: 20, overlap: 4, vad: true, detailedTimestamps: true },
    };
    const p = { ...profiles[q] };
    if (els.modelSelect.value !== 'auto') p.model = els.modelSelect.value;
    p.cleanup = els.cleanupSelect.value;
    return p;
  }

  function updateEngineHint() {
    const p = getProfile();
    const hasGpu = !!navigator.gpu;
    let modelName;
    if (p.model !== 'auto') {
      modelName = p.model.includes('large-v3-turbo') ? 'Whisper Large-v3-Turbo' : p.model.includes('small') ? 'Whisper Small' : p.model.includes('tiny') ? 'Whisper Tiny' : 'Whisper Base';
    } else if (p.quality === 'fast') {
      modelName = 'Whisper Tiny';
    } else if (p.quality === 'accurate' || p.quality === 'max') {
      modelName = hasGpu ? 'Whisper Large-v3-Turbo' : 'Whisper Small / Base fallback';
    } else if (p.quality === 'balanced' || p.quality === 'noisy') {
      modelName = hasGpu ? 'Whisper Small' : 'Whisper Base';
    } else {
      modelName = 'Whisper Auto';
    }
    const extra = p.quality === 'max' ? ' + повторная проверка сомнительных фрагментов' : p.quality === 'accurate' ? ' + beam search и точные таймкоды' : '';
    els.engineHint.textContent = `${p.quality.toUpperCase()} · ${modelName} · блок ${p.chunk} сек${p.overlap ? ` + перекрытие ${p.overlap} сек` : ''}${extra}. AI работает в отдельном Worker.`;
  }

  async function decodeToMono16k(file, jobId = null) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Браузер не поддерживает AudioContext.');
  validateSelectedFile(file);
  const ctx = new AudioContextClass();
  try {
    const buffer = await file.arrayBuffer();
    if (jobId !== null && state.transcriptionJobId !== jobId) return null;
    const decoded = await ctx.decodeAudioData(buffer);
    if (jobId !== null && state.transcriptionJobId !== jobId) return null;
    validateSelectedFile(file, decoded.duration);
    state.currentDuration = decoded.duration;
    const targetRate = 16000;
    const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, length, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    if (jobId !== null && state.transcriptionJobId !== jobId) return null;
    return new Float32Array(rendered.getChannelData(0));
  } catch (error) {
    if (/длиннее 90 минут|больше 300 МБ|пустой/u.test(error?.message || '')) throw error;
    throw new Error(`Не удалось обработать аудиофайл: ${error?.message || 'попробуй MP3, WAV, M4A или WEBM.'}`);
  } finally {
    try { await ctx.close(); } catch {}
  }
}

  function createWorker() {
    return new Worker(`./transcription-worker.js?build=${BUILD.key}`, { type: 'module' });
  }

  let webGpuAvailablePromise;
  function detectWebGPU() {
    if (!webGpuAvailablePromise) {
      webGpuAvailablePromise = (async () => {
        if (!navigator.gpu?.requestAdapter) return false;
        try { return !!(await navigator.gpu.requestAdapter()); }
        catch { return false; }
      })();
    }
    return webGpuAvailablePromise;
  }

  async function startTranscription() {
  if (state.transcriptionBusy) { cancelTranscription(); return; }
  if (!state.selectedFile) return;
  if (state.captureStarting || state.captureRecorder || state.captureStopping || state.dictaphoneStarting || state.dictaphoneRecorder || state.dictaphoneStopping) {
    showToast('Сначала заверши аудиозапись.', 'error');
    return;
  }
  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.transcriptionJobId = jobId;
  const isCurrent = () => state.transcriptionJobId === jobId && state.transcriptionBusy;
  resetResult();
  setTranscriptionBusy(true);
  setProgress(2, 'ПОДГОТОВКА АУДИО', 'Декодирую и привожу запись к 16 кГц mono…');
  state.transcriptionStartedAt = performance.now();
  try {
    const audio = await decodeToMono16k(state.selectedFile, jobId);
    if (!isCurrent()) return;
    const profile = getProfile();
    setProgress(8, 'АУДИО ГОТОВО', `${formatTime(state.currentDuration)} · ${profile.quality.toUpperCase()} · ${profile.model === 'auto' ? 'автоматический выбор модели' : profile.model.split('/').pop()}`);
    const hasWebGPU = await detectWebGPU();
    if (!isCurrent()) return;
    const worker = createWorker();
    state.transcriptionWorker = worker;
    let displayedProgress = 8;
    const reportProgress = (percent, title, note = '') => {
      if (!Number.isFinite(percent)) return;
      displayedProgress = Math.max(displayedProgress, percent);
      setProgress(displayedProgress, title, note);
    };
    let lastPartial = '';
    worker.onmessage = (event) => {
      if (!isCurrent() || state.transcriptionWorker !== worker) return;
      const msg = event.data || {};
      if (msg.jobId && msg.jobId !== jobId) return;
      if (msg.type === 'model-progress') {
        reportProgress(8 + (msg.progress * 0.18), 'ЗАГРУЖАЮ AI-МОДЕЛЬ', msg.file ? `Модель: ${msg.file}` : 'Первый запуск может занять время.');
      } else if (msg.type === 'status') {
        reportProgress(20, 'ГОТОВЛЮ WHISPER', msg.message || 'Запуск модели…');
      } else if (msg.type === 'engine') {
        reportProgress(27, 'WHISPER ГОТОВ', `Движок: ${String(msg.device || '').toUpperCase()} · модель ${msg.modelId?.split('/').pop() || ''}`);
      } else if (msg.type === 'chunk-progress') {
        const ratio = msg.total ? msg.index / msg.total : 0;
        const elapsed = (performance.now() - state.transcriptionStartedAt) / 1000;
        const eta = ratio > 0.03 ? Math.max(0, (elapsed / ratio) - elapsed) : null;
        reportProgress(28 + ratio * 69, `РАСПОЗНАЮ · ${msg.index}/${msg.total}`, `${msg.skipped ? `Пропущено тишины: ${msg.skipped}. ` : ''}${msg.retried ? `Перепроверено: ${msg.retried}. ` : ''}${Number.isFinite(eta) ? `Осталось ~${formatTime(eta)}.` : 'Считаю скорость…'}`);
        if (msg.partialText) {
          lastPartial = `${lastPartial} ${msg.partialText}`.replace(/\s+/g, ' ').trim();
          renderLiveText(lastPartial);
        }
      } else if (msg.type === 'quality-check') {
        const current = Number.isFinite(msg.index) ? `${msg.index}/${msg.total || '?'}` : '';
        els.statusNote.textContent = `${msg.message || 'Перепроверяю фрагмент…'} ${current}`.trim();
      } else if (msg.type === 'backend-fallback') {
        els.statusNote.textContent = msg.message || 'Пробую более лёгкую модель.';
        showToast('AI переключается на резервную модель.', 'error', 4200);
      } else if (msg.type === 'result') {
        try {
          renderResult(msg.output);
          const hasText = !!els.transcript.value.trim();
          setProgress(100, hasText ? 'ГОТОВО' : 'РЕЧЬ НЕ НАЙДЕНА', hasText
            ? 'Текст можно редактировать, копировать и выгружать.'
            : 'Аудио обработано, но разборчивая речь не обнаружена. Проверь звук и язык.');
          showToast(hasText ? 'Распознавание завершено' : 'Речь не распознана — проверь источник и язык.', hasText ? 'ok' : 'error', 4500);
        } catch (error) {
          console.error('Не удалось показать стенограмму:', error);
          renderLiveText(String(msg.output?.text || lastPartial || ''));
          setProgress(100, 'ТЕКСТ ПОЛУЧЕН · ОШИБКА РАЗМЕТКИ', 'Текст доступен, но отображение сегментов завершилось с ошибкой.');
          showToast('Текст сохранён на странице, проверь разметку.', 'error', 5200);
        } finally {
          finishTranscriptionWorker();
        }
      } else if (msg.type === 'error') {
        throwWorkerError(msg.message || 'Ошибка распознавания.');
      } else if (msg.type === 'cancelled') {
        setProgress(0, 'ОСТАНОВЛЕНО', 'Распознавание остановлено пользователем.');
        finishTranscriptionWorker();
      }
    };
    worker.onerror = (event) => {
      if (!isCurrent() || state.transcriptionWorker !== worker) return;
      event.preventDefault?.();
      throwWorkerError(event.message || 'Ошибка Web Worker.');
    };
    worker.onmessageerror = () => {
      if (isCurrent() && state.transcriptionWorker === worker) throwWorkerError('Браузер не смог прочитать ответ AI Worker.');
    };
    worker.postMessage({
      type: 'transcribe', jobId, audioBuffer: audio.buffer, modelId: profile.model,
      preferredDevice: hasWebGPU ? 'webgpu' : 'wasm', language: els.languageSelect.value,
      chunkSeconds: profile.chunk, overlapSeconds: profile.overlap, useVad: profile.vad,
      vadThreshold: profile.quality === 'noisy' ? 0.0055 : 0.0035,
      detailedTimestamps: profile.detailedTimestamps, cleanup: profile.cleanup, quality: profile.quality,
    }, [audio.buffer]);
  } catch (error) {
    if (!isCurrent()) return;
    console.error(error);
    setProgress(0, 'ОШИБКА', error?.message || 'Не удалось распознать запись.');
    showToast(error?.message || 'Ошибка распознавания', 'error', 5200);
    finishTranscriptionWorker();
  }
}

  function throwWorkerError(message) {
    const completed = Number.parseFloat(els.progressValue.textContent) || 0;
    setProgress(completed, 'ОШИБКА AI', message); showToast(message, 'error', 4500); finishTranscriptionWorker();
  }

  function cancelTranscription() {
    if (!state.transcriptionBusy) return;
    const worker = state.transcriptionWorker;
    const jobId = state.transcriptionJobId;
    // Invalidate the job BEFORE allowing another one to start.
    state.transcriptionWorker = null;
    state.transcriptionJobId = null;
    setTranscriptionBusy(false);
    setProgress(0, 'ОСТАНОВЛЕНО', 'Распознавание остановлено пользователем.');
    if (!worker) return;

    // This timer owns ONLY the old worker and never touches current UI state.
    const stopTimer = setTimeout(() => worker.terminate(), 800);
    const closeOldWorker = () => { clearTimeout(stopTimer); worker.terminate(); };
    worker.onmessage = ({ data = {} }) => {
      if (data.jobId && data.jobId !== jobId) return;
      if (['cancelled', 'result', 'error'].includes(data.type)) closeOldWorker();
    };
    worker.onerror = closeOldWorker;
    try { worker.postMessage({ type: 'cancel', jobId }); }
    catch { closeOldWorker(); }
  }

  function finishTranscriptionWorker() {
    state.transcriptionWorker?.terminate(); state.transcriptionWorker = null; state.transcriptionJobId = null; setTranscriptionBusy(false);
  }

  function renderLiveText(text) {
    els.resultEmpty.classList.add('hidden'); els.resultBlock.classList.remove('hidden'); els.transcript.value = text;
    updateWordCount(); els.audioDuration.textContent = formatTime(state.currentDuration);
  }

  function renderResult(output) {
  const transcript = String(output?.text || '').trim();
  const rawChunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const chunks = rawChunks.filter((chunk) => chunk && typeof chunk === 'object').map((chunk) => {
    const ts = Array.isArray(chunk.timestamp) ? chunk.timestamp : [];
    const start = Number.isFinite(ts[0]) ? Math.max(0, ts[0]) : 0;
    const end = Number.isFinite(ts[1]) ? Math.max(start, ts[1]) : start;
    return {
      text: String(chunk.text || '').trim(),
      speaker: String(chunk.speaker || ''),
      timestamp: [start, end],
    };
  }).filter((chunk) => chunk.text);
  state.lastSegments = chunks;
  els.transcript.value = transcript;
  updateWordCount();
  els.segmentCount.textContent = String(chunks.length);
  els.audioDuration.textContent = formatTime(state.currentDuration);
  els.segmentsList.replaceChildren();
  const speakerNames = [...new Set([els.mySpeakerName, els.speakerName1, els.speakerName2, els.speakerName3]
    .map((input) => input?.value?.trim()).filter(Boolean))];
  for (const [index, chunk] of chunks.entries()) {
    const row = document.createElement('div');
    row.className = 'segment';
    const t = document.createElement('div');
    t.className = 'segment-time';
    t.textContent = `${formatTime(chunk.timestamp[0])}–${formatTime(chunk.timestamp[1])}`;
    const x = document.createElement('div');
    x.className = 'segment-text';
    x.textContent = chunk.text;
    if (els.speakerLabelsToggle?.checked && speakerNames.length) {
      const select = document.createElement('select');
      select.className = 'segment-speaker';
      select.setAttribute('aria-label', `Говорящий в сегменте ${index + 1}`);
      select.append(new Option('Без имени', ''));
      speakerNames.forEach((name) => select.append(new Option(name, name)));
      select.value = chunk.speaker;
      select.addEventListener('change', () => { chunk.speaker = select.value; rebuildTranscriptFromSegments(); });
      row.append(t, select, x);
    } else row.append(t, x);
    els.segmentsList.append(row);
  }
  els.segmentsBox.classList.toggle('hidden', chunks.length === 0);
  els.resultEmpty.classList.add('hidden');
  els.resultBlock.classList.remove('hidden');
}

  function rebuildTranscriptFromSegments() {
    if (!state.lastSegments.length) return;
    els.transcript.value = state.lastSegments.map((segment) => {
      const text = String(segment.text || '').trim();
      return segment.speaker ? `${segment.speaker}: ${text}` : text;
    }).filter(Boolean).join('\n');
    updateWordCount();
  }

  function updateWordCount() {
    const text = els.transcript.value.trim(); els.wordCount.textContent = String(text ? text.split(/\s+/u).filter(Boolean).length : 0);
  }

  async function copyTranscript() {
  const text = els.transcript.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Буфер обмена недоступен');
    await navigator.clipboard.writeText(text);
    showToast('Текст скопирован');
  } catch {
    try {
      els.transcript.focus();
      els.transcript.select();
      if (!document.execCommand('copy')) throw new Error('Браузер запретил копирование');
      showToast('Текст скопирован');
    } catch {
      showToast('Не удалось скопировать автоматически — выдели текст и нажми Ctrl+C.', 'error', 5200);
    }
  }
}

  function safeBaseName() {
    return (state.selectedFile?.name || 'transcript').replace(/\.[^.]+$/, '').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').slice(0, 80) || 'transcript';
  }

  function downloadText() {
    const text = els.transcript.value.trim(); if (!text) return showToast('Текста пока нет', 'error');
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeBaseName()}_transcript.txt`);
  }

  function downloadAudio() {
  if (!state.recordedBlob) return showToast('Записи пока нет', 'error');
  const fileName = state.selectedFile?.name || `recording_${timestampForFile()}.webm`;
  void downloadBlob(state.recordedBlob, fileName);
}

  async function downloadBlob(blob, filename) {
  if (window.SpeechLabFiles?.save) return window.SpeechLabFiles.save(blob, filename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

  async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  if (!sheetJsLoadPromise) {
    sheetJsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('Модуль Excel не загрузился корректно.'));
      script.onerror = () => reject(new Error('Не удалось загрузить модуль Excel. Проверь интернет.'));
      document.head.appendChild(script);
    });
  }
  try { return await sheetJsLoadPromise; }
  catch (error) { sheetJsLoadPromise = null; throw error; }
}

  async function downloadExcel() {
  const text = els.transcript.value.trim();
  if (!text) return showToast('Текста пока нет', 'error');
  try {
    const XLSX = await loadSheetJS();
    const wb = XLSX.utils.book_new();
    const meta = [
      ['Speech Lab', BUILD.version], ['Сборка', `${BUILD.date} ${BUILD.time}`],
      ['Источник', state.selectedFile?.name || ''], ['Длительность', formatTime(state.currentDuration)],
      [''], ['Распознанный текст'], [text],
    ];
    const wsText = XLSX.utils.aoa_to_sheet(meta);
    wsText['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wsText, 'Текст');
    const rows = [['№', 'Начало', 'Конец', 'Говорящий', 'Текст']];
    state.lastSegments.forEach((segment, index) => {
      const ts = segment.timestamp || [];
      rows.push([index + 1, formatTime(ts[0]), formatTime(ts[1]), segment.speaker || '', segment.text || '']);
    });
    const wsSeg = XLSX.utils.aoa_to_sheet(rows);
    wsSeg['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, wsSeg, 'Сегменты');
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await downloadBlob(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeBaseName()}_transcript.xlsx`);
    showToast('Excel подготовлен');
  } catch (error) {
    showToast(error?.message || 'Не удалось создать Excel', 'error', 5200);
  }
}

  function bindEvents() {
    els.liveModeBtn.addEventListener('click', () => setMode('live'));
    els.dictaphoneModeBtn.addEventListener('click', () => setMode('dictaphone'));
    els.fileModeBtn.addEventListener('click', () => setMode('file'));
    els.autoCaptureToggle.addEventListener('change', updateCaptureModeUI);
    els.manualSourceSelect.addEventListener('change', updateCaptureModeUI);
    els.speakerLabelsToggle.addEventListener('change', () => els.speakerConfig.classList.toggle('hidden', !els.speakerLabelsToggle.checked));
    els.startCaptureBtn.addEventListener('click', startCapture); els.stopCaptureBtn.addEventListener('click', stopCapture);
    els.retryTabCaptureBtn?.addEventListener('click', () => { els.autoCaptureToggle.checked = false; els.manualSourceSelect.value = 'browser'; updateCaptureModeUI(); startCapture(); });
    els.testMicBtn?.addEventListener('click', testMicrophone);
    els.startDictaphoneBtn.addEventListener('click', startDictaphone); els.stopDictaphoneBtn.addEventListener('click', stopDictaphone);
    els.fileInput.addEventListener('change', (e) => { selectFile(e.target.files?.[0]); e.target.value = ''; }); els.removeFileBtn.addEventListener('click', clearFile);
    els.transcribeBtn.addEventListener('click', startTranscription); els.copyBtn.addEventListener('click', copyTranscript); els.downloadBtn.addEventListener('click', downloadText);
    els.downloadExcelBtn.addEventListener('click', downloadExcel); els.downloadAudioBtn.addEventListener('click', downloadAudio);
    els.transcript.addEventListener('input', updateWordCount);
    for (const t of ['dragenter','dragover']) els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.add('dragging'); });
    for (const t of ['dragleave','drop']) els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.remove('dragging'); });
    els.dropzone.addEventListener('drop', (e) => selectFile(e.dataTransfer?.files?.[0]));
    els.audioPreview.addEventListener('loadedmetadata', () => {
      if (!state.selectedFile || !Number.isFinite(els.audioPreview.duration)) return;
      if (els.audioPreview.duration > MAX_DURATION_SECONDS) {
        clearFile();
        showToast('Файл длиннее 90 минут. Раздели запись на части.', 'error', 5200);
        return;
      }
      state.currentDuration = els.audioPreview.duration;
      els.fileMeta.textContent = `${formatBytes(state.selectedFile.size)} · ${formatTime(state.currentDuration)} · ${state.selectedFile.type || 'медиафайл'}`;
      updateEngineHint();
    });
    [els.modelSelect, els.qualitySelect, els.languageSelect, els.cleanupSelect].forEach((el) => el.addEventListener('change', updateEngineHint));
    window.addEventListener('beforeunload', (event) => {
      if (state.captureRecorder || state.captureStarting || state.dictaphoneRecorder || state.dictaphoneStarting || state.transcriptionBusy) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    window.addEventListener('pagehide', () => {
      stopMediaStream(state.displayStream); stopMediaStream(state.micStream); stopMediaStream(state.dictaphoneStream);
      state.transcriptionWorker?.terminate();
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    });
  }

  function init() {
    els.appVersion.textContent = BUILD.version; els.appBuildTime.textContent = `${BUILD.date} · ${BUILD.time}`; els.footerBuild.textContent = `Версия ${BUILD.version} · сборка ${BUILD.date} ${BUILD.time}`;
    const lastSurface = safeStorageGet('speechlab.lastSurface'); if (lastSurface) els.lastSourceText.textContent = displaySurfaceLabel(lastSurface);
    setMode('live'); updateCaptureModeUI(); updateEngineHint(); bindEvents();
    setCaptureStatus('idle', 'ГОТОВ К ЗАХВАТУ');
  }

  init();
})();
