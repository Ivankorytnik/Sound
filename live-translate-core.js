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

  // Maintain fractional sample phase across AudioContext blocks. Reset per capture.
  function createStreamingResampler(sourceRate, targetRate = 16000) {
    if (!Number.isFinite(sourceRate) || !Number.isFinite(targetRate) ||
        sourceRate <= 0 || targetRate <= 0) throw new RangeError('Invalid sample rate');
    const span = sourceRate / targetRate;
    let inputPosition = 0;
    let boundary = span;
    let weighted = 0;
    let covered = 0;
    return {
      push(input) {
        if (!(input instanceof Float32Array)) throw new TypeError('Expected Float32Array');
        const output = [];
        for (let i = 0; i < input.length; i += 1) {
          const end = inputPosition + 1;
          let pos = inputPosition;
          while (pos < end - 1e-10) {
            const part = Math.max(0, Math.min(end, boundary) - pos);
            if (part <= 1e-10) {
              // Float rounding at a boundary.
              output.push(weighted / Math.max(covered, 1e-10));
              weighted = 0;
              covered = 0;
              boundary += span;
              continue;
            }
            weighted += input[i] * part;
            covered += part;
            pos += part;
            if (pos >= boundary - 1e-10) {
              output.push(weighted / Math.max(covered, 1e-10));
              weighted = 0;
              covered = 0;
              boundary += span;
            }
          }
          inputPosition = end;
        }
        return Float32Array.from(output);
      },
    };
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

  // Whisper emits sound-event annotations ("[Music]", "(applause)", "[BLANK_AUDIO]", "♪")
  // for non-speech audio. They must never be sent to the translator as speech.
  const ANNOTATION = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+/gu;
  function stripAnnotations(value) {
    return cleanText(String(value || '').replace(ANNOTATION, ' '));
  }
  function isNonSpeech(value) {
    const rest = stripAnnotations(value).replace(/[\s.,!?…\-–—"'«»]+/gu, '');
    return !rest || /^(music|silence|applause|noise|blankaudio)$/iu.test(rest);
  }

  // OPUS-MT (Marian) frequently stops after the first sentence of a multi-sentence input,
  // silently dropping the rest of a 6-second fragment. Translate sentence by sentence.
  const ABBREVIATION = /(?:^|\s)(?:mr|mrs|ms|dr|prof|st|vs|etc|e\.g|i\.e|no|inc|ltd|jr|sr)\.$/iu;
  function splitSentences(value) {
    const text = cleanText(value);
    if (!text) return [];
    const parts = [];
    let current = '';
    for (const piece of text.split(/(?<=[.!?…])\s+/u)) {
      current = current ? current + ' ' + piece : piece;
      if (!ABBREVIATION.test(current)) {
        parts.push(current);
        current = '';
      }
    }
    if (current) parts.push(current);
    return parts;
  }

  function toSrt(segments) {
    return segments.filter((item) => cleanText(item.ru)).map((item, index) => {
      const start = Math.max(0, Number(item.start) || 0);
      const end = Math.max(start + 0.5, Number(item.end) || start + 0.5);
      return [index + 1, srtTime(start) + ' --> ' + srtTime(end), cleanText(item.ru)].join('\n');
    }).join('\n\n') + (segments.some((item) => cleanText(item.ru)) ? '\n' : '');
  }

  const api = {
    resampleMono, createStreamingResampler, clock, srtTime, cleanText, toSrt,
    stripAnnotations, isNonSpeech, splitSentences,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpeechLiveCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
