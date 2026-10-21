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

  async function saveBlobToFolder(blob, requestedName) {
    if (!selectedDirectory) return fallbackDownload(blob, requestedName);
    let writable = null;
    let completed = false;
    let fileName;
    try {
      if (!await ensureWritePermission(selectedDirectory)) throw new Error('Нет разрешения на запись');
      fileName = await pickAvailableFileName(selectedDirectory, requestedName);
      const fileHandle = await selectedDirectory.getFileHandle(fileName, { create: true });
      writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      completed = true;
      setFolderStatus(`Сохранено: ${fileName}`, 'ok');
      showFolderToast(`Сохранено в папку «${selectedDirectory.name}»`);
    } catch (error) {
      if (writable && !completed) { try { await writable.abort(); } catch {} }
      setFolderStatus(`Ошибка сохранения: ${error?.message || 'неизвестная ошибка'}`, 'error');
      showFolderToast('Сохранение в папку не удалось. Открываю обычную загрузку.', 'error');
      fallbackDownload(blob, requestedName);
    }
  }

  // Do not override global browser APIs or anchor clicks: only Speech Lab
  // downloads are intercepted, including the Excel export.
  window.SpeechLabFiles = Object.freeze({ save: saveBlobToFolder });

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
    if (audioButton) audioButton.insertAdjacentElement('afterend', row);
    else if (settingsHead) settingsHead.insertAdjacentElement('beforebegin', row);
    else document.querySelector('.input-panel')?.appendChild(row);

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