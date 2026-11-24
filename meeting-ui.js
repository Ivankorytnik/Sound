(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const transcript = byId('transcript');
  const actions = document.querySelector('.result-actions');
  const analyzer = window.SpeechLabMeetingAnalyzer;
  if (!transcript || !actions || !analyzer) return;

  const style = document.createElement('style');
  style.textContent = `
    .meeting-btn{background:var(--cyan,#31d5ff)!important;color:#05202a!important;font-weight:700!important;flex:1 1 100%!important}
    .meeting-report{margin-top:12px;border:1px solid var(--line-strong, #35525f);background:var(--surface,#0c1b26);border-radius:12px;padding:14px;min-width:0}
    .meeting-report[hidden]{display:none!important}
    .meeting-report h3{font-size:15px;margin:0 0 6px}
    .meeting-report p{margin:4px 0 12px;color:var(--muted,#9eb4c2);font-size:12px}
    .meeting-report label{display:block;font-size:12px;font-weight:700;margin:12px 0 6px}
    .meeting-report textarea{width:100%;min-height:140px;resize:vertical;border:1px solid var(--line-strong,#35525f);background:var(--bg,#07121a);padding:10px;border-radius:9px;line-height:1.5}
    .meeting-report .meeting-task-list{display:flex;flex-direction:column;gap:10px}
    .meeting-report .meeting-task{padding:10px;border:1px solid var(--line,#35525f);border-radius:9px}
    .meeting-report .meeting-task input{min-width:0;width:100%;background:var(--bg,#07121a);border:1px solid var(--line-strong,#35525f);border-radius:7px;padding:8px}
    .meeting-report .meeting-task-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .meeting-report .meeting-task label{margin:6px 0 4px}
    .meeting-report .meeting-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    .meeting-report .meeting-warning{color:#f8ce87}
    @media(max-width:480px){.meeting-report .meeting-task-grid{grid-template-columns:1fr}}
  `;
  document.head.append(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'meetingSummaryBtn';
  button.className = 'secondary-btn meeting-btn';
  button.textContent = 'РЕЗЮМЕ ВСТРЕЧИ И ЗАДАЧИ';
  button.disabled = true;
  actions.append(button);

  const panel = document.createElement('section');
  panel.id = 'meetingReport';
  panel.className = 'meeting-report';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Резюме встречи и задачи');
  const heading = document.createElement('h3');
  heading.textContent = 'РЕЗЮМЕ ВСТРЕЧИ И ЗАДАЧИ';
  const note = document.createElement('p');
  note.textContent = 'Бесплатный локальный анализ: выделяет фрагменты и явные поручения. Это не генеративное ИИ-резюме. Проверьте формулировки перед отправкой.';
  const summaryLabel = document.createElement('label');
  summaryLabel.textContent = 'КРАТКОЕ СОДЕРЖАНИЕ И РЕШЕНИЯ';
  summaryLabel.htmlFor = 'meetingSummaryText';
  const summaryText = document.createElement('textarea');
  summaryText.id = 'meetingSummaryText';
  summaryText.setAttribute('aria-label', 'Содержание встречи и решения');
  const tasksTitle = document.createElement('h3');
  tasksTitle.textContent = 'ПОРУЧЕНИЯ';
  tasksTitle.style.marginTop = '14px';
  const taskList = document.createElement('div');
  taskList.className = 'meeting-task-list';
  taskList.id = 'meetingTaskList';
  const warning = document.createElement('p');
  warning.className = 'meeting-warning';
  warning.id = 'meetingSummaryWarning';
  warning.setAttribute('role', 'status');
  const controls = document.createElement('div');
  controls.className = 'meeting-actions';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.className = 'secondary-btn'; copy.textContent = 'Копировать';
  const save = document.createElement('button');
  save.type = 'button'; save.className = 'secondary-btn'; save.textContent = 'Скачать .txt';
  const add = document.createElement('button');
  add.type = 'button'; add.className = 'secondary-btn'; add.textContent = '+ Добавить задачу';
  controls.append(copy, save, add);
  panel.append(heading, note, summaryLabel, summaryText, tasksTitle, taskList, warning, controls);
  actions.insertAdjacentElement('afterend', panel);

  let originalTranscript = '';
  const createField = (labelText, value, placeholder) => {
    const label = document.createElement('label');
    label.textContent = labelText;
    const field = document.createElement('input');
    field.type = 'text'; field.value = value || ''; field.placeholder = placeholder;
    label.append(field);
    return { label, field };
  };
  function addTask(task = {}) {
    const row = document.createElement('div'); row.className = 'meeting-task';
    const title = createField('ПОРУЧЕНИЕ', task.task, 'Что нужно сделать');
    const owner = createField('ОТВЕТСТВЕННЫЙ', task.owner, 'Не указан');
    const due = createField('СРОК', task.due, 'Не указан');
    const grid = document.createElement('div'); grid.className = 'meeting-task-grid';
    grid.append(owner.label, due.label);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'secondary-btn';
    remove.textContent = 'Удалить задачу';
    remove.addEventListener('click', () => row.remove());
    row.append(title.label, grid, remove);
    taskList.append(row);
  }
  function compiledText() {
    const lines = ['РЕЗЮМЕ ВСТРЕЧИ', '', summaryText.value.trim(), '', 'ЗАДАЧИ И ПОРУЧЕНИЯ'];
    const rows = [...taskList.querySelectorAll('.meeting-task')];
    if (!rows.length) lines.push('Явных поручений не найдено или они удалены.');
    rows.forEach((row, i) => {
      const [task, owner, due] = [...row.querySelectorAll('input')].map(input => input.value.trim());
      if (!task) return;
      lines.push(`${i + 1}. ${task}`);
      lines.push(`   Ответственный: ${owner || 'не указан'}`);
      lines.push(`   Срок: ${due || 'не указан'}`);
    });
    lines.push('', 'Составлено локально по стенограмме Speech Lab. Требует проверки.');
    return lines.join('\n');
  }
  function downloadFallback(blob, filename) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = filename; a.hidden = true;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
  function alertStatus(message) {
    warning.textContent = message;
  }
  function refreshAvailability() {
    button.disabled = transcript.value.trim().length < 25;
    if (!panel.hidden && transcript.value.trim() !== originalTranscript) {
      alertStatus('Текст стенограммы изменён. Нажмите кнопку ещё раз для обновления резюме: текущие правки резюме будут заменены.');
    }
  }
  button.addEventListener('click', () => {
    const source = transcript.value.trim();
    const data = analyzer.analyzeTranscript(source);
    if (data.error) { alertStatus(data.error); return; }
    originalTranscript = source;
    summaryText.value = data.summary;
    taskList.replaceChildren();
    data.tasks.forEach(task => addTask(task));
    panel.hidden = false;
    alertStatus((data.truncated ? 'Анализ ограничен первыми 400 000 символами. ' : '') +
      (data.tasks.length ? 'Проверьте задачи, ответственных и сроки. Неявные поручения могут быть пропущены.' : 'Явных поручений не найдено. Добавьте их вручную при необходимости.'));
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(compiledText());
      alertStatus('Резюме скопировано.');
    } catch {
      alertStatus('Не удалось скопировать. Используйте «Скачать .txt».');
    }
  });
  save.addEventListener('click', async () => {
    const blob = new Blob([compiledText()], { type: 'text/plain;charset=utf-8' });
    try {
      if (typeof window.SpeechLabFiles?.save === 'function') {
        await window.SpeechLabFiles.save(blob, 'meeting_summary.txt');
      } else downloadFallback(blob, 'meeting_summary.txt');
      alertStatus('Файл подготовлен к сохранению. Проверьте папку загрузок или папку встречи.');
    } catch {
      downloadFallback(blob, 'meeting_summary.txt');
      alertStatus('Сохранение в папку встречи не удалось, открыта загрузка файла.');
    }
  });
  add.addEventListener('click', () => addTask());
  transcript.addEventListener('input', refreshAvailability);
  const observer = new MutationObserver(() => {
    refreshAvailability();
    if (byId('resultBlock')?.classList.contains('hidden')) {
      panel.hidden = true; originalTranscript = '';
    }
  });
  observer.observe(byId('resultBlock'), { attributes: true, attributeFilter: ['class'] });
  observer.observe(transcript, { attributes: true, attributeFilter: ['value'] });
  const recognition = byId('progressWrap');
  if (recognition) observer.observe(recognition, { childList: true, subtree: true });
  setInterval(refreshAvailability, 1600);
  refreshAvailability();
})();
