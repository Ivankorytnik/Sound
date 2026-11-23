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

  // ---- "Speech only" mode -------------------------------------------------------------
  // Every rule below looks at the WHOLE recognised utterance. A participant's sentence that
  // merely mentions a sound ("I can hear the water running") is never matched.
  const SOUND_WORDS = new Set(('music song singing humming whistling water rain wind thunder '
    + 'storm birds bird chirping tweeting dog dogs barking cat meowing footsteps steps walking '
    + 'applause clapping claps laughter laughing laughs cheering crowd coughing cough coughs '
    + 'sneezing breathing sighs sigh sighing typing keyboard clicking click knocking knock door '
    + 'bell bells phone ringing ring beeping beep static noise silence engine traffic car siren '
    + 'splashing running dripping pouring buzzing hum chime chimes gunshot explosion whoosh '
    + 'rustling paper chewing snoring crying baby').split(' '));
  const SOUND_FILLERS = new Set(('the a an of sound sounds soft loud gentle quiet distant faint '
    + 'upbeat dramatic intense light heavy background in and with playing plays continues '
    + 'continuing starts stops closes opens slams instrumental').split(' '));
  // Phrases Whisper is known to invent on silence, noise or music (YouTube/subtitle artefacts).
  const HALLUCINATIONS = new Set([
    'you', 'thank you', 'thank you very much', 'thank you so much', 'thanks', 'thanks for watching',
    'thank you for watching', 'thank you so much for watching', 'thanks for watching and see you next time',
    'please subscribe', 'like and subscribe', 'subscribe to my channel', 'bye', 'bye bye', 'bye-bye',
    'see you next time', "i'll see you next time", 'see you in the next video', 'so', 'oh', 'hmm',
    'uh', 'um', 'okay', 'ok', 'yeah', 'the end',
  ]);
  // Subtitle credits are never spoken in a meeting: dropped regardless of audio evidence.
  const CREDITS = /\b(subtitles? (by|made by|created by)|amara\.org|transcribed by|translated by|captions? by)/iu;

  function normalisePhrase(value) {
    return stripAnnotations(value).toLowerCase().replace(/[.,!?…"«»:;]+/gu, ' ')
      .replace(/\s+/gu, ' ').trim();
  }
  function isSoundDescription(value) {
    const words = normalisePhrase(value).split(' ').filter(Boolean);
    if (!words.length || words.length > 5) return false;
    let sound = 0;
    for (const word of words) {
      if (SOUND_WORDS.has(word)) sound += 1;
      else if (!SOUND_FILLERS.has(word)) return false;
    }
    return sound > 0;
  }
  function isHallucinationPhrase(value) {
    return HALLUCINATIONS.has(normalisePhrase(value));
  }
  function isRepetitionLoop(value) {
    const words = normalisePhrase(value).split(' ').filter(Boolean);
    if (words.length < 4) return false;
    const counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    return Math.max(...counts.values()) / words.length >= 0.6;
  }

  // `vad` = { speech, confident, mean, max }: seconds with p >= 0.35, seconds with p >= 0.9,
  // mean p over speech windows, peak p. Thresholds measured with real Silero on fixtures:
  // every speech sample (incl. -30 dB, over music/noise, one-word "Yes.") had mean >= 0.90
  // and confident >= 0.32 s; wordless humming 0.64 / 0.10 s; music 0.47 / 0 s.
  const VAD_WEAK_MEAN = 0.8;
  const VAD_WEAK_CONFIDENT_SECONDS = 0.25;
  function isWeakVoice(vad) {
    return Boolean(vad) && (Number(vad.mean) < VAD_WEAK_MEAN
      || Number(vad.confident) < VAD_WEAK_CONFIDENT_SECONDS);
  }

  // Speech-only decision AFTER Whisper. Ambiguous phrases are removed only when the voice
  // detector also saw a weak voice, so a clearly spoken "Thank you." is kept.
  function classifyTranscript(text, vad, speechOnly = true) {
    if (isNonSpeech(text)) return { keep: false, reason: 'annotation' };
    const clean = stripAnnotations(text);
    if (!speechOnly) return { keep: true, text: clean };
    if (CREDITS.test(clean)) return { keep: false, reason: 'credits' };
    const weak = isWeakVoice(vad);
    if (weak && isSoundDescription(clean)) return { keep: false, reason: 'sound' };
    if (weak && isHallucinationPhrase(clean)) return { keep: false, reason: 'hallucination' };
    if (weak && isRepetitionLoop(clean)) return { keep: false, reason: 'repetition' };
    return { keep: true, text: clean };
  }

  // Speech-only decision BEFORE Whisper: skip fragments where the detector found (almost)
  // no voice. Limits sit ~3x below the weakest real speech measured (one-word "Yes.":
  // 0.45 s / 0.32 s confident), so short replies pass. Without a detector nothing is skipped.
  const VAD_MIN_SPEECH_SECONDS = 0.2;
  const VAD_MIN_CONFIDENT_SECONDS = 0.1;
  function hasEnoughSpeech(vad) {
    return !vad || (Number(vad.speech) >= VAD_MIN_SPEECH_SECONDS
      && Number(vad.confident) >= VAD_MIN_CONFIDENT_SECONDS);
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
    isSoundDescription, isHallucinationPhrase, isRepetitionLoop, classifyTranscript, hasEnoughSpeech,
    isWeakVoice,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpeechLiveCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
