(() => {
  'use strict';

  const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  const blobByUrl = new Map();

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
    showFolderToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function setFolderStatus(text, kind = 'idle') {
    if (!folderStatusEl) return;
    folderStatusEl.textContent = text;
    folderStatusEl.dataset.kind = kind;
  }

  function sanitizeFileName(name) {
    const cleaned = String(name || 'file')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 180);
    return cleaned || 'file';
  }

  async function ensureWritePermission(handle) {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function') return true;
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    if (typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }
    return permission === 'granted';
  }

  async function pickAvailableFileName(directory, requestedName) {
    const safeName = sanitizeFileName(requestedName);
    const dot = safeName.lastIndexOf('.');
    const base = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : '';

    for (let i = 0; i < 1000; i += 1) {
      const candidate = i === 0 ? safeName : `${base} (${i})${ext}`;
      try {
        await directory.getFileHandle(candidate);
      } catch (error) {
        if (error?.name === 'NotFoundError') return candidate;
        throw error;
      }
    }
    return `${base}_${Date.now()}${ext}`;
  }

  async function saveBlobToFolder(blob, requestedName) {
    if (!selectedDirectory) throw new Error('Папка не выбрана');
    const allowed = await ensureWritePermission(selectedDirectory);
    if (!allowed) throw new Error('Нет разрешения на запись в выбранную папку');

    const fileName = await pickAvailableFileName(selectedDirectory, requestedName);
    const fileHandle = await selectedDirectory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }

    setFolderStatus(`Сохранено: ${fileName}`, 'ok');
    showFolderToast(`Файл сохранён в папку «${selectedDirectory.name}»`);
  }

  function fallbackDownload(blob, fileName) {
    const url = nativeCreateObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFileName(fileName);
    document.body.appendChild(anchor);
    nativeAnchorClick.call(anchor);
    anchor.remove();
    setTimeout(() => nativeRevokeObjectURL(url), 1200);
  }

  URL.createObjectURL = function createObjectURL(blob) {
    const url = nativeCreateObjectURL(blob);
    if (blob instanceof Blob) blobByUrl.set(url, blob);
    return url;
  };

  URL.revokeObjectURL = function revokeObjectURL(url) {
    setTimeout(() => {
      blobByUrl.delete(url);
      nativeRevokeObjectURL(url);
    }, 1800);
  };

  HTMLAnchorElement.prototype.click = function patchedAnchorClick(...args) {
    const href = this.href || '';
    const fileName = this.download || '';
    const blob = selectedDirectory && fileName && href.startsWith('blob:') ? blobByUrl.get(href) : null;

    if (!blob) return nativeAnchorClick.apply(this, args);

    saveBlobToFolder(blob, fileName).catch((error) => {
      setFolderStatus(`Не удалось сохранить в папку: ${error?.message || 'ошибка'}`, 'error');
      showFolderToast('Не удалось сохранить в выбранную папку. Файл будет скачан обычным способом.', 'error');
      fallbackDownload(blob, fileName);
    });
    return undefined;
  };

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