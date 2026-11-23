"""REAL-model evaluation of the "speech only" live mode (no fake Worker, no mocks).

Feeds 6-second fragments of synthetic fixtures (fixtures/speech-only, built offline by
tools/make_speech_only_fixtures.ps1) straight into live-translate-worker.js, exactly as
the live page does, with speech-only ON and OFF.

Pass criteria (speech-only ON):
  * every speech fixture keeps its English phrase and gets a Russian translation;
  * every non-speech fixture (music, water, claps, birds, footsteps, hiss) yields nothing.
Usage: python live_speech_only_real_test.py [--profile DIR] [--report-only]
"""
import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
PROFILE = sys.argv[sys.argv.index("--profile") + 1] if "--profile" in sys.argv else None
REPORT_ONLY = "--report-only" in sys.argv

# fixture -> words that must appear in the kept English text (any one of each group)
SPEECH = {
    "speech-normal": [("delivery", "schedule")],
    "speech-quiet-30db": [("delivery", "schedule")],
    "speech-mentions-sounds": [("water",), ("music", "bird")],
    "speech-short-thank-you": [("thank",)],
    "speech-short-yes": [("yes",)],
    "speech-over-music": [("delivery", "schedule")],
    "speech-over-noise": [("delivery", "schedule")],
}
NOISE = ["noise-music", "noise-water", "noise-claps", "noise-birds", "noise-footsteps",
         "noise-quiet-hiss", "noise-humming", "noise-hiss-above-gate"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


RUN = """async ({ names, modes }) => {
  const worker = new Worker('./live-translate-worker.js?build=speech-only-eval', { type: 'module' });
  const next = (pred) => new Promise((resolve) => {
    const handler = ({ data }) => {
      if (pred(data)) { worker.removeEventListener('message', handler); resolve(data); }
    };
    worker.addEventListener('message', handler);
  });
  worker.postMessage({ type: 'init', webgpu: false });
  const init = await next((d) => d.type === 'ready' || (d.type === 'failure' && d.phase === 'init'));
  if (init.type !== 'ready') return { error: init.message };
  const ctx = new OfflineAudioContext(1, 16000, 16000);
  const rows = [];
  let index = 0;
  for (const name of names) {
    const bytes = await (await fetch('./fixtures/speech-only/' + name + '.ogg')).arrayBuffer();
    const samples = (await ctx.decodeAudioData(bytes)).getChannelData(0);
    for (const speechOnly of modes) {
      for (let start = 0; start < samples.length; start += 6 * 16000) {
        const audio = samples.slice(start, start + 6 * 16000);
        if (audio.length < 4000) continue;
        index += 1;
        const t0 = performance.now();
        worker.postMessage({ type: 'infer', session: 1, index, start: start / 16000,
          end: (start + audio.length) / 16000, speechOnly, audioBuffer: audio.buffer }, [audio.buffer]);
        const reply = await next((d) => (d.type === 'segment' || d.type === 'failure') && d.index === index);
        rows.push({ name, speechOnly, fragment: start / 16000 / 6, ms: Math.round(performance.now() - t0),
          en: reply.en || '', ru: reply.ru || '', silent: Boolean(reply.silent),
          filtered: reply.filtered || '', vad: reply.vad || null, error: reply.message || '' });
      }
    }
  }
  worker.terminate();
  return { rows };
}"""

server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 8781), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        if PROFILE:
            context = p.chromium.launch_persistent_context(PROFILE, headless=True, args=["--no-sandbox"])
        else:
            context = p.chromium.launch(headless=True, args=["--no-sandbox"]).new_context()
        page = context.new_page()
        page.goto("http://127.0.0.1:8781/live-captions.html")
        result = page.evaluate(RUN, {"names": list(SPEECH) + NOISE, "modes": [True, False]})
        context.close()
    assert "error" not in result, result
    rows = result["rows"]
    for row in rows:
        mode = "ONLY" if row["speechOnly"] else "RAW "
        verdict = "drop:" + (row["filtered"] or "silent") if row["silent"] else "KEEP"
        vad = row["vad"] or {}
        print(f"{mode} {row['name']:<24} #{row['fragment']:.0f} {row['ms']:>5}ms "
              f"vad={vad.get('speech', '-')}s conf={vad.get('confident', '-')}s mean={vad.get('mean', '-')} max={vad.get('max', '-')} {verdict:<18} "
              f"{row['en'][:70]!r} {row['error'][:60]}")

    failures = []
    for name, groups in SPEECH.items():
        kept = " ".join(r["en"] for r in rows if r["name"] == name and r["speechOnly"] and not r["silent"]).lower()
        russian = " ".join(r["ru"] for r in rows if r["name"] == name and r["speechOnly"] and not r["silent"])
        for group in groups:
            if not any(word in kept for word in group):
                failures.append(f"LOST SPEECH {name}: none of {group} in {kept!r}")
        if not any("а" <= c.lower() <= "я" for c in russian):
            failures.append(f"NO RUSSIAN {name}: {russian!r}")
    for name in NOISE:
        leaked = [r["en"] for r in rows if r["name"] == name and r["speechOnly"] and not r["silent"]]
        if leaked:
            failures.append(f"NOISE LEAKED {name}: {leaked}")
    raw_leaks = sum(1 for r in rows if r["name"] in NOISE and not r["speechOnly"] and not r["silent"])
    only_ms = [r["ms"] for r in rows if r["speechOnly"]]
    print(json.dumps({"raw_noise_fragments_with_text": raw_leaks,
                      "speech_only_avg_ms": round(sum(only_ms) / len(only_ms)),
                      "failures": failures}, ensure_ascii=False, indent=1))
    if not REPORT_ONLY:
        assert not failures, failures
    print("SPEECH-ONLY REAL EVALUATION " + ("REPORTED" if REPORT_ONLY else "PASS"))
finally:
    server.shutdown()
