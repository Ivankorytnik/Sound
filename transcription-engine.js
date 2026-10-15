// One model/backend per Worker. Termination releases the entire failed runtime.
let transcriber = null;
let busy = false;

async function load(candidate, id) {
  // Dynamic import: import/CDN failures are delivered as a structured response too.
  const { pipeline, env } = await import(
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm'
  );
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
  // Avoid combining an fp16 encoder with the fp32 activations of a q4 decoder.
  // No shader-f16 support is needed. WASM uses a smaller, quantized model.
  const dtype = candidate.device === 'webgpu'
    ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
    : { encoder_model: 'q8', decoder_model_merged: 'q8' };
  transcriber = await pipeline('automatic-speech-recognition', candidate.modelId, {
    device: candidate.device,
    dtype,
    progress_callback(data) {
      if (data?.status === 'progress' && Number.isFinite(data.progress)) {
        self.postMessage({
          type: 'model-progress', id,
          progress: Math.max(0, Math.min(100, data.progress)),
          file: String(data.file || ''),
        });
      }
    },
  });
}

self.addEventListener('message', async ({ data = {} }) => {
  const { id, type } = data;
  if (type !== 'load' && type !== 'infer') return;
  if (busy) {
    self.postMessage({ type: 'failure', id, message: 'AI Worker уже занят.', phase: type === 'load' ? 'load' : 'inference' });
    return;
  }
  busy = true;
  try {
    let output = null;
    if (type === 'load') {
      await load(data.candidate, id);
    } else {
      if (!transcriber) throw new Error('Модель ещё не загружена.');
      const audio = new Float32Array(data.audioBuffer);
      if (!audio.length) throw new Error('Пустой аудиофрагмент.');
      output = await transcriber(audio, data.options);
    }
    self.postMessage({ type: 'response', id, output });
  } catch (error) {
    self.postMessage({
      type: 'failure', id,
      phase: type === 'load' ? 'load' : 'inference',
      name: error?.name || 'Error',
      message: String(error?.message ?? error ?? 'Неизвестная ошибка ONNX.'),
    });
  } finally {
    busy = false;
  }
});
