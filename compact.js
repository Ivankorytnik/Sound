(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const image = document.querySelector('.brand-mark img');
  const fallback = () => { image.hidden = true; image.parentElement.classList.add('logo-fallback'); };
  image.addEventListener('error', fallback);
  if (image.complete && !image.naturalWidth) fallback();
  document.querySelectorAll('.mode-tab').forEach((button, index, buttons) => {
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus(); buttons[next].click();
    });
  });
  let view = 'text';
  function syncView() {
    $('transcript').classList.toggle('hidden', view !== 'text');
    $('segmentsBox').classList.toggle('hidden', view !== 'segments');
    $('textViewBtn').setAttribute('aria-pressed', String(view === 'text'));
    $('segmentsViewBtn').setAttribute('aria-pressed', String(view === 'segments'));
    $('segmentsEmpty').hidden = !!$('segmentsList').children.length;
  }
  $('textViewBtn').onclick = () => { view = 'text'; syncView(); };
  $('segmentsViewBtn').onclick = () => { view = 'segments'; syncView(); };
  function sync() {
    const fileVisible = !$('fileCard').classList.contains('hidden');
    $('recordingCard').classList.toggle('hidden', !fileVisible);
    $('fileName').title = $('fileName').textContent;
    const hasText = !!$('transcript').value.trim();
    for (const id of ['copyBtn','downloadBtn','downloadExcelBtn']) $(id).disabled = !hasText;
    $('advancedSummary').textContent = [$('qualitySelect').selectedOptions[0].textContent.split('·')[0].trim(), $('cleanupSelect').selectedOptions[0].textContent.split('·')[0].trim()].join(' · ');
    $('actionHint').textContent = $('transcribeBtn').disabled ? 'Сначала запишите звук или выберите файл.' : $('startDictaphoneBtn').disabled ? 'Запись недоступна во время распознавания.' : '';
    syncView();
    const activeMode = document.querySelector('.mode-section:not(.hidden)');
    const actions = activeMode?.querySelector('.capture-actions');
    const recognition = document.querySelector('.recognition-controls');
    if (actions && actions.nextElementSibling !== recognition) actions.after(recognition);
    else if (!actions && activeMode && recognition.parentElement !== activeMode) activeMode.append(recognition);
    const fileMode = !$('fileMode').classList.contains('hidden');
    const audioTarget = fileMode ? $('fileMode') : matchMedia('(max-width: 899px)').matches ? document.querySelector('.grid') : document.querySelector('.input-panel');
    if ($('recordingCard').parentElement !== audioTarget) audioTarget.append($('recordingCard'));
  }
  document.addEventListener('input', sync);
  document.addEventListener('change', sync);
  // Observe only core-owned state; do not watch the classes changed by this view.
  const observer = new MutationObserver(sync);
  for (const id of ['fileCard','resultBlock','transcribeBtn','startDictaphoneBtn','fileMode','dictaphoneMode','liveMode']) observer.observe($(id), {attributes:true,attributeFilter:['class','disabled']});
  observer.observe($('segmentsList'), {childList:true});
  observer.observe($('fileName'), {childList:true});
  const mobile = matchMedia('(max-width: 899px)');
  function placeSettings() {
    const advanced = $('advancedSettings'), audio = $('recordingCard');
    const target = mobile.matches ? document.querySelector('.grid') : document.querySelector('.input-panel');
    target.append(advanced); sync();
  }
  mobile.addEventListener('change', placeSettings); placeSettings(); sync();
})();
