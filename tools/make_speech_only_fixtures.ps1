# Rebuilds fixtures/speech-only/*.ogg for the "speech only" live-translation tests.
# Everything is synthetic and offline: Windows SAPI voices (English) + FFmpeg generators.
# No real meetings, no downloaded sounds. Run from the repository root on Windows:
#   powershell -ExecutionPolicy Bypass -File tools/make_speech_only_fixtures.ps1
$ErrorActionPreference = 'Stop'
$out = Join-Path (Get-Location) 'fixtures/speech-only'
$tmp = Join-Path $env:TEMP 'speechlab-fixtures'
New-Item -ItemType Directory -Force $out, $tmp | Out-Null
Add-Type -AssemblyName System.Speech

function Say($name, $voice, $text) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($voice)
  $s.Rate = -1
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, `
    ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile((Join-Path $tmp "$name.wav"), $fmt)
  $s.Speak($text)
  $s.Dispose()
}
function Ff([string[]]$ffArgs) {
  & ffmpeg -hide_banner -loglevel error -y @ffArgs
  if ($LASTEXITCODE) { throw "ffmpeg failed: $ffArgs" }
}
$enc = @('-ar', '16000', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k')

Say 'meeting' 'Microsoft Zira Desktop' 'Good morning everyone. We need to discuss the delivery schedule for next week. The new office will open in March.'
Say 'mentions' 'Microsoft David Desktop' 'I can hear the water running in the kitchen. Music is playing next door, and the birds are singing outside.'
Say 'thanks' 'Microsoft David Desktop' 'Thank you.'
Say 'yes' 'Microsoft Zira Desktop' 'Yes.'

# Speech that MUST be kept.
Ff (@('-i', "$tmp/meeting.wav") + $enc + "$out/speech-normal.ogg")
Ff (@('-i', "$tmp/meeting.wav", '-af', 'volume=-30dB') + $enc + "$out/speech-quiet-30db.ogg")
Ff (@('-i', "$tmp/mentions.wav") + $enc + "$out/speech-mentions-sounds.ogg")
# A lone short reply inside an otherwise silent 6-second fragment.
Ff (@('-i', "$tmp/thanks.wav", '-af', 'adelay=2000,apad=whole_dur=6') + $enc + "$out/speech-short-thank-you.ogg")
Ff (@('-i', "$tmp/yes.wav", '-af', 'adelay=2500,apad=whole_dur=6') + $enc + "$out/speech-short-yes.ogg")
# Speech over a music bed (-12 dB) and over pink noise (~10 dB SNR).
Ff (@('-i', "$tmp/meeting.wav", '-f', 'lavfi', '-i',
  'aevalsrc=0.25*(sin(2*PI*220*t)+sin(2*PI*277*t)+sin(2*PI*330*t))*(0.6+0.4*sin(2*PI*2*t)):s=16000:d=12',
  '-filter_complex', '[1]volume=-12dB[m];[0][m]amix=inputs=2:duration=first:normalize=0') + $enc + "$out/speech-over-music.ogg")
Ff (@('-i', "$tmp/meeting.wav", '-f', 'lavfi', '-i', 'anoisesrc=c=pink:a=0.05:r=16000:d=12',
  '-filter_complex', '[0][1]amix=inputs=2:duration=first:normalize=0') + $enc + "$out/speech-over-noise.ogg")

# Non-speech that MUST be dropped (12 s each = two live fragments).
Ff (@('-f', 'lavfi', '-i',
  'aevalsrc=0.2*(sin(2*PI*262*t)+sin(2*PI*330*t)+sin(2*PI*392*t))*(0.5+0.5*sin(2*PI*1.5*t))+0.15*sin(2*PI*(523+262*(mod(floor(t*4)\,3)))*t):s=16000:d=12') + $enc + "$out/noise-music.ogg")
Ff (@('-f', 'lavfi', '-i', 'anoisesrc=c=brown:a=0.4:r=16000:d=12', '-af',
  'lowpass=f=1800,volume=0.8,tremolo=f=3:d=0.4') + $enc + "$out/noise-water.ogg")
Ff (@('-f', 'lavfi', '-i',
  'aevalsrc=(lt(mod(t\,0.45)\,0.03))*(random(0)*2-1)*0.8:s=16000:d=12') + $enc + "$out/noise-claps.ogg")
Ff (@('-f', 'lavfi', '-i',
  'aevalsrc=lt(mod(t\,0.7)\,0.12)*0.3*sin(2*PI*(3000+1200*sin(2*PI*25*t))*t):s=16000:d=12') + $enc + "$out/noise-birds.ogg")
Ff (@('-f', 'lavfi', '-i',
  'aevalsrc=lt(mod(t\,0.55)\,0.06)*0.7*sin(2*PI*70*t)*exp(-40*mod(t\,0.55)):s=16000:d=12') + $enc + "$out/noise-footsteps.ogg")
Ff (@('-f', 'lavfi', '-i', 'anoisesrc=c=white:a=0.004:r=16000:d=12') + $enc + "$out/noise-quiet-hiss.ogg")
# Hard cases known to provoke Whisper hallucinations.
# Wordless "singing": glottal-like pulse train with a melody through vowel formants.
Ff (@('-f', 'lavfi', '-i',
  'aevalsrc=0.6*sin(2*PI*(140+40*mod(floor(t*2)\,4))*t)*(0.55+0.45*sin(2*PI*5*t))*lt(mod(t\,2)\,1.6):s=16000:d=12',
  '-af', 'equalizer=f=700:t=q:w=2:g=12,equalizer=f=1200:t=q:w=2:g=9,equalizer=f=2600:t=q:w=3:g=4,volume=-6dB') + $enc + "$out/noise-humming.ogg")
# Room hiss just above the RMS silence gate (classic "Thank you." / "you" trigger).
Ff (@('-f', 'lavfi', '-i', 'anoisesrc=c=pink:a=0.02:r=16000:d=12') + $enc + "$out/noise-hiss-above-gate.ogg")
Get-ChildItem $out | Select-Object Name, Length
