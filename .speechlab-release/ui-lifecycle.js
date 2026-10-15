  async function startTranscription() {
    if (state.transcriptionBusy) { cancelTranscription(); return; }
    if (!state.selectedFile) return;
    const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.transcriptionJobId = jobId;
    const isCurrent = () => state.transcriptionJobId === jobId && state.transcriptionBusy;
    resetResult(); setTranscriptionBusy(true); setProgress(2, 'ПОДГОТОВКА АУДИО', 'Декодирую и привожу запись к 16 кГц mono…');
    state.transcriptionStartedAt = performance.now();
    try {
      const audio = await decodeToMono16k(state.selectedFile, jobId);
      if (!isCurrent()) return;
      const profile = getProfile();
      setProgress(8, 'АУДИО ГОТОВО', `${formatTime(state.currentDuration)} · ${profile.quality.toUpperCase()} · ${profile.model === 'auto' ? 'умный выбор модели' : profile.model.split('/').pop()}`);
      const hasWebGPU = await detectWebGPU();
      if (!isCurrent()) return;
      const worker = createWorker(); state.transcriptionWorker = worker;
      let displayedProgress = 8;
      const reportProgress = (percent, title, note = '') => {
        if (!Number.isFinite(percent)) return;
        displayedProgress = Math.max(displayedProgress, percent);
        setProgress(displayedProgress, title, note);
      };
      let lastPartial = '';

      worker.onmessage = (event) => {
        if (!isCurrent() || state.transcriptionWorker !== worker) return;
        const msg = event.data || {}; if (msg.jobId && msg.jobId !== jobId) return;
        if (msg.type === 'model-progress') {
          reportProgress(8 + (msg.progress * 0.18), 'ЗАГРУЖАЮ AI-МОДЕЛЬ', msg.file ? `Модель: ${msg.file}` : 'Первый запуск может занять время.');
        } else if (msg.type === 'status') {
          reportProgress(20, 'ГОТОВЛЮ WHISPER', msg.message || 'Запуск модели…');
        } else if (msg.type === 'engine') {
          reportProgress(27, 'WHISPER ГОТОВ', `Движок: ${String(msg.device || '').toUpperCase()} · модель ${msg.modelId?.split('/').pop() || ''}`);
        } else if (msg.type === 'chunk-progress') {
          const ratio = msg.total ? msg.index / msg.total : 0;
          const p = 28 + ratio * 69;
          const elapsed = (performance.now() - state.transcriptionStartedAt) / 1000;
          const eta = ratio > 0.03 ? Math.max(0, (elapsed / ratio) - elapsed) : null;
          reportProgress(p, `РАСПОЗНАЮ · ${msg.index}/${msg.total}`, `${msg.skipped ? `Пропущено тишины: ${msg.skipped}. ` : ''}${msg.retried ? `Перепроверено: ${msg.retried}. ` : ''}${Number.isFinite(eta) ? `Осталось ~${formatTime(eta)}.` : 'Считаю скорость…'}`);
          if (msg.partialText) {
            lastPartial = `${lastPartial} ${msg.partialText}`.replace(/\s+/g, ' ').trim();
            renderLiveText(lastPartial);
          }
        } else if (msg.type === 'quality-check') {
          const current = Number.isFinite(msg.index) ? `${msg.index}/${msg.total || '?'}` : '';
          els.statusNote.textContent = `${msg.message || 'Перепроверяю фрагмент…'} ${current}`.trim();
        } else if (msg.type === 'backend-fallback') {
          const fallbackNote = msg.message ? `Причина: ${msg.message}` : 'Пробую более лёгкую модель.';
          els.statusNote.textContent = fallbackNote;
          showToast('AI не запустился на текущем движке. Переключаюсь автоматически.', 'error', 4200);
        } else if (msg.type === 'result') {
          renderResult(msg.output); setProgress(100, 'ГОТОВО', 'Текст можно редактировать, копировать и выгружать в Excel.');
          finishTranscriptionWorker(); showToast('Распознавание завершено');
        } else if (msg.type === 'error') {
          throwWorkerError(msg.message || 'Ошибка распознавания.');
        } else if (msg.type === 'cancelled') {
          setProgress(0, 'ОСТАНОВЛЕНО', 'Распознавание остановлено пользователем.'); finishTranscriptionWorker();
        }
      };
      worker.onerror = (event) => {
        if (!isCurrent() || state.transcriptionWorker !== worker) return;
        throwWorkerError(event.message || 'Ошибка Web Worker.');
      };
      const transferable = audio.buffer;
      worker.postMessage({
        type: 'transcribe', jobId, audioBuffer: transferable, modelId: profile.model,
        preferredDevice: hasWebGPU ? 'webgpu' : 'wasm', language: els.languageSelect.value,
        chunkSeconds: profile.chunk, overlapSeconds: profile.overlap, useVad: profile.vad,
        vadThreshold: profile.quality === 'noisy' ? 0.0055 : 0.0035,
        detailedTimestamps: profile.detailedTimestamps, cleanup: profile.cleanup, quality: profile.quality,
      }, [transferable]);
    } catch (error) {
      if (!isCurrent()) return;
      console.error(error); setProgress(0, 'ОШИБКА', error?.message || 'Не удалось распознать запись.'); showToast(error?.message || 'Ошибка распознавания', 'error', 4500); finishTranscriptionWorker();
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
