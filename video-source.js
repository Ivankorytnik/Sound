/* Browser-only media retrieval. No proxy, cookies, or server-side requests. */
(() => {
  'use strict';
  const MAX_BYTES = 300 * 1024 * 1024;
  const PROBE_BYTES = 1024 * 1024;
  const platforms = /(^|\.)(youtube\.com|youtu\.be|rutube\.ru|vk\.com|vkvideo\.ru)$/i;
  function validate(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Вставь полную ссылку на видео, начиная с https://.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Нужна HTTP/HTTPS-ссылка без логина и пароля.');
    }
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        host.endsWith('.internal') || host.includes(':') || /^\d+(\.\d+){3}$/.test(host) || !host.includes('.')) {
      throw new Error('Используй публичную ссылку на видео, без локальных или числовых сетевых адресов.');
    }
    if (platforms.test(host)) {
      throw new Error('Для ссылок на видеоплатформы нужен серверный обработчик. Он пока не подключён. Вставь прямую ссылку на видеофайл или загрузи файл с компьютера.');
    }
    if (location.protocol === 'https:' && url.protocol !== 'https:') {
      throw new Error('На защищённой странице нужна ссылка с https://.');
    }
    url.hash = '';
    return url;
  }
  function filename(url) {
    let name;
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { name = ''; }
    return (name || 'video.mp4').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
  }
  async function request(url, options, signal) {
    const response = await fetch(url, { ...options, signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
    validate(response.url || url);
    if (!response.ok) { await response.body?.cancel(); throw new Error('Источник вернул ошибку ' + response.status + '. Проверь, доступна ли ссылка.'); }
    return response;
  }
  async function bytes(response, limit, signal, partial = false, progress = () => {}) {
    const total = Number(response.headers.get('content-length')) || 0;
    if (!partial && total > limit) { await response.body?.cancel(); throw new Error('Видео больше 300 МБ. Загрузи файл меньшего размера.'); }
    if (!response.body) throw new Error('Источник не передал содержимое файла.');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > limit) {
          if (!partial) throw new Error('Видео больше 300 МБ. Загрузка остановлена.');
          chunks.push(value.subarray(0, limit - size)); size = limit;
          break;
        }
        chunks.push(value); size += value.length;
        progress(size, total);
        if (partial && size === limit) break;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
  // Read only complete MP4 boxes. Incomplete/truncated metadata stays unknown.
  function mp4Metadata(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tag = (i) => String.fromCharCode(...data.subarray(i, i + 4));
    const u32 = (i) => view.getUint32(i);
    const tracks = [];
    let duration = null;
    function walk(start, end, track = null, depth = 0) {
      if (depth > 8) return;
      for (let p = start; p + 8 <= end;) {
        let size = u32(p), header = 8;
        if (size === 1) {
          if (p + 16 > end) break;
          size = u32(p + 8) * 4294967296 + u32(p + 12); header = 16;
        }
        if (!size) size = end - p;
        if (!Number.isSafeInteger(size) || size < header || p + size > end) break;
        const type = tag(p + 4), b = p + header, e = p + size;
        if (type === 'moov' || type === 'mdia') walk(b, e, track, depth + 1);
        if (type === 'trak') { const t = {}; tracks.push(t); walk(b, e, t, depth + 1); }
        if (type === 'hdlr' && track && b + 12 <= e) track.type = tag(b + 8);
        if (type === 'tkhd' && track && size >= 84) {
          track.width = u32(e - 8) / 65536; track.height = u32(e - 4) / 65536;
        }
        if (type === 'mvhd' && b + 20 <= e) {
          const version = data[b];
          if (version === 0) { const scale = u32(b + 12); if (scale) duration = u32(b + 16) / scale; }
          if (version === 1 && b + 32 <= e) {
            const scale = u32(b + 20);
            if (scale) duration = (u32(b + 24) * 4294967296 + u32(b + 28)) / scale;
          }
        }
        p = e;
      }
    }
    // Tail ranges may begin halfway through mdat. Locate a complete moov box.
    const positions = [];
    for (let p = 0; p + 8 <= data.length;) {
      const size = u32(p);
      if (size < 8 || p + size > data.length) break;
      if (tag(p + 4) === 'moov') positions.push(p);
      p += size;
    }
    if (!positions.length) {
      for (let p = 0; p + 8 <= Math.min(data.length, PROBE_BYTES); p++) {
        if (data[p + 4] === 109 && data[p + 5] === 111 && data[p + 6] === 111 && data[p + 7] === 118) positions.push(p);
      }
    }
    for (const p of positions) {
      tracks.length = 0; duration = null;
      const size = u32(p);
      if (size < 8 || p + size > data.length) continue;
      walk(p + 8, p + size);
      const video = tracks.find((t) => t.type === 'vide');
      if (video) return { duration, hasAudio: tracks.some((t) => t.type === 'soun'),
        width: video.width, height: video.height };
    }
    return {};
  }
  function mediaType(response, data, url) {
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (/^video\//.test(type)) return type;
    if (data?.length >= 12 && String.fromCharCode(...data.subarray(4, 8)) === 'ftyp') return 'video/mp4';
    if (data?.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'video/webm';
    if ((!type || type === 'application/octet-stream') && /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(new URL(url).pathname)) return 'application/octet-stream';
    throw new Error('По этой ссылке находится страница или неподдерживаемый файл. Нужна прямая ссылка на видео.');
  }
  async function probe(value, signal) {
    const url = validate(value).href;
    let head = null;
    try { head = await request(url, { method: 'HEAD' }, signal); }
    catch (error) { signal.throwIfAborted(); /* Some servers do not implement HEAD. Try a bounded range. */ }
    const size = Number(head?.headers.get('content-length')) || 0;
    if (size > MAX_BYTES) throw new Error('Видео больше 300 МБ. Выбери файл меньшего размера.');
    const response = await request(url, { headers: { Range: 'bytes=0-' + (PROBE_BYTES - 1) } }, signal);
    const data = await bytes(response, PROBE_BYTES, signal, true);
    const type = mediaType(response, data, url);
    let metadata = mp4Metadata(data);
    const contentRange = response.headers.get('content-range') || '';
    const total = size || Number(contentRange.match(/\/(\d+)$/)?.[1]) ||
      (response.status === 200 ? Number(response.headers.get('content-length')) || 0 : 0);
    if (total > MAX_BYTES) throw new Error('Видео больше 300 МБ. Выбери файл меньшего размера.');
    if (!metadata.duration && total > PROBE_BYTES && response.status === 206 && type === 'video/mp4') {
      const tail = await request(url, { headers: { Range: 'bytes=' + Math.max(PROBE_BYTES, total - PROBE_BYTES) + '-' } }, signal);
      if (tail.status === 206) metadata = mp4Metadata(await bytes(tail, PROBE_BYTES, signal, true));
      else await tail.body?.cancel();
    }
    if (metadata.duration > 5400) throw new Error('Видео длиннее 90 минут. Раздели его на части.');
    return { url, name: filename(url), size: total, type, ...metadata };
  }
  async function retrieve(source, signal, progress) {
    const response = await request(validate(source.url).href, {}, signal);
    const data = await bytes(response, MAX_BYTES, signal, false, progress);
    if (!data.length) throw new Error('Видеофайл пустой.');
    const type = mediaType(response, data, source.url);
    return new File([data], source.name, { type });
  }
  window.SpeechVideoSource = Object.freeze({ validate, probe, retrieve, mp4Metadata });
})();
