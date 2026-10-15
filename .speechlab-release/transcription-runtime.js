// Speech Lab v1.6.3. A failed ONNX runtime is never reused.
export function readableEngineError(error, candidate = {}) {
  const raw = String(error?.message ?? error?.code ?? error ?? '').trim();
  const model = String(candidate.modelId || 'Whisper').split('/').pop();
  const device = String(candidate.device || 'AI').toUpperCase();
  const phase = error?.phase === 'load' ? 'загрузке модели' : 'распознавании';
  if (/^-?\d+$/.test(raw)) {
    return `Сбой ONNX при ${phase}: ${model}, ${device}, код ${raw}.`;
  }
  if (error?.name === 'TimeoutError') {
    return `Нет ответа при ${phase}: ${model}, ${device}.`;
  }
  return `Не удалось выполнить обработку (${model}, ${device}): ${raw || 'неизвестная ошибка'}`;
}

function abortError() {
  const error = new Error('Распознавание остановлено пользователем.');
  error.name = 'AbortError';
  return error;
}

class EngineClient {
  constructor(candidate, jobId, emit, WorkerClass, engineUrl, timeoutMs) {
    this.candidate = candidate;
    this.emit = emit;
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = null;
    this.worker = new WorkerClass(engineUrl, { type: 'module' });
    this.worker.onmessage = ({ data = {} }) => {
      const pending = this.pending;
      if (!pending || data.id !== pending.id) return;
      if (data.type === 'model-progress') {
        emit('model-progress', { ...candidate, progress: data.progress, file: data.file || '' });
      } else if (data.type === 'response') {
        this.settle(null, data.output);
      } else if (data.type === 'failure') {
        const error = new Error(String(data.message || 'Ошибка AI.'));
        error.name = data.name || 'Error';
        error.phase = data.phase || pending.phase;
        this.settle(error);
      }
    };
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      const error = new Error(event.message || 'Сбой дочернего Web Worker.');
      error.phase = this.pending?.phase;
      this.settle(error);
    };
    this.worker.onmessageerror = () => {
      const error = new Error('Не удалось прочитать ответ AI Worker.');
      error.phase = this.pending?.phase;
      this.settle(error);
    };
  }

  request(type, payload = {}, transfer = []) {
    if (!this.worker) return Promise.reject(abortError());
    if (this.pending) return Promise.reject(new Error('AI Worker уже занят.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const phase = type === 'load' ? 'load' : 'inference';
      const timer = setTimeout(() => {
        const error = new Error('AI Worker не ответил за отведённое время.');
        error.name = 'TimeoutError';
        error.phase = phase;
        this.settle(error);
        this.close();
      }, this.timeoutMs[phase]);
      this.pending = { id, phase, timer, resolve, reject };
      try { this.worker.postMessage({ type, id, ...payload }, transfer); }
      catch (error) { this.settle(error); }
    });
  }

  settle(error, output) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(output);
  }

  close() {
    this.settle(abortError());
    this.worker?.terminate();
    this.worker = null;
  }
}

export function createResilientTranscriber(candidates, jobId, emit, options = {}) {
  const WorkerClass = options.WorkerClass || globalThis.Worker;
  const engineUrl = options.engineUrl || new URL(
    './transcription-engine.js?build=v1.6.3-20261015-02', import.meta.url,
  );
  const timeoutMs = {
    load: options.loadTimeoutMs ?? 10 * 60 * 1000,
    inference: options.inferenceTimeoutMs ?? 10 * 60 * 1000,
  };
  const failures = [];
  let client = null;
  let index = 0;
  let cancelled = false;
  let busy = false;
  let current = null;
  let resolved = null;

  async function transcribe(audio, generationOptions) {
    if (cancelled) throw abortError();
    if (busy) throw new Error('Распознавание фрагмента уже выполняется.');
    if (!(audio instanceof Float32Array) || !audio.length) {
      throw new Error('Пустой или неподдерживаемый аудиофрагмент.');
    }
    busy = true;
    try {
      while (index < candidates.length) {
        if (cancelled) throw abortError();
        const candidate = candidates[index];
        current = candidate;
        try {
          if (!client) {
            emit('status', {
              stage: 'model',
              message: `Загружаю ${candidate.modelId.split('/').pop()} через ${candidate.device.toUpperCase()}…`,
            });
            client = new EngineClient(candidate, jobId, emit, WorkerClass, engineUrl, timeoutMs);
            await client.request('load', { candidate });
            if (cancelled) throw abortError();
            emit('engine', { ...candidate, cached: false });
          }
          // Transfer a COPY only. The supervisor retains the original chunk for retries.
          const copy = audio.slice();
          const result = await client.request('infer', {
            audioBuffer: copy.buffer,
            options: generationOptions,
          }, [copy.buffer]);
          if (cancelled) throw abortError();
          if (!result || typeof result.text !== 'string') {
            throw new Error('AI вернул некорректный результат вместо текста.');
          }
          resolved = candidate;
          return result;
        } catch (error) {
          client?.close();
          client = null;
          // Only our explicit cancellation flag means the user pressed Stop.
          // An AbortError raised by the model/backend still needs fallback.
          if (cancelled) throw abortError();
          const message = readableEngineError(error, candidate);
          failures.push({ ...candidate, phase: error?.phase || 'inference', message });
          index += 1;
          if (index < candidates.length) {
            const next = candidates[index];
            emit('backend-fallback', {
              from: `${candidate.modelId.split('/').pop()} / ${candidate.device}`,
              to: `${next.modelId.split('/').pop()} / ${next.device}`,
              message: `${message} Переключаюсь на ${next.modelId.split('/').pop()} (${next.device.toUpperCase()}).`,
            });
          }
        }
      }
      const last = failures.at(-1)?.message || 'Нет доступного движка.';
      const error = new Error(`Не удалось распознать запись: все резервные движки недоступны. ${last} Запись не удалена; уже полученный текст сохранён.`);
      error.attempts = failures.slice();
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    transcribe,
    get current() { return resolved || current; },
    get attempts() { return failures.slice(); },
    close() {
      cancelled = true;
      client?.close();
      client = null;
    },
  };
}
