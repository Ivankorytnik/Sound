  async function decodeToMono16k(file, jobId = null) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Браузер не поддерживает AudioContext.');
    const ctx = new AudioContextClass();
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buffer.slice(0));
      if (jobId !== null && state.transcriptionJobId !== jobId) return null;
      validateSelectedFile(file, decoded.duration);
      state.currentDuration = decoded.duration;
      const targetRate = 16000;
      const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineAudioContext(1, length, targetRate);
      const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
      const rendered = await offline.startRendering();
      if (jobId !== null && state.transcriptionJobId !== jobId) return null;
      return new Float32Array(rendered.getChannelData(0));
    } catch (error) {
      throw new Error(`Не удалось декодировать аудио: ${error?.message || 'попробуй MP3/WAV/M4A/WEBM.'}`);
    } finally { await ctx.close().catch(() => {}); }
  }
