/* Speech Lab live translation: deterministic, offline audio/text helpers. */
(function (root) {
  'use strict';

  function resampleMono(input, sourceRate, targetRate = 16000) {
    if (!(input instanceof Float32Array) || !input.length) return new Float32Array();
    if (!(sourceRate > 0 && targetRate > 0)) throw new RangeError('Invalid sample rate');
    if (sourceRate === targetRate) return input.slice();
    const ratio = sourceRate / targetRate;
    const count = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const start = i * ratio;
      const end = Math.min((i + 1) * ratio, input.length);
      let sum = 0;
      let weight = 0;
      for (let p = Math.floor(start); p < Math.ceil(end); p += 1) {
        const w = Math.max(0, Math.min(end, p + 1) - Math.max(start, p));
        sum += input[p] * w;
        weight += w;
      }
      output[i] = weight ? sum / weight : 0;
    }
    return output;
  }

  function clock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
      .map((value) => String(value).padStart(2, '0')).join(':');
  }

  function srtTime(seconds) {
    const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const totalSeconds = Math.floor(ms / 1000);
    return clock(totalSeconds) + ',' + String(ms % 1000).padStart(3, '0');
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim();
  }

  function toSrt(segments) {
    return segments.filter((item) => cleanText(item.ru)).map((item, index) => {
      const start = Math.max(0, Number(item.start) || 0);
      const end = Math.max(start + 0.5, Number(item.end) || start + 0.5);
      return [index + 1, srtTime(start) + ' --> ' + srtTime(end), cleanText(item.ru)].join('\n');
    }).join('\n\n') + (segments.some((item) => cleanText(item.ru)) ? '\n' : '');
  }

  const api = { resampleMono, clock, srtTime, cleanText, toSrt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpeechLiveCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
