(() => {
  'use strict';

  // Audio stays on this computer, in this browser profile. No network requests.
  const DB_NAME = 'speechlab-recording-recovery-v1';
  const DB_VERSION = 1;
  const MAX_OPEN_BYTES = 300 * 1024 * 1024;
  const active = new Map();
  let dbPromise = null;
  let listEl = null;
  let folderListEl = null;
  let archiveEl = null;

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Ошибка IndexedDB'));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('Операция сохранения отменена'));
      tx.onerror = () => reject(tx.error || new Error('Ошибка сохранения'));
    });
  }

  function database() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('IndexedDB недоступна'));
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('chunks')) {
            const store = db.createObjectStore('chunks', { keyPath: ['sessionId', 'sequence'] });
            store.createIndex('sessionId', 'sessionId', { unique: false });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => db.close();
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище'));
        request.onblocked = () => reject(new Error('Хранилище занято другой вкладкой'));
      });
    }
    return dbPromise;
  }

  function message(text, error) {
    const status = document.getElementById('recoveryStatus');
    if (status) {
      status.textContent = text;
      status.classList.toggle('recovery-error', !!error);
    }
    if (error) console.warn('[Speech Lab recovery]', text);
  }

  function fileStamp(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
  }

  function extension(mime) {
    return mime.includes('ogg') ? '.ogg' : mime.includes('mp4') ? '.m4a' : '.webm';
  }

  function bytesText(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' МБ' :
      Math.round(bytes / 1024) + ' КБ';
  }

  async function begin(kind, mime) {
    try {
      const db = await database();
      if (active.has(kind)) throw new Error('Предыдущая запись ещё активна');
      const now = Date.now();
      const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
        String(now) + '-' + Math.random().toString(36).slice(2);
      const format = mime || 'audio/webm';
      const row = {
        id, kind, mime: format, createdAt: now, updatedAt: now,
        filename: (kind === 'live' ? 'meeting_' : 'dictaphone_') + fileStamp(now) + extension(format),
        bytes: 0, parts: 0, status: 'recording'
      };
      const tx = db.transaction('sessions', 'readwrite');
      const finished = transactionDone(tx);
      tx.objectStore('sessions').put(row);
      await finished;
      active.set(kind, { id, sequence: 0, queue: Promise.resolve(), failed: false });
      message('Резервная запись включена: фрагменты сохраняются в браузере.');
      void refresh();
      return id;
    } catch (error) {
      message('Нет резервного сохранения: ' + (error.message || String(error)) +
        '. Останови запись и скачай аудио вручную.', true);
      return null;
    }
  }

  function append(kind, blob) {
    const current = active.get(kind);
    if (!current || current.failed || !blob || !blob.size) return;
    const sequence = ++current.sequence;
    current.queue = current.queue.then(async () => {
      const db = await database();
      const tx = db.transaction(['chunks', 'sessions'], 'readwrite');
      const finished = transactionDone(tx);
      tx.objectStore('chunks').put({ sessionId: current.id, sequence, blob });
      const request = tx.objectStore('sessions').get(current.id);
      request.onsuccess = () => {
        const row = request.result;
        if (!row) return;
        row.bytes += blob.size;
        row.parts += 1;
        row.updatedAt = Date.now();
        tx.objectStore('sessions').put(row);
      };
      await finished;
    }).catch((error) => {
      current.failed = true;
      message('Резервное сохранение прервано: ' + (error.message || String(error)) +
        '. Запись ещё идёт, после остановки скачай аудио.', true);
    });
  }

  async function finish(kind) {
    const current = active.get(kind);
    if (!current) return false;
    active.delete(kind);
    await current.queue;
    if (current.failed) {
      void refresh();
      return false;
    }
    try {
      const db = await database();
      const tx = db.transaction('sessions', 'readwrite');
      const finished = transactionDone(tx);
      const request = tx.objectStore('sessions').get(current.id);
      request.onsuccess = () => {
        const row = request.result;
        if (!row) return;
        row.status = 'complete';
        row.updatedAt = Date.now();
        tx.objectStore('sessions').put(row);
      };
      await finished;
      message('Аудио сохранено в архив браузера. Можно повторно открыть его.');
      await refresh();
      return true;
    } catch (error) {
      message('Не удалось завершить резервное сохранение: ' + error.message, true);
      return false;
    }
  }

  async function sessions() {
    const db = await database();
    const tx = db.transaction('sessions', 'readonly');
    const result = await requestResult(tx.objectStore('sessions').getAll());
    return result.filter((row) => row.bytes > 0).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function restore(id) {
    try {
      const db = await database();
      const tx = db.transaction(['sessions', 'chunks'], 'readonly');
      const info = await requestResult(tx.objectStore('sessions').get(id));
      if (!info || info.bytes === 0) throw new Error('Фрагменты отсутствуют');
      if (info.bytes > MAX_OPEN_BYTES) throw new Error('Запись больше 300 МБ. Сначала сохрани её частями.');
      const parts = await requestResult(tx.objectStore('chunks').index('sessionId').getAll(id));
      parts.sort((a, b) => a.sequence - b.sequence);
      if (!parts.length || parts.length !== info.parts) throw new Error('Некоторые фрагменты записи отсутствуют');
      const blob = new Blob(parts.map((row) => row.blob), { type: info.mime });
      if (blob.size !== info.bytes) throw new Error('Размеры фрагментов не совпадают');
      const file = new File([blob], info.filename, { type: info.mime, lastModified: info.createdAt });
      if (!window.SpeechLabApp?.loadSavedRecording(file, '', { recorded: true })) {
        throw new Error('Останови текущую запись или распознавание');
      }
      message('Запись открыта. Нажми «РАСПОЗНАТЬ РЕЧЬ» или «СКАЧАТЬ АУДИОЗАПИСЬ».');
      return true;
    } catch (error) {
      message('Не удалось восстановить запись: ' + (error.message || String(error)), true);
      return false;
    }
  }

  async function remove(id) {
    try {
      const db = await database();
      const tx = db.transaction(['sessions', 'chunks'], 'readwrite');
      const finished = transactionDone(tx);
      const store = tx.objectStore('chunks');
      const cursor = store.index('sessionId').openKeyCursor(id);
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          store.delete(row.primaryKey);
          row.continue();
        }
      };
      tx.objectStore('sessions').delete(id);
      await finished;
      await refresh();
      message('Локальная резервная копия удалена.');
    } catch (error) {
      message('Не удалось удалить резервную копию: ' + error.message, true);
    }
  }

  function makeButton(label, callback, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn ' + (className || '');
    button.textContent = label;
    button.addEventListener('click', callback);
    return button;
  }

  function addRow(container, label, actionLabel, action, removeAction) {
    const row = document.createElement('div');
    row.className = 'recovery-entry';
    const name = document.createElement('span');
    name.textContent = label;
    row.append(name, makeButton(actionLabel, action));
    if (removeAction) row.append(makeButton('УДАЛИТЬ', removeAction, 'recovery-delete'));
    container.appendChild(row);
  }

  async function refresh() {
    if (!listEl) return;
    try {
      const saved = await sessions();
      listEl.replaceChildren();
      if (!saved.length) {
        listEl.textContent = 'Локальных резервных записей пока нет.';
        return;
      }
      for (const row of saved.slice(0, 50)) {
        const activeNow = [...active.values()].some((value) => value.id === row.id);
        const state = activeNow ? 'идёт запись' :
          row.status === 'complete' ? 'завершена' : 'прервана';
        const label = new Date(row.createdAt).toLocaleString('ru-RU') +
          ' · ' + (row.kind === 'live' ? 'Разговор' : 'Диктофон') +
          ' · ' + bytesText(row.bytes) + ' · ' + state;
        addRow(listEl, label, 'ОТКРЫТЬ', () => void restore(row.id), () => {
          if (activeNow) return message('Нельзя удалить запись, пока она идёт.', true);
          if (window.confirm('Удалить локальную резервную копию записи?')) void remove(row.id);
        });
      }
      if (saved.length > 50) {
        const note = document.createElement('p');
        note.textContent = 'Показаны последние 50 записей.';
        listEl.append(note);
      }
      if (saved.some((row) => row.status === 'recording' && ![...active.values()].some((v) => v.id === row.id))) {
        archiveEl.open = true;
      }
    } catch (error) {
      message('Архив браузера недоступен: ' + (error.message || String(error)), true);
    }
  }

  const mediaExtension = /\.(webm|wav|mp3|m4a|aac|ogg|mp4|mpeg|mpga)$/i;
  const textExtension = /\.txt$/i;

  function openFromFolder(file, transcript) {
    (async () => {
      try {
        const content = transcript ? await transcript.text() : '';
        if (!window.SpeechLabApp?.loadSavedRecording(file, content, { recorded: false })) {
          throw new Error('Сначала заверши активную запись или распознавание');
        }
        message(file ?
          'Файл открыт. Можно заново распознать его; сохранённый TXT показан справа.' :
          'Текст открыт. Для повторного распознавания понадобится аудиозапись.');
      } catch (error) {
        message('Не удалось открыть сохранённую встречу: ' + (error.message || String(error)), true);
      }
    })();
  }

  function listFolderFiles(files) {
    if (!folderListEl) return;
    folderListEl.replaceChildren();
    const groups = new Map();
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '(выбранная папка)';
      if (!groups.has(dir)) groups.set(dir, { audio: [], text: [] });
      if (mediaExtension.test(file.name)) groups.get(dir).audio.push(file);
      else if (textExtension.test(file.name)) groups.get(dir).text.push(file);
    }
    let count = 0;
    for (const [dir, group] of groups) {
      group.text.sort((a, b) => b.lastModified - a.lastModified);
      const audioFiles = group.audio.length ? group.audio : [null];
      for (const audio of audioFiles) {
        if (!audio && !group.text.length) continue;
        const base = audio?.name.replace(/\.[^.]+$/, '') || '';
        const transcript = group.text.find((file) => file.name.replace(/\.txt$/i, '') === base) ||
          group.text[0] || null;
        const title = dir + ' / ' + (audio?.name || transcript.name) +
          (transcript && audio ? ' + TXT' : '');
        addRow(folderListEl, title, 'ОТКРЫТЬ', () => openFromFolder(audio, transcript));
        count++;
        if (count >= 100) break;
      }
      if (count >= 100) break;
    }
    if (!count) folderListEl.textContent = 'В выбранной папке не найдены аудиозаписи или TXT.';
    else archiveEl.open = true;
  }

  function init() {
    if (document.getElementById('speechlabRecovery')) return;
    const insertAt = document.querySelector('.input-panel .panel-head');
    if (!insertAt) return;
    const style = document.createElement('style');
    style.textContent = [
      '.recovery-panel{margin:10px 0 16px;padding:10px 12px;border:1px solid var(--border, #454b55);border-radius:10px}',
      '.recovery-panel summary{cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.04em}',
      '.recovery-panel .recovery-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}',
      '.recovery-panel .recovery-list{display:grid;gap:6px;max-height:220px;overflow-y:auto}',
      '.recovery-panel .recovery-entry{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border, #454b55)}',
      '.recovery-panel .recovery-entry span{flex:1;min-width:0;overflow-wrap:anywhere;font-size:12px}',
      '.recovery-panel .recovery-entry button{font-size:11px;padding:7px 9px}',
      '.recovery-panel .recovery-delete{opacity:.72}',
      '.recovery-panel .recovery-note{font-size:12px;line-height:1.5;opacity:.8;margin:8px 0}',
      '.recovery-panel .recovery-error{color:#f18b8b}',
      '@media(max-width:600px){.recovery-panel .recovery-entry{flex-wrap:wrap}}'
    ].join('\n');
    document.head.appendChild(style);
    const details = document.createElement('details');
    details.id = 'speechlabRecovery';
    details.className = 'recovery-panel';
    details.innerHTML =
      '<summary>АРХИВ ЗАПИСЕЙ / ВОССТАНОВЛЕНИЕ</summary>' +
      '<p class="recovery-note">Резервные аудиофрагменты сохраняются только в этом браузере на этом компьютере. ' +
      'Очистка данных сайта удалит их. Незавершённая запись может не содержать последних секунд.</p>' +
      '<div class="recovery-actions"><button type="button" class="secondary-btn" id="restoreFolderBtn">' +
      'ОТКРЫТЬ ИЗ ПАПКИ</button><button type="button" class="secondary-btn" id="refreshRecoveryBtn">' +
      'ОБНОВИТЬ АРХИВ</button></div>' +
      '<p id="recoveryStatus" class="recovery-note" role="status">Здесь можно открыть прежнюю запись или TXT.</p>' +
      '<strong class="recovery-note">СОХРАНЕНО В БРАУЗЕРЕ</strong><div class="recovery-list" id="recoverySessions"></div>' +
      '<strong class="recovery-note">ФАЙЛЫ ИЗ ПАПКИ</strong><div class="recovery-list" id="recoveryFolderFiles">' +
      'Нажми «Открыть из папки» и выбери папку с сохранёнными встречами.</div>';
    insertAt.insertAdjacentElement('afterend', details);
    const chooser = document.createElement('input');
    chooser.type = 'file';
    chooser.multiple = true;
    chooser.setAttribute('webkitdirectory', '');
    chooser.setAttribute('directory', '');
    chooser.hidden = true;
    details.appendChild(chooser);
    listEl = document.getElementById('recoverySessions');
    folderListEl = document.getElementById('recoveryFolderFiles');
    archiveEl = details;
    details.querySelector('#restoreFolderBtn').addEventListener('click', () => chooser.click());
    details.querySelector('#refreshRecoveryBtn').addEventListener('click', () => void refresh());
    chooser.addEventListener('change', () => {
      listFolderFiles(Array.from(chooser.files || []));
      chooser.value = '';
    });
    void refresh();
  }

  window.SpeechLabRecovery = Object.freeze({ begin, append, finish, restore, refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
