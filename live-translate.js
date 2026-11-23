(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const core = window.SpeechLiveCore;
  const ui = {
    prepare: $('livePrepare'), start: $('liveStart'), stop: $('liveStop'),
    status: $('liveStatus'), error: $('liveError'), state: $('liveState'),
    duration: $('liveDuration'), dropped: $('liveDropped'), video: $('liveVideo'),
    ru: $('liveRu'), en: $('liveEn'), log: $('liveLog'), copy: $('liveCopy'),
    txt: $('liveTxt'), srt: $('liveSrt'), clear: $('liveClear'), popout: $('livePopout'),
  };
  const FRAME_SECONDS = 6;
  const SAMPLE_RATE = 16000;
  const state = {
    ready: false, loading: false, active: false, starting: false, stopping: false, draining: false,
    stopPromise: null, drainResolve: null, resampler: null, worker: null,
    stream: null, context: null, source: null, processor: null, sink: null,
    samples: [], length: 0, session: 0, index: 0, inFlight: false,
    queue: null, dropped: 0, started: 0, elapsed: 0, timer: null,
    segments: [], channel: null,
  };

  function status(message, label) {
    ui.status.textContent = message;
    if (label) ui.state.textContent = label;
  }
  function error(message) {
    ui.error.hidden = !message;
    ui.error.textContent = message || '';
  }
  function buttons() {
    ui.prepare.disabled = state.loading || state.active || state.ready;
    ui.start.disabled = !state.ready || state.active || state.starting || state.stopping;
    ui.stop.disabled = !state.active;
    const hasText = state.segments.length > 0;
    ui.copy.disabled = ui.txt.disabled = ui.srt.disabled = !hasText;
    ui.clear.disabled = !hasText || state.active;
  }
  function elapsed() {
    return state.elapsed + (state.active ? (performance.now() - state.started) / 1000 : 0);
  }
  function updateClock() {
    ui.duration.textContent = core.clock(elapsed());
    ui.dropped.textContent = String(state.dropped);
  }
  function showError(message) {
    error(message);
    status('Ошибка: ' + message, 'ОШИБКА');
  }
  function updateCaptions(en, ru) {
    ui.en.textContent = en;
    ui.ru.textContent = ru;
    state.channel?.postMessage({ type: 'caption', en, ru });
  }
  function ensureWorker() {
    if (state.worker) return state.worker;
    const worker = new Worker('./live-translate-worker.js?build=20261123', { type: 'module' });
    worker.onmessage = ({ data = {} }) => {
      if (data.type === 'status') {
        if (!state.ready) status(data.message || 'Загружаю модели…', 'ЗАГРУЗКА');
      } else if (data.type === 'ready') {
        state.loading = false;
        state.ready = true;
        status('Модели загружены. Теперь выбери вкладку Толка со звуком.', 'ГОТОВО');
        buttons();
      } else if (data.type === 'segment') {
        if ((!state.active && !state.draining) || data.session !== state.session) return;
        if (!data.silent && data.ru) appendSegment(data);
        next();
      } else if (data.type === 'failure') {
        if (data.phase === 'init') {
          state.loading = false;
          state.ready = false;
          showError(data.message);
          worker.terminate();
          if (state.worker === worker) state.worker = null;
          buttons();
        } else if ((state.active || state.draining) && data.session === state.session) {
          state.dropped += 1;
          updateClock();
          error('Фрагмент не обработан: ' + data.message);
          next();
        }
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (state.active) void stop('Ошибка AI Worker. Запись прервана.');
      state.ready = false;
      state.loading = false;
      worker.terminate();
      if (state.worker === worker) state.worker = null;
      showError('Не удалось загрузить или запустить AI Worker.');
      buttons();
    };
    state.worker = worker;
    return worker;
  }
  async function prepare() {
    if (state.active || state.loading || state.ready) return;
    state.loading = true;
    error('');
    status('Проверяю WebGPU и подготавливаю локальные модели…', 'ЗАГРУЗКА');
    buttons();
    const worker = ensureWorker();
    const webgpu = Boolean(await navigator.gpu?.requestAdapter?.().catch(() => null));
    worker.postMessage({ type: 'init', webgpu });
  }
  function appendSegment(data) {
    const segment = { start: data.start, end: data.end, en: data.en, ru: data.ru };
    state.segments.push(segment);
    const line = document.createElement('div');
    line.className = 'live-line';
    const time = document.createElement('time');
    time.textContent = core.clock(segment.start) + ' — ' + core.clock(segment.end);
    const en = document.createElement('p');
    en.textContent = segment.en;
    const ru = document.createElement('strong');
    ru.textContent = segment.ru;
    line.append(time, en, ru);
    ui.log.append(line);
    ui.log.scrollTop = ui.log.scrollHeight;
    updateCaptions(segment.en, segment.ru);
    buttons();
  }
  function next() {
    state.inFlight = false;
    if ((state.active || state.draining) && state.queue) {
      const item = state.queue;
      state.queue = null;
      dispatch(item);
      return;
    }
    if (state.draining && state.drainResolve) state.drainResolve();
  }
  function dispatch(item) {
    if (!state.active && !state.draining) return;
    if (state.inFlight) {
      if (state.queue) state.dropped += 1;
      state.queue = item;
      updateClock();
      return;
    }
    state.inFlight = true;
    state.worker.postMessage({
      type: 'infer', session: state.session, index: item.index,
      start: item.start, end: item.end, audioBuffer: item.audio.buffer,
    }, [item.audio.buffer]);
  }
  function flush() {
    if (!state.length) return;
    const audio = new Float32Array(state.length);
    let p = 0;
    for (const part of state.samples) { audio.set(part, p); p += part.length; }
    const end = (state.index + 1) * FRAME_SECONDS;
    const item = {
      index: state.index, start: state.index * FRAME_SECONDS,
      end: Math.min(end, elapsed()), audio,
    };
    state.index += 1;
    state.samples = [];
    state.length = 0;
    dispatch(item);
  }
  function collect(samples) {
    if (!state.active) return;
    let pos = 0;
    while (pos < samples.length) {
      const remaining = FRAME_SECONDS * SAMPLE_RATE - state.length;
      const count = Math.min(remaining, samples.length - pos);
      const slice = samples.slice(pos, pos + count);
      state.samples.push(slice);
      state.length += slice.length;
      pos += count;
      if (state.length >= FRAME_SECONDS * SAMPLE_RATE) flush();
    }
  }
  async function start() {
    if (!state.ready || state.active || state.starting || state.stopping) return;
    state.starting = true;
    buttons();
    error('');
    let stream;
    let context;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Браузер не поддерживает захват вкладки. Используй настольный Chrome или Edge.');
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: false, selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude', systemAudio: 'include',
      });
      if (!stream.getAudioTracks().length) {
        throw new Error('Нет аудиодорожки. Повтори и выбери вкладку Толка с опцией «Также передавать аудио».');
      }
      context = new AudioContext();
      const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const processor = context.createScriptProcessor(4096, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      await context.resume();

      state.stream = stream;
      state.context = context;
      state.resampler = core.createStreamingResampler(context.sampleRate);
      state.source = source;
      state.processor = processor;
      state.sink = sink;
      state.session += 1;
      state.active = true;
      state.starting = false;
      state.draining = false;
      state.stopping = false;
      // New capture is a new timed transcript; never concatenate incompatible sessions.
      state.segments = [];
      ui.log.replaceChildren();
      updateCaptions('', 'Ожидаю английскую речь…');
      state.elapsed = 0;
      state.started = performance.now();
      state.index = 0;
      state.inFlight = false;
      state.queue = null;
      state.dropped = 0;
      state.samples = [];
      state.length = 0;
      processor.onaudioprocess = (event) => {
        if (!state.active) return;
        const input = event.inputBuffer.getChannelData(0);
        collect(state.resampler.push(input));
      };
      const current = state.session;
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (state.active && current === state.session) void stop('Демонстрация вкладки закончена.');
        }, { once: true });
      }
      ui.video.srcObject = stream;
      state.timer = setInterval(updateClock, 500);
      status('Звук вкладки подключён. Перевожу английскую речь фрагментами по 6 секунд.', 'ПЕРЕВОД');
      buttons();
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      if (state.active) await stop('Подключение отменено.');
      else {
        try { await context?.close(); } catch (_) { /* best effort */ }
        showError(e.name === 'NotAllowedError' ? 'Браузер не получил разрешение на захват вкладки.' : e.message);
      }
    } finally {
      state.starting = false;
      buttons();
    }
  }
  async function stop(message = 'Перевод остановлен.') {
    if (state.stopPromise) return state.stopPromise;
    if (!state.active && !state.stream) return;
    state.stopping = true;
    state.draining = true;
    state.active = false;
    state.elapsed = (performance.now() - state.started) / 1000;
    clearInterval(state.timer);
    state.timer = null;
    if (state.processor) state.processor.onaudioprocess = null;
    try { state.source?.disconnect(); } catch (_) { /* cleanup */ }
    try { state.processor?.disconnect(); } catch (_) { /* cleanup */ }
    try { state.sink?.disconnect(); } catch (_) { /* cleanup */ }
    state.stream?.getTracks().forEach((track) => track.stop());
    ui.video.srcObject = null;
    const context = state.context;
    state.stream = state.context = state.source = state.processor = state.sink = state.resampler = null;
    state.stopPromise = (async () => {
      try {
        await context?.close().catch(() => {});
        // Process the last partial fragment instead of dropping the end of the meeting.
        if (state.length) flush();
        if (state.inFlight || state.queue) {
          status('Останавливаю захват. Завершаю перевод последних фраз…', 'ЗАВЕРШЕНИЕ');
          const completed = await new Promise((resolve) => {
            let timer;
            state.drainResolve = () => { clearTimeout(timer); resolve(true); };
            timer = setTimeout(() => {
              state.drainResolve = null;
              resolve(false);
            }, 30000);
          });
          if (!completed) {
            state.dropped += Number(state.inFlight) + Number(Boolean(state.queue));
            error('Некоторые последние фразы не удалось завершить за 30 секунд.');
          }
        }
      } finally {
        state.session += 1;
        state.draining = false;
        state.queue = null;
        state.inFlight = false;
        state.samples = [];
        state.length = 0;
        state.drainResolve = null;
        state.stopping = false;
        state.stopPromise = null;
        status(message, 'ОСТАНОВЛЕНО');
        updateClock();
        buttons();
      }
    })();
    buttons();
    return state.stopPromise;
  }
  function transcript() {
    return state.segments.map((item) => '[' + core.clock(item.start) + ' – ' +
      core.clock(item.end) + ']\nEN: ' + item.en + '\nRU: ' + item.ru).join('\n\n');
  }
  function save(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  ui.prepare.addEventListener('click', prepare);
  ui.start.addEventListener('click', start);
  ui.stop.addEventListener('click', () => void stop());
  ui.copy.addEventListener('click', () => navigator.clipboard.writeText(transcript())
    .catch(() => showError('Не удалось скопировать текст.')));
  ui.txt.addEventListener('click', () => save('speechlab-talk-en-ru.txt', transcript(), 'text/plain;charset=utf-8'));
  ui.srt.addEventListener('click', () => save('speechlab-talk-ru.srt', core.toSrt(state.segments), 'text/plain;charset=utf-8'));
  ui.clear.addEventListener('click', () => {
    if (state.active || !confirm('Очистить текущий протокол?')) return;
    state.segments = [];
    ui.log.replaceChildren();
    updateCaptions('', 'После запуска здесь будет перевод английской речи.');
    buttons();
  });
  ui.popout.addEventListener('click', () => {
    window.open('./live-captions.html', 'speechlab-captions',
      'width=900,height=240,resizable=yes,scrollbars=yes');
  });
  window.addEventListener('pagehide', () => {
    if (state.active) void stop();
    state.worker?.terminate();
    state.channel?.close();
  });
  if (typeof BroadcastChannel !== 'undefined') {
    state.channel = new BroadcastChannel('speechlab-live-captions');
    state.channel.onmessage = ({ data = {} }) => {
      if (data.type === 'request') {
        state.channel.postMessage({ type: 'caption', en: ui.en.textContent, ru: ui.ru.textContent });
      }
    };
  }
  buttons();
})();
