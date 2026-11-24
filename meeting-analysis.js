/* Speech Lab: offline extractive analyzer. No network requests. */
(function (root) {
  'use strict';
  const analyzeTranscript = function analyzeTranscript(input) {
  const text = String(input || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (text.length < 25) return { summary: "", tasks: [], error: "Для резюме нужна стенограмма хотя бы из нескольких предложений.", truncated: false };
  const maxLength = 400000;
  const truncated = text.length > maxLength;
  const source = text.slice(0, maxLength);
  const raw = source.split(/(?<=[.!?])\s+|\n+/u);
  const sentences = [];
  for (const item of raw) {
    let remaining = item.trim();
    while (remaining.length > 360) {
      let pos = remaining.lastIndexOf(" ", 360);
      if (pos < 90) pos = 360;
      const piece = remaining.slice(0, pos).trim();
      if (piece) sentences.push(piece);
      remaining = remaining.slice(pos).trim();
    }
    if (remaining) sentences.push(remaining);
  }
  const unique = [];
  const seen = new Set();
  for (const sentence of sentences) {
    const key = sentence.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (key.length < 20 || seen.has(key)) continue;
    seen.add(key);
    unique.push(sentence);
  }
  const decisionsRe = /(?:решили|согласовали|утвердили|договорились|принято решение|пришли к выводу|выбрали вариант|зафиксировали решение)/iu;
  const taskRe = /(?:нужно|надо|необходимо|следует|поручили|поручить|задача|должен|должна|обязан|обязана|сделает|подготовит|проверит|отправит|проведет|проведёт|запустит|сделаем|проверим|подготовим|отправим|согласуем|доработать|разработать|проверить|направить|подготовить|отправить|сделать|создать|уточнить|обновить|организовать|назначить|запустить|беру на себя|возьму на себя|к следующей встрече)/iu;
  const notTaskRe = /(?:не (?:нужно|надо|требуется|будем|следует|стоит)|нужно ли|надо ли|можно ли|может быть|если (?:бы|будем)|(?:не )?хотелось бы|что если)/iu;
  const ownerRe = /(?:ответственн(?:ый|ая|ые|ым|ой)?\s*[:\-–—]\s*|поручили\s+|поручить\s+)([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/u;
  const ownerActionRe = /(?:^|[.!?;]\s*|,\s*)([А-ЯЁ][а-яё]+)\s+(?:должен|должна|сделает|подготовит|проверит|отправит|проведет|проведёт|запустит)(?![\p{L}\p{N}_])/u;
  const dueRe = /(?:до|к)\s+(?:\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)|(?:конца|середины|начала)\s+(?:недели|месяца|квартала|года)|(?:понедельнику|вторнику|среде|четвергу|пятнице|субботе|воскресенью)|(?:завтра|вечеру|утру|следующей встрече))|(?:срок\s*[:\-–—]\s*)(?:\d{1,2}[.\/-]\d{1,2}(?:[.\/-]\d{2,4})?|\d{1,2}\s+\p{L}+)|(?:в\s+течение\s+\d+\s+(?:дней|недель|месяцев))/iu;
  const tasks = [];
  const decisions = [];
  const ranked = [];
  const taskSeen = new Set();
  for (const [idx, sentence] of unique.entries()) {
    const decision = decisionsRe.test(sentence) && !/(?:не\s+(?:решили|согласовали|утвердили|договорились)|решили ли|согласовали ли)/iu.test(sentence) && !sentence.endsWith('?');
    if (decision && decisions.length < 5) decisions.push(sentence);
    const task = taskRe.test(sentence) && !notTaskRe.test(sentence) && !sentence.trim().endsWith("?");
    if (task) {
      const key = sentence.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (!taskSeen.has(key) && tasks.length < 30) {
        taskSeen.add(key);
        const owner = sentence.match(ownerRe)?.[1] || sentence.match(ownerActionRe)?.[1] || "";
        const due = sentence.match(dueRe)?.[0] || "";
        tasks.push({ task: sentence.slice(0, 360), owner, due, evidence: sentence.slice(0, 360) });
      }
    }
    let score = 0;
    if (decision) score += 7;
    if (task) score += 3;
    if (/(?:обсуждали|предложили|проект|цель|бюджет|результат|срок|план|важно|проблем|риск|следующий этап)/iu.test(sentence)) score += 3;
    if (idx < 5) score += 2;
    if (idx >= unique.length - 5) score += 1;
    if (sentence.length >= 35 && sentence.length <= 280) score += 2;
    if (sentence.length < 25) score -= 4;
    ranked.push({sentence, score, idx});
  }
  const highlights = ranked.sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, 6).sort((a, b) => a.idx - b.idx).map(x => x.sentence);
  const summary = [
    "Ключевые моменты (цитаты и фрагменты стенограммы):",
    ...highlights.map(x => "• " + x),
    "",
    "Зафиксированные решения:",
    ...(decisions.length ? decisions.map(x => "• " + x) : ["Явно сформулированных решений не найдено."])
  ].join("\n");
  return { summary, tasks, error: "", truncated };
};
  const api = Object.freeze({ analyzeTranscript });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SpeechLabMeetingAnalyzer = api;
})(typeof window !== 'undefined' ? window : null);
