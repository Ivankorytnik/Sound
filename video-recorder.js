/* Screen recording belongs only to video.html; no shared Speech Lab state. */
(() => {
  'use strict';
  window.SpeechVideoRecorder = function ({ onActive, onFile }) {
    const $ = id => document.getElementById('videoRecord' + id);
    const ui = Object.fromEntries(['Sound', 'Mic', 'Device', 'SoundStatus', 'MicStatus',
      'Timer', 'Status', 'Start', 'Pause', 'Resume', 'Stop', 'Save', 'Preview', 'Note'].map(id => [id, $(id)]));
    const hint = ui.Note.textContent;
    const MAX_BYTES = 280 * 1024 * 1024;
    const MAX_SECONDS = 90 * 60;
    let phase = 'idle', display = null, mic = null, context = null, mixed = null;
    let recorder = null, chunks = [], bytes = 0, timer = null, elapsed = 0, started = 0;
    let file = null, saved = true, reason = '', hasAudio = false, processing = false;
    let generation = 0;
    const supported = !!(window.isSecureContext && navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder);
    const active = () => ['picking', 'recording', 'paused', 'stopping'].includes(phase);
    const seconds = () => (elapsed + (phase === 'recording' ? performance.now() - started : 0)) / 1000;
    function drawTime() {
      const s = Math.floor(seconds());
      ui.Timer.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
        .map(x => String(x).padStart(2, '0')).join(':');
    }
    function update() {
      const locked = active();
      for (const control of [ui.Sound, ui.Mic]) control.disabled = locked || processing || !supported;
      ui.Device.disabled = locked || processing || !ui.Mic.checked || !supported;
      ui.Start.disabled = locked || processing || !supported;
      ui.Start.textContent = file ? 'Записать новое видео' : 'Выбрать источник и начать';
      ui.Pause.hidden = phase !== 'recording';
      ui.Resume.hidden = phase !== 'paused';
      ui.Stop.hidden = !['picking', 'recording', 'paused', 'stopping'].includes(phase);
      ui.Stop.disabled = phase === 'stopping';
      ui.Save.hidden = !file || file.size <= 300 * 1024 * 1024;
      ui.Save.disabled = locked;
      ui.Status.textContent = ({ idle: 'Готов к записи', picking: 'Выбор источника…',
        recording: '● Идёт запись', paused: 'Пауза', stopping: 'Сохраняю запись…', done: 'Запись готова' })[phase];
      drawTime();
    }
    function tracks(stream) { return stream?.getTracks() || []; }
    function cleanup() {
      clearInterval(timer); timer = null;
      for (const stream of [display, mic, mixed]) for (const track of tracks(stream)) track.stop();
      display = mic = mixed = null;
      if (context) context.close().catch(() => {});
      context = null;
      ui.Preview.pause(); ui.Preview.srcObject = null; ui.Preview.hidden = true;
    }
    function fail(error) {
      generation += 1;
      cleanup();
      phase = file ? 'done' : 'idle';
      ui.SoundStatus.textContent = 'Звук источника: не подключён';
      ui.MicStatus.textContent = 'Микрофон: не подключён';
      const messages = {
        NotAllowedError: 'Выбор отменён или доступ запрещён. Нажми кнопку и разреши захват экрана и выбранного микрофона.',
        NotFoundError: 'Источник или выбранный микрофон не найден. Проверь подключение и выбери устройство снова.',
        NotReadableError: 'Не удалось подключить источник. Проверь разрешения ОС и доступность устройства.',
        InvalidStateError: 'Не удалось начать захват. Открой эту страницу в активной вкладке и попробуй снова.',
      };
      ui.Note.textContent = messages[error?.name] || error?.message || 'Не удалось начать запись.';
      onActive(false); update();
    }
    async function devices() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const selected = ui.Device.value;
        ui.Device.replaceChildren(new Option('По умолчанию', ''));
        list.filter(x => x.kind === 'audioinput').forEach((x, index) =>
          ui.Device.add(new Option(x.label || 'Микрофон ' + (index + 1), x.deviceId)));
        if ([...ui.Device.options].some(x => x.value === selected)) ui.Device.value = selected;
      } catch { /* Default device remains available without enumeration permission. */ }
    }
    function finish() {
      const duration = seconds();
      generation += 1;
      elapsed = duration * 1000;
      const type = recorder.mimeType || chunks[0]?.type || 'video/webm';
      const parts = chunks;
      chunks = []; recorder = null;
      cleanup();
      if (!parts.length || !bytes) {
        phase = file ? 'done' : 'idle';
        ui.Note.textContent = reason || 'Запись пустая. Попробуй ещё раз.';
        onActive(false); update(); return;
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      file = new File(parts, 'Экран_' + stamp + (type.includes('mp4') ? '.mp4' : '.webm'), { type });
      saved = false;
      phase = 'done';
      onActive(false);
      if (file.size <= 300 * 1024 * 1024) onFile(file, { hasAudio, duration });
      ui.Note.textContent = (reason ? reason + ' ' : '') + 'Запись готова. ' +
        (file.size > 300 * 1024 * 1024 ? 'Файл больше лимита обработки. Нажми «Скачать запись».' :
          hasAudio ? 'Просмотри видео, скачай его или нажми «Распознать речь».' :
            'Аудиодорожки нет: можно посмотреть и скачать видео. Для транскрибации запиши видео со звуком.');
      update();
    }
    function stop(message = '') {
      if (!active() || phase === 'stopping') return;
      reason = message || reason;
      if (phase === 'picking') {
        generation += 1; cleanup(); phase = file ? 'done' : 'idle';
        ui.Note.textContent = 'Начало записи отменено.'; onActive(false); update(); return;
      }
      if (phase === 'recording') elapsed += performance.now() - started;
      phase = 'stopping'; clearInterval(timer);
      update();
      if (recorder?.state !== 'inactive') recorder.stop();
    }
    async function start() {
      if (!supported || active() || processing) return;
      if (file && !saved && !window.confirm('Предыдущая запись ещё не скачана. Заменить её новой записью?')) return;
      phase = 'picking'; reason = ''; const token = ++generation;
      ui.Note.textContent = hint;
      onActive(true); update();
      try {
        // This must remain the first asynchronous operation in the user click handler.
        const capture = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 25, max: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: ui.Sound.checked, systemAudio: ui.Sound.checked ? 'include' : 'exclude',
        });
        if (token !== generation) { tracks(capture).forEach(t => t.stop()); return; }
        display = capture;
        const videoTrack = display.getVideoTracks()[0];
        if (!videoTrack || videoTrack.readyState !== 'live') throw new Error('Источник видео уже закрыт. Выбери его снова.');
        videoTrack.addEventListener('ended', () => stop('Демонстрация экрана завершена.'));
        if (ui.Mic.checked) {
          const microphone = await navigator.mediaDevices.getUserMedia({ video: false, audio: {
            ...(ui.Device.value ? { deviceId: { exact: ui.Device.value } } : {}),
            echoCancellation: true, noiseSuppression: true,
          } });
          if (token !== generation) { tracks(microphone).forEach(t => t.stop()); return; }
          mic = microphone;
          await devices();
        }
        if (token !== generation) return;
        const sourceTracks = ui.Sound.checked ? display.getAudioTracks().filter(t => t.readyState === 'live') : [];
        const micTracks = mic?.getAudioTracks().filter(t => t.readyState === 'live') || [];
        hasAudio = !!(sourceTracks.length || micTracks.length);
        ui.SoundStatus.textContent = 'Звук источника: ' + (sourceTracks.length ? 'подключён' : ui.Sound.checked ? 'недоступен' : 'выключен');
        ui.MicStatus.textContent = 'Микрофон: ' + (micTracks.length ? 'подключён' : 'выключен');
        mixed = new MediaStream([videoTrack]);
        if (hasAudio) {
          context = new AudioContext();
          await context.resume();
          if (token !== generation) return;
          const output = context.createMediaStreamDestination();
          for (const track of [...sourceTracks, ...micTracks]) {
            const node = context.createMediaStreamSource(new MediaStream([track]));
            const gain = context.createGain();
            gain.gain.value = sourceTracks.length && micTracks.length ? 0.5 : 1;
            node.connect(gain).connect(output); // Never connect to speakers: avoids feedback.
            track.addEventListener('ended', () => stop('Один из источников звука отключён.'));
          }
          output.stream.getAudioTracks().forEach(t => mixed.addTrack(t));
        }
        if (videoTrack.readyState !== 'live') throw new Error('Демонстрация экрана завершена до начала записи.');
        const mimeType = (hasAudio ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'] :
          ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']).find(type => MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(mixed, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
        chunks = []; bytes = 0; elapsed = 0;
        recorder.ondataavailable = ({ data }) => {
          if (data.size) { chunks.push(data); bytes += data.size; }
          if (bytes >= MAX_BYTES) stop('Достигнут лимит размера записи.');
        };
        recorder.onstop = finish;
        recorder.onerror = () => stop('Браузер прервал запись. Сохранён доступный фрагмент.');
        recorder.start(1000);
        phase = 'recording'; started = performance.now();
        ui.Preview.srcObject = new MediaStream([videoTrack]);
        ui.Preview.hidden = false; ui.Preview.play().catch(() => {});
        ui.Note.textContent = ui.Sound.checked && !sourceTracks.length ?
          'Браузер не передал звук источника. ' + (micTracks.length ? 'Записывается только микрофон.' : 'Видео записывается без звука.') + ' Чтобы получить звук вкладки, останови запись и выбери вкладку с передачей аудио.' : hint;
        timer = setInterval(() => {
          drawTime();
          if (seconds() >= MAX_SECONDS) stop('Достигнут лимит 90 минут.');
        }, 250);
        update();
      } catch (error) { if (token === generation) fail(error); }
    }
    ui.Start.addEventListener('click', start);
    ui.Stop.addEventListener('click', () => stop());
    ui.Pause.addEventListener('click', () => {
      if (phase !== 'recording') return;
      try { recorder.pause(); elapsed += performance.now() - started; phase = 'paused'; update(); }
      catch { stop('Не удалось поставить запись на паузу.'); }
    });
    ui.Resume.addEventListener('click', () => {
      if (phase !== 'paused') return;
      try { recorder.resume(); started = performance.now(); phase = 'recording'; update(); }
      catch { stop('Не удалось продолжить запись.'); }
    });
    ui.Mic.addEventListener('change', () => { update(); devices(); });
    navigator.mediaDevices?.addEventListener('devicechange', devices);
    ui.Save.addEventListener('click', () => {
      if (!file) return;
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); saved = true;
    });
    window.addEventListener('beforeunload', event => {
      if (active() || (file && !saved)) { event.preventDefault(); event.returnValue = ''; }
    });
    window.addEventListener('pagehide', () => {
      generation += 1;
      if (recorder) { recorder.onstop = recorder.ondataavailable = null; if (recorder.state !== 'inactive') recorder.stop(); }
      chunks = []; cleanup();
    });
    if (!supported) ui.Note.textContent = 'Запись экрана недоступна. Открой страницу по HTTPS в настольном Chrome или Edge либо загрузи готовое видео.';
    update(); devices();
    return {
      setBusy(value) { processing = value; update(); },
      markSaved(value) { if (value === file) saved = true; },
      restore() { if (file && file.size <= 300 * 1024 * 1024) onFile(file, { hasAudio, duration: elapsed / 1000 }); },
    };
  };
})();
