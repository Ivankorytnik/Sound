(() => {
  'use strict';

  const BUILD = {
    version: 'v1.6.0',
    date: '03.09.2026',
    time: '12:00',
    key: 'v1.6.0-20260903-1200',
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
    captureStartedAt: 0, captureTimerId: null, captureStopping: false,
    dictaphoneStream: null, dictaphoneRecorder: null, dictaphoneChunks: [], dictaphoneStartedAt: 0, dictaphoneTimerId: null,
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
    if (state.captureRecorder?.state === 'recording' || state.captureStopping) return;
    hideCaptureDiagnostic();

    if (!window.isSecureContext) {
      setCaptureStatus('error', 'НУЖЕН HTTPS');
      showCaptureDiagnostic('Браузер заблокировал захват', 'Открой Speech Lab через HTTPS (GitHub Pages подходит). На обычном HTTP захват экрана и микрофона недоступен.', { retryTab: false });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureStatus('error', 'ЗАХВАТ НЕ ПОДДЕРЖИВАЕТСЯ');
      showCaptureDiagnostic('Нет Screen Capture API', 'Открой сайт в актуальном Chrome или Edge на компьютере.', { retryTab: false });
      return;
    }

    stopMediaStream(state.displayStream); stopMediaStream(state.micStream);
    state.displayStream = null; state.micStream = null;
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
      const cancelled = error?.name === 'NotAllowedError';
      setCaptureStatus(cancelled ? 'idle' : 'error', cancelled ? 'ВЫБОР ОТМЕНЁН' : 'ОШИБКА ВЫБОРА ИСТОЧНИКА');
      setIndicator(els.systemIndicator, els.systemStatus, false, 'Звук встречи: не подключён');
      setIndicator(els.micIndicator, els.micStatus, false, 'Микрофон: не подключён');
      if (!cancelled) showCaptureDiagnostic('Не удалось открыть источник', mediaErrorMessage(error, 'Захват экрана'), { testMic: true });
      return;
    }

    const videoTrack = state.displayStream.getVideoTracks()[0];
    const displayAudioTracks = state.displayStream.getAudioTracks();
    const actualSurface = videoTrack?.getSettings?.().displaySurface || surface;
    safeStorageSet('speechlab.lastSurface', actualSurface);
    els.lastSourceText.textContent = displaySurfaceLabel(actualSurface);

    let micError = null;
    if (els.micToggle.checked) {
      try { state.micStream = await getMicrophoneStream(); }
      catch (error) { micError = error; state.micStream = null; }
    }

    const systemOk = displayAudioTracks.length > 0 && displayAudioTracks.some((t) => t.readyState === 'live');
    const micOk = !!state.micStream?.getAudioTracks?.().some((t) => t.readyState === 'live');

    if (systemOk) {
      const label = displayAudioTracks[0]?.label ? ` · ${displayAudioTracks[0].label}` : '';
      setIndicator(els.systemIndicator, els.systemStatus, true, `Звук встречи: подключён${label}`);
    } else {
      setIndicator(els.systemIndicator, els.systemStatus, false, 'Звук встречи: НЕ ПЕРЕДАН браузером');
    }

    if (els.micToggle.checked) {
      setIndicator(els.micIndicator, els.micStatus, micOk, micOk ? 'Микрофон: подключён' : mediaErrorMessage(micError, 'Микрофон'));
    } else {
      setIndicator(els.micIndicator, els.micStatus, null, 'Микрофон: выключен');
    }

    if (!systemOk && !micOk) {
      stopMediaStream(state.displayStream); stopMediaStream(state.micStream); state.displayStream = null; state.micStream = null;
      setCaptureStatus('error', 'ИСТОЧНИКИ БЕЗ ЗВУКА');
      showNoSystemAudioHelp(actualSurface, micError);
      return;
    }

    if (!systemOk) {
      showNoSystemAudioHelp(actualSurface, micError, true);
    }

    try {
      const recordStream = await buildAudioMix(state.displayStream, state.micStream);
      const mimeType = chooseRecorderMime();
      state.captureChunks = [];
      state.captureRecorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
      state.captureRecorder.addEventListener('dataavailable', (event) => { if (event.data?.size) state.captureChunks.push(event.data); });
      state.captureRecorder.addEventListener('stop', finishCaptureRecording, { once: true });
      state.captureRecorder.addEventListener('error', (event) => {
        setCaptureStatus('error', 'ОШИБКА ЗАПИСИ');
        showCaptureDiagnostic('MediaRecorder остановлен', event.error?.message || 'Не удалось записать аудио.', { retryTab: true });
      });
      state.captureRecorder.start(1000);
      state.captureStartedAt = Date.now();
      startTimer('capture');
      setCaptureStatus(systemOk ? 'recording' : 'warning', systemOk ? 'ИДЁТ ЗАПИСЬ' : 'ЗАПИСЬ ТОЛЬКО С МИКРОФОНА');
      els.startCaptureBtn.classList.add('hidden');
      els.stopCaptureBtn.classList.remove('hidden');
      videoTrack?.addEventListener('ended', () => stopCapture(), { once: true });
      showToast(systemOk ? 'Захват звука начат' : 'Системный звук не получен — пишется только микрофон', systemOk ? 'ok' : 'error', 4200);
    } catch (error) {
      stopMediaStream(state.displayStream); stopMediaStream(state.micStream); state.displayStream = null; state.micStream = null;
      setCaptureStatus('error', 'НЕ УДАЛОСЬ СОЗДАТЬ ЗАПИСЬ');
      showCaptureDiagnostic('Ошибка аудиомикшера', error?.message || String(error), { retryTab: true });
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
    const tracks = [
      ...(displayStream?.getAudioTracks?.() || []),
      ...(micStream?.getAudioTracks?.() || []),
    ].filter((t) => t.readyState === 'live');
    if (!tracks.length) throw new Error('Нет доступных аудиодорожек для записи.');

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return new MediaStream(tracks);
    state.mixContext = new AudioContextClass();
    await state.mixContext.resume().catch(() => {});
    state.mixDestination = state.mixContext.createMediaStreamDestination();

    if (displayStream?.getAudioTracks?.().length) {
      const s = new MediaStream(displayStream.getAudioTracks());
      state.mixContext.createMediaStreamSource(s).connect(state.mixDestination);
    }
    if (micStream?.getAudioTracks?.().length) {
      const s = new MediaStream(micStream.getAudioTracks());
      state.mixContext.createMediaStreamSource(s).connect(state.mixDestination);
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
    if (state.captureStopping) return;
    state.captureStopping = true;
    stopTimer('capture');
    setCaptureStatus('working', 'ЗАВЕРШАЮ ЗАПИСЬ…');
    if (state.captureRecorder?.state === 'recording') state.captureRecorder.stop(); else finishCaptureRecording();
  }

  async function finishCaptureRecording() {
    const duration = Math.max(0, (Date.now() - state.captureStartedAt) / 1000);
    const mime = state.captureRecorder?.mimeType || 'audio/webm';
    const blob = new Blob(state.captureChunks, { type: mime });
    stopMediaStream(state.displayStream); stopMediaStream(state.micStream); stopMediaStream(state.mixDestination?.stream);
    state.displayStream = null; state.micStream = null;
    await state.mixContext?.close?.().catch(() => {}); state.mixContext = null; state.mixDestination = null;
    state.captureRecorder = null; state.captureStopping = false;
    els.startCaptureBtn.classList.remove('hidden'); els.stopCaptureBtn.classList.add('hidden');
    setIndicator(els.systemIndicator, els.systemStatus, null, 'Звук встречи: не подключён');
    setIndicator(els.micIndicator, els.micStatus, null, 'Микрофон: не подключён');

    if (blob.size > 0) {
      const ext = mime.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `meeting_${timestampForFile()}.${ext}`, { type: mime });
      selectFile(file, { label: 'ЗАПИСЬ РАЗГОВОРА', duration, keepMode: true });
      state.recordedBlob = blob;
      els.downloadAudioBtn?.classList.remove('hidden');
      setCaptureStatus('idle', 'ЗАПИСЬ ГОТОВА');
      if (els.autoTranscribeToggle.checked) await startTranscription();
    } else {
      setCaptureStatus('error', 'ПУСТАЯ ЗАПИСЬ');
      showCaptureDiagnostic('Аудиоданные не записались', 'Повтори захват и проверь, что хотя бы один источник показывает статус «подключён».', { retryTab: true });
    }
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
    if (state.dictaphoneRecorder?.state === 'recording') return;
    if (!window.isSecureContext) return showToast('Для микрофона нужен HTTPS', 'error');
    try {
      state.dictaphoneStream = await getMicrophoneStream();
      setIndicator(els.dictaphoneMicIndicator, els.dictaphoneMicStatus, true, 'Микрофон: подключён');
      const mime = chooseRecorderMime();
      state.dictaphoneChunks = [];
      state.dictaphoneRecorder = new MediaRecorder(state.dictaphoneStream, mime ? { mimeType: mime } : undefined);
      state.dictaphoneRecorder.addEventListener('dataavailable', (e) => { if (e.data?.size) state.dictaphoneChunks.push(e.data); });
      state.dictaphoneRecorder.addEventListener('stop', finishDictaphone, { once: true });
      state.dictaphoneRecorder.start(1000);
      state.dictaphoneStartedAt = Date.now(); startTimer('dictaphone');
      els.dictaphoneStatus.className = 'capture-status recording'; els.dictaphoneStatusText.textContent = 'ИДЁТ ЗАПИСЬ';
      els.startDictaphoneBtn.classList.add('hidden'); els.stopDictaphoneBtn.classList.remove('hidden');
    } catch (error) {
      els.dictaphoneStatus.className = 'capture-status error'; els.dictaphoneStatusText.textContent = 'МИКРОФОН НЕДОСТУПЕН';
      setIndicator(els.dictaphoneMicIndicator, els.dictaphoneMicStatus, false, mediaErrorMessage(error, 'Микрофон'));
      showToast(mediaErrorMessage(error, 'Микрофон'), 'error', 4200);
    }
  }

  function stopDictaphone() {
    stopTimer('dictaphone');
    if (state.dictaphoneRecorder?.state === 'recording') state.dictaphoneRecorder.stop();
  }

  async function finishDictaphone() {
    const duration = Math.max(0, (Date.now() - state.dictaphoneStartedAt) / 1000);
    const mime = state.dictaphoneRecorder?.mimeType || 'audio/webm';
    const blob = new Blob(state.dictaphoneChunks, { type: mime });
    stopMediaStream(state.dictaphoneStream); state.dictaphoneStream = null; state.dictaphoneRecorder = null;
    els.startDictaphoneBtn.classList.remove('hidden'); els.stopDictaphoneBtn.classList.add('hidden');
    els.dictaphoneStatus.className = 'capture-status idle'; els.dictaphoneStatusText.textContent = blob.size ? 'ЗАПИСЬ ГОТОВА' : 'ПУСТАЯ ЗАПИСЬ';
    setIndicator(els.dictaphoneMicIndicator, els.dictaphoneMicStatus, null, 'Микрофон: не подключён');
    if (!blob.size) return;
    const ext = mime.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([blob], `dictaphone_${timestampForFile()}.${ext}`, { type: mime });
    selectFile(file, { label: 'ДИКТОФОН', duration, keepMode: true });
    state.recordedBlob = blob; els.downloadAudioBtn?.classList.remove('hidden');
    if (els.dictaphoneAutoTranscribeToggle.checked) await startTranscription();
  }

  function looksLikeMedia(file) {
    if (!file) return false;
    return file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|aac|ogg|webm|mp4|mpeg|mpga)$/i.test(file.name || '');
  }

  function validateSelectedFile(file, duration = null) {
    if (file?.size > MAX_FILE_SIZE) throw new Error('Файл больше 300 МБ. Раздели запись на части перед распознаванием.');
    if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) throw new Error('Запись длиннее 90 минут. Раздели её на части, чтобы вкладка не исчерпала память.');
  }

  function selectFile(file, options = {}) {
    if (!looksLikeMedia(file)) return showToast('Нужен аудио- или видеофайл', 'error');
    try { validateSelectedFile(file, options.duration); }
    catch (error) { return showToast(error.message, 'error', 5200); }
    state.selectedFile = file; state.recordedBlob = file; resetResult();
    els.fileLabel.textContent = options.label || 'ФАЙЛ';
    els.fileName.textContent = file.name || 'audio';
    els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'медиафайл'}`;
    els.fileCard.classList.remove('hidden'); els.transcribeBtn.disabled = false;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file); els.audioPreview.src = state.previewUrl; els.audioPreview.classList.remove('hidden');
    if (Number.isFinite(options.duration)) state.currentDuration = options.duration;
    if (!options.keepMode && state.mode !== 'file') setMode('file');
    updateEngineHint();
  }

  function clearFile() {
    if (state.transcriptionBusy) return;
    state.selectedFile = null; state.recordedBlob = null; state.currentDuration = 0; state.lastSegments = [];
    els.fileInput.value = ''; els.fileCard.classList.add('hidden'); els.audioPreview.classList.add('hidden'); els.audioPreview.removeAttribute('src');
    els.downloadAudioBtn?.classList.add('hidden');
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); state.previewUrl = null;
    els.transcribeBtn.disabled = true; els.progressWrap.classList.add('hidden'); resetResult();
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
    els.fileInput.disabled = value; els.removeFileBtn.disabled = value;
    els.languageSelect.disabled = value; els.modelSelect.disabled = value; els.qualitySelect.disabled = value; els.cleanupSelect.disabled = value;
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

  async function decodeToMono16k(file) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Браузер не поддерживает AudioContext.');
    const ctx = new AudioContextClass();
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buffer.slice(0));
      validateSelectedFile(file, decoded.duration);
      state.currentDuration = decoded.duration;
      const targetRate = 16000;
      const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, length, targetRate);
      const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering();
      return new Float32Array(rendered.getChannelData(0));
    } catch (error) {
      throw new Error(`Не удалось декодировать аудио: ${error?.message || 'попробуй MP3/WAV/M4A/WEBM.'}`);
    } finally { await ctx.close().catch(() => {}); }
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
    resetResult(); setTranscriptionBusy(true); setProgress(2, 'ПОДГОТОВКА АУДИО', 'Декодирую и привожу запись к 16 кГц mono…');
    state.transcriptionStartedAt = performance.now();
    try {
      const audio = await decodeToMono16k(state.selectedFile);
      const profile = getProfile();
      setProgress(8, 'АУДИО ГОТОВО', `${formatTime(state.currentDuration)} · ${profile.quality.toUpperCase()} · ${profile.model === 'auto' ? 'умный выбор модели' : profile.model.split('/').pop()}`);
      const hasWebGPU = await detectWebGPU();
      const worker = createWorker(); state.transcriptionWorker = worker; state.transcriptionJobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const jobId = state.transcriptionJobId;
      let lastPartial = '';

      worker.onmessage = (event) => {
        const msg = event.data || {}; if (msg.jobId && msg.jobId !== jobId) return;
        if (msg.type === 'model-progress') {
          setProgress(8 + (msg.progress * 0.18), 'ЗАГРУЖАЮ AI-МОДЕЛЬ', msg.file ? `Модель: ${msg.file}` : 'Первый запуск может занять время.');
        } else if (msg.type === 'status') {
          setProgress(20, 'ГОТОВЛЮ WHISPER', msg.message || 'Запуск модели…');
        } else if (msg.type === 'engine') {
          setProgress(27, 'WHISPER ГОТОВ', `Движок: ${String(msg.device || '').toUpperCase()} · модель ${msg.modelId?.split('/').pop() || ''}`);
        } else if (msg.type === 'chunk-progress') {
          const ratio = msg.total ? msg.index / msg.total : 0;
          const p = 28 + ratio * 69;
          const elapsed = (performance.now() - state.transcriptionStartedAt) / 1000;
          const eta = ratio > 0.03 ? Math.max(0, (elapsed / ratio) - elapsed) : null;
          setProgress(p, `РАСПОЗНАЮ · ${msg.index}/${msg.total}`, `${msg.skipped ? `Пропущено тишины: ${msg.skipped}. ` : ''}${msg.retried ? `Перепроверено: ${msg.retried}. ` : ''}${Number.isFinite(eta) ? `Осталось ~${formatTime(eta)}.` : 'Считаю скорость…'}`);
          if (msg.partialText) {
            lastPartial = `${lastPartial} ${msg.partialText}`.replace(/\s+/g, ' ').trim();
            renderLiveText(lastPartial);
          }
        } else if (msg.type === 'quality-check') {
          const current = Number.isFinite(msg.index) ? `${msg.index}/${msg.total || '?'}` : '';
          els.statusNote.textContent = `${msg.message || 'Перепроверяю фрагмент…'} ${current}`.trim();
        } else if (msg.type === 'backend-fallback') {
          showToast('Переключаюсь на совместимый движок/модель', 'error', 3500);
        } else if (msg.type === 'result') {
          renderResult(msg.output); setProgress(100, 'ГОТОВО', 'Текст можно редактировать, копировать и выгружать в Excel.');
          finishTranscriptionWorker(); showToast('Распознавание завершено');
        } else if (msg.type === 'error') {
          throwWorkerError(msg.message || 'Ошибка распознавания.');
        } else if (msg.type === 'cancelled') {
          setProgress(0, 'ОСТАНОВЛЕНО', 'Распознавание остановлено пользователем.'); finishTranscriptionWorker();
        }
      };
      worker.onerror = (event) => throwWorkerError(event.message || 'Ошибка Web Worker.');
      const transferable = audio.buffer;
      worker.postMessage({
        type: 'transcribe', jobId, audioBuffer: transferable, modelId: profile.model,
        preferredDevice: hasWebGPU ? 'webgpu' : 'wasm', language: els.languageSelect.value,
        chunkSeconds: profile.chunk, overlapSeconds: profile.overlap, useVad: profile.vad,
        vadThreshold: profile.quality === 'noisy' ? 0.0055 : 0.0035,
        detailedTimestamps: profile.detailedTimestamps, cleanup: profile.cleanup, quality: profile.quality,
      }, [transferable]);
    } catch (error) {
      console.error(error); setProgress(0, 'ОШИБКА', error?.message || 'Не удалось распознать запись.'); showToast(error?.message || 'Ошибка распознавания', 'error', 4500); finishTranscriptionWorker();
    }
  }

  function throwWorkerError(message) {
    setProgress(0, 'ОШИБКА AI', message); showToast(message, 'error', 4500); finishTranscriptionWorker();
  }

  function cancelTranscription() {
    if (!state.transcriptionBusy) return;
    try { state.transcriptionWorker?.postMessage({ type: 'cancel', jobId: state.transcriptionJobId }); } catch {}
    setTimeout(() => { if (state.transcriptionBusy) { state.transcriptionWorker?.terminate(); setProgress(0, 'ОСТАНОВЛЕНО', 'Worker принудительно остановлен.'); finishTranscriptionWorker(); } }, 800);
  }

  function finishTranscriptionWorker() {
    state.transcriptionWorker?.terminate(); state.transcriptionWorker = null; state.transcriptionJobId = null; setTranscriptionBusy(false);
  }

  function renderLiveText(text) {
    els.resultEmpty.classList.add('hidden'); els.resultBlock.classList.remove('hidden'); els.transcript.value = text;
    updateWordCount(); els.audioDuration.textContent = formatTime(state.currentDuration);
  }

  function renderResult(output) {
    const text = String(output?.text || '').trim(); const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
    state.lastSegments = chunks; els.transcript.value = text; updateWordCount(); els.segmentCount.textContent = String(chunks.length); els.audioDuration.textContent = formatTime(state.currentDuration);
    els.segmentsList.innerHTML = '';
    const speakerNames = [els.mySpeakerName, els.speakerName1, els.speakerName2, els.speakerName3]
      .map((input) => input?.value?.trim()).filter(Boolean);
    for (const [index, chunk] of chunks.entries()) {
      const row = document.createElement('div'); row.className = 'segment';
      const t = document.createElement('div'); t.className = 'segment-time'; const ts = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0,0]; t.textContent = `${formatTime(ts[0])}–${formatTime(ts[1])}`;
      const x = document.createElement('div'); x.className = 'segment-text'; x.textContent = chunk.text || '';
      if (els.speakerLabelsToggle?.checked && speakerNames.length) {
        const select = document.createElement('select'); select.className = 'segment-speaker'; select.setAttribute('aria-label', `Говорящий в сегменте ${index + 1}`);
        select.append(new Option('Без имени', ''));
        speakerNames.forEach((name) => select.append(new Option(name, name)));
        select.value = chunk.speaker || '';
        select.addEventListener('change', () => { chunk.speaker = select.value; rebuildTranscriptFromSegments(); });
        row.append(t, select, x);
      } else row.append(t, x);
      els.segmentsList.append(row);
    }
    els.segmentsBox.classList.toggle('hidden', chunks.length === 0); els.resultEmpty.classList.add('hidden'); els.resultBlock.classList.remove('hidden');
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
    const text = els.transcript.value.trim(); if (!text) return showToast('Текста пока нет', 'error');
    try { await navigator.clipboard.writeText(text); showToast('Текст скопирован'); }
    catch { els.transcript.focus(); els.transcript.select(); document.execCommand('copy'); showToast('Текст скопирован'); }
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
    const ext = state.recordedBlob.type?.includes('ogg') ? 'ogg' : 'webm'; downloadBlob(state.recordedBlob, `${safeBaseName()}_audio.${ext}`);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadSheetJS() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('Не удалось загрузить модуль Excel. Проверь интернет.')); document.head.appendChild(s);
    });
    return window.XLSX;
  }

  async function downloadExcel() {
    const text = els.transcript.value.trim(); if (!text) return showToast('Текста пока нет', 'error');
    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.utils.book_new();
      const meta = [
        ['Speech Lab', BUILD.version], ['Сборка', `${BUILD.date} ${BUILD.time}`], ['Источник', state.selectedFile?.name || ''], ['Длительность', formatTime(state.currentDuration)], [''], ['Распознанный текст'], [text],
      ];
      const wsText = XLSX.utils.aoa_to_sheet(meta); wsText['!cols'] = [{ wch: 120 }];
      XLSX.utils.book_append_sheet(wb, wsText, 'Текст');
      const rows = [['№','Начало','Конец','Говорящий','Текст']];
      state.lastSegments.forEach((s,i) => { const ts = s.timestamp || []; rows.push([i+1, formatTime(ts[0]), formatTime(ts[1]), s.speaker || '', s.text || '']); });
      const wsSeg = XLSX.utils.aoa_to_sheet(rows); wsSeg['!cols'] = [{wch:6},{wch:12},{wch:12},{wch:20},{wch:100}];
      XLSX.utils.book_append_sheet(wb, wsSeg, 'Сегменты'); XLSX.writeFile(wb, `${safeBaseName()}_transcript.xlsx`); showToast('Excel выгружен');
    } catch (error) { showToast(error?.message || 'Не удалось создать Excel', 'error', 4200); }
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
    els.fileInput.addEventListener('change', (e) => selectFile(e.target.files?.[0])); els.removeFileBtn.addEventListener('click', clearFile);
    els.transcribeBtn.addEventListener('click', startTranscription); els.copyBtn.addEventListener('click', copyTranscript); els.downloadBtn.addEventListener('click', downloadText);
    els.downloadExcelBtn.addEventListener('click', downloadExcel); els.downloadAudioBtn.addEventListener('click', downloadAudio);
    els.transcript.addEventListener('input', updateWordCount);
    for (const t of ['dragenter','dragover']) els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.add('dragging'); });
    for (const t of ['dragleave','drop']) els.dropzone.addEventListener(t, (e) => { e.preventDefault(); els.dropzone.classList.remove('dragging'); });
    els.dropzone.addEventListener('drop', (e) => selectFile(e.dataTransfer?.files?.[0]));
    els.audioPreview.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(els.audioPreview.duration)) { state.currentDuration = els.audioPreview.duration; els.fileMeta.textContent = `${formatBytes(state.selectedFile?.size || 0)} · ${formatTime(state.currentDuration)} · ${state.selectedFile?.type || 'медиафайл'}`; updateEngineHint(); }
    });
    [els.modelSelect, els.qualitySelect, els.languageSelect, els.cleanupSelect].forEach((el) => el.addEventListener('change', updateEngineHint));
    window.addEventListener('beforeunload', () => { stopMediaStream(state.displayStream); stopMediaStream(state.micStream); stopMediaStream(state.dictaphoneStream); });
  }

  function init() {
    els.appVersion.textContent = BUILD.version; els.appBuildTime.textContent = `${BUILD.date} · ${BUILD.time}`; els.footerBuild.textContent = `Версия ${BUILD.version} · сборка ${BUILD.date} ${BUILD.time}`;
    const lastSurface = safeStorageGet('speechlab.lastSurface'); if (lastSurface) els.lastSourceText.textContent = displaySurfaceLabel(lastSurface);
    setMode('live'); updateCaptureModeUI(); updateEngineHint(); bindEvents();
    setCaptureStatus('idle', 'ГОТОВ К ЗАХВАТУ');
  }

  init();
})();
