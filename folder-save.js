(() => {
  'use strict';

  let selectedDirectory = null;
  let folderStatusEl = null;
  let folderButtonEl = null;

  function showFolderToast(message, type = 'ok') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('error', type === 'error');
    toast.classList.add('show');
    clearTimeout(showFolderToast.timer);
    showFolderToast.timer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function setFolderStatus(text, kind = 'idle') {
    if (!folderStatusEl) return;
    folderStatusEl.textContent = text;
    folderStatusEl.dataset.kind = kind;
  }

  function sanitizeFileName(name) {
    return String(name || 'file').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'file';
  }

  async function ensureWritePermission(handle) {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function') return true;
    const options = { mode: 'readwrite' };
    let permission = await handle.queryPermission(options);
    if (permission === 'granted') return true;
    if (typeof handle.requestPermission === 'function') permission = await handle.requestPermission(options);
    return permission === 'granted';
  }

  async function pickAvailableFileName(directory, requestedName) {
    const safeName = sanitizeFileName(requestedName);
    const dot = safeName.lastIndexOf('.');
    const base = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : '';
    for (let i = 0; i < 1000; i += 1) {
      const candidate = i ? `${base} (${i})${ext}` : safeName;
      try { await directory.getFileHandle(candidate); }
      catch (error) {
        if (error?.name === 'NotFoundError') return candidate;
        throw error;
      }
    }
    return `${base}_${Date.now()}${ext}`;
  }

  function fallbackDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFileName(fileName);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Topic extraction stays in this tab. No model download or network request.
  const STOP_WORDS = new Set(`а без более бы был была были было быть в вам вами вас ваш ваша ваши ваше ведь весь во вот все всего всем всеми всех всю вся вы где да даже для до его ее её ей ему если есть еще ещё же за зачем здесь и из или им ими их к как какая какие какой когда конечно кто ли либо мы на надо нам нами нас наш наша наши наше не него нее неё ней нет ни них но ну нужно о об один она они оно он от очень по под пожалуйста пока после потому при про просто пусть раз разве с сам сама сами самое себе себя сейчас со спасибо так такая такие такой там тоже то того только том тому тот тут ты у уже хорошо хотя чего чем через что чтобы это этого этой этом этот эту я здравствуйте привет коллеги добрый день утро вечер давайте обсудим обсудить обсуждаем поговорим говорить говорили скажем сказать сказал сказала сказал значит получается значит вообще например наверное действительно собственно соответственно необходимо можно нельзя будет будем будете будут буду делать сделать делаем сделали должен должна должны должен данный данная данные данный вопрос вопросы встреча встречи запись записи сегодня завтра вчера дальше потом первый вначале сначала конечно понятно понимаю понял знаете знаем знаю думаю думать считаю имеется есть имеем many much more most also about after again before being between could does doing during each from have having here into just let's meeting might must need now only other our ours over please said same should some such than that their them then there these they this those through today tomorrow under until upon very want were what when where which while whom will with would your yours hello thanks thank good morning afternoon evening discuss discussed talking going think know like well yes yeah really because let's can cannot using use used working work thing things`.split(/\s+/u));
  function keywordFromText(text) {
    const names = new Set(['mySpeakerName', 'speakerName1', 'speakerName2', 'speakerName3']
      .flatMap(id => String(document.getElementById(id)?.value || '').toLocaleLowerCase('ru').match(/[\p{L}]+/gu) || []));
    const tokens = String(text || '').normalize('NFKC').match(/[\p{L}][\p{L}\p{M}-]*/gu) || [];
    const scores = new Map();
    for (const [index, raw] of tokens.entries()) {
      const word = raw.toLocaleLowerCase('ru').replace(/^-+|-+$/g, '');
      const abbreviation = word.length >= 2 && /^[А-ЯЁA-Z]+$/u.test(raw);
      if ((!abbreviation && word.length < 4) || word.length > 36 || STOP_WORDS.has(word) || names.has(word)) continue;
      const item = scores.get(word) || { word, count: 0, index, raw };
      item.count++; scores.set(word, item);
    }
    const winner = [...scores.values()].sort((a, b) => b.count - a.count || a.index - b.index)[0];
    if (!winner) return null;
    return /^[А-ЯЁA-Z\d-]+$/u.test(winner.raw) ? winner.raw : winner.word[0].toLocaleUpperCase('ru') + winner.word.slice(1);
  }
  function localDateStamp(date) {
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }
  let sourceContext = { file: null, date: new Date(), title: null, folders: new Map() };
  let saveQueue = Promise.resolve();
  function setSource(file, recorded = false) {
    const date = recorded && Number.isFinite(file?.lastModified) ? new Date(file.lastModified) : new Date();
    sourceContext = { file, date, title: null, folders: new Map() };
  }
  function meetingTitle(context, text) {
    // Freeze the meaningful title on first save so all later exports stay together.
    if (!context.title) {
      const keyword = keywordFromText(text);
      if (keyword) context.title = `${keyword}_${localDateStamp(context.date)}`;
    }
    return context.title || `Запись_${localDateStamp(context.date)}`;
  }
  function transcriptText() { return document.getElementById('transcript')?.value?.trim() || ''; }
  function extensionOf(name) { return /\.[a-z0-9]{1,8}$/i.exec(String(name || ''))?.[0] || ''; }
  function enqueueSave(task) {
    const result = saveQueue.then(task);
    saveQueue = result.catch(() => {});
    return result;
  }
  async function meetingDirectory(root, context, title) {
    let folders = context.folders.get(root);
    if (!folders) { folders = new Map(); context.folders.set(root, folders); }
    if (folders.has(title)) return folders.get(title);
    for (let i = 0; i < 1000; i++) {
      const name = i ? `${title}_${i + 1}` : title;
      try { await root.getDirectoryHandle(name); }
      catch (error) {
        if (error?.name === 'TypeMismatchError') continue;
        if (error?.name !== 'NotFoundError') throw error;
        const directory = await root.getDirectoryHandle(name, { create: true });
        const entry = { directory, name, audioSaved: false, savedText: null };
        folders.set(title, entry); return entry;
      }
    }
    throw new Error('Не удалось подобрать свободное имя папки');
  }
  async function writeFile(directory, blob, requestedName) {
    const fileName = await pickAvailableFileName(directory, requestedName);
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { try { await writable.abort(); } catch {} throw error; }
    return fileName;
  }
  function saveMeeting() {
    const root = selectedDirectory, context = sourceContext, text = transcriptText();
    if (!root || !context.file || !text) return Promise.resolve(false);
    const title = meetingTitle(context, text);
    return enqueueSave(async () => {
      try {
        if (!await ensureWritePermission(root)) throw new Error('Нет разрешения на запись');
        const entry = await meetingDirectory(root, context, title);
        if (!entry.audioSaved) {
          await writeFile(entry.directory, context.file, title + (extensionOf(context.file.name) || '.webm'));
          entry.audioSaved = true;
        }
        if (entry.savedText !== text) {
          await writeFile(entry.directory, new Blob([text], { type: 'text/plain;charset=utf-8' }), `${title}.txt`);
          entry.savedText = text;
        }
        setFolderStatus(`Сохранены аудио и текст: ${entry.name}`, 'ok');
        showFolderToast(`Аудио и расшифровка сохранены: ${entry.name}`);
        return true;
      } catch (error) {
        setFolderStatus(`Не удалось сохранить встречу: ${error?.message || 'ошибка'}`, 'error');
        showFolderToast('Не удалось сохранить встречу. Проверь доступ к папке и повтори скачивание.', 'error');
        return false;
      }
    });
  }

  function saveBlobToFolder(blob, requestedName) {
    const root = selectedDirectory, context = sourceContext;
    const title = meetingTitle(context, transcriptText());
    const requested = title + extensionOf(requestedName);
    return enqueueSave(async () => {
      if (!root) return fallbackDownload(blob, requested);
      try {
        if (!await ensureWritePermission(root)) throw new Error('Нет разрешения на запись');
        const entry = await meetingDirectory(root, context, title);
        const fileName = await writeFile(entry.directory, blob, requested);
        setFolderStatus(`Сохранено: ${entry.name}/${fileName}`, 'ok');
        showFolderToast(`Сохранено в папку «${entry.name}»`);
      } catch (error) {
        setFolderStatus(`Ошибка сохранения: ${error?.message || 'ошибка'}`, 'error');
        showFolderToast('Сохранение в папку не удалось. Открываю обычную загрузку.', 'error');
        return fallbackDownload(blob, requested);
      }
    });
  }

  window.SpeechLabFiles = Object.freeze({ save: saveBlobToFolder, setSource, saveMeeting });

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .folder-save-row {
        margin: 14px 0 18px;
        padding: 13px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius-sm);
        background: rgba(49, 213, 255, .045);
      }
      .folder-save-copy { min-width: 0; display: grid; gap: 4px; }
      .folder-save-copy strong {
        font-size: 11px;
        letter-spacing: .08em;
        color: var(--cyan-2);
      }
      .folder-save-copy span {
        color: var(--muted);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .folder-save-copy span[data-kind="ok"] { color: var(--green); }
      .folder-save-copy span[data-kind="error"] { color: var(--danger); }
      .folder-save-row .secondary-btn { flex: 0 0 auto; }
      @media (max-width: 680px) {
        .folder-save-row { align-items: stretch; flex-direction: column; }
        .folder-save-row .secondary-btn { width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  function installFolderPicker() {
    if (document.getElementById('chooseSaveFolderBtn')) return;

    injectStyles();
    const row = document.createElement('div');
    row.className = 'folder-save-row';
    row.innerHTML = `
      <div class="folder-save-copy">
        <strong>ПАПКА СОХРАНЕНИЯ</strong>
        <span id="saveFolderStatus">По умолчанию: папка загрузок браузера</span>
      </div>
      <button class="secondary-btn" id="chooseSaveFolderBtn" type="button">ВЫБРАТЬ ПАПКУ</button>
    `;

    const audioButton = document.getElementById('downloadAudioBtn');
    const settingsHead = document.querySelector('.settings-head');
    const dictaphoneMode = document.getElementById('dictaphoneMode');
    const dictaphoneSlot = document.getElementById('dictaphoneSaveFolderSlot');

    // Keep one folder picker (and its selected directory) across all modes.
    // Only move the existing DOM node when the visible mode changes.
    function placeFolderPicker() {
      const compactSlot = document.getElementById('saveFolderSlot');
      if (compactSlot) { if (row.parentElement !== compactSlot) compactSlot.appendChild(row); return; }
      if (dictaphoneSlot && dictaphoneMode && !dictaphoneMode.classList.contains('hidden')) {
        if (row.parentElement !== dictaphoneSlot) dictaphoneSlot.appendChild(row);
      } else if (audioButton) {
        if (row.previousElementSibling !== audioButton) audioButton.insertAdjacentElement('afterend', row);
      } else if (settingsHead) {
        settingsHead.insertAdjacentElement('beforebegin', row);
      } else {
        document.querySelector('.input-panel')?.appendChild(row);
      }
    }
    placeFolderPicker();
    if (dictaphoneMode && dictaphoneSlot) {
      const observer = new MutationObserver(placeFolderPicker);
      observer.observe(dictaphoneMode, { attributes: true, attributeFilter: ['class'] });
    }

    folderStatusEl = document.getElementById('saveFolderStatus');
    folderButtonEl = document.getElementById('chooseSaveFolderBtn');

    const supported = window.isSecureContext && typeof window.showDirectoryPicker === 'function';
    if (!supported) {
      folderButtonEl.disabled = true;
      folderButtonEl.textContent = 'НЕДОСТУПНО В БРАУЗЕРЕ';
      setFolderStatus('Выбор папки поддерживается в Chrome и Edge на компьютере', 'error');
      return;
    }

    folderButtonEl.addEventListener('click', async () => {
      try {
        const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
        const allowed = await ensureWritePermission(directory);
        if (!allowed) throw new Error('Нет разрешения на запись');
        selectedDirectory = directory;
        folderButtonEl.textContent = 'СМЕНИТЬ ПАПКУ';
        setFolderStatus(`Выбрана: ${directory.name}`, 'ok');
        showFolderToast(`Папка «${directory.name}» выбрана`);
        const busy = document.getElementById('transcribeBtnText')?.textContent?.includes('ОСТАНОВИТЬ');
        if (!busy) void saveMeeting();
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setFolderStatus(`Не удалось выбрать папку: ${error?.message || 'ошибка'}`, 'error');
        showFolderToast('Не удалось выбрать папку', 'error');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installFolderPicker, { once: true });
  } else {
    installFolderPicker();
  }
})();