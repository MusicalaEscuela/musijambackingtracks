/* ===========================================================================
   MusiJam — motor de backing tracks
   - Scheduler look-ahead (timing estable, sub-divisiones reales)
   - Síntesis con ADSR + filtros + reverb (suena cálido, no "8-bit")
   - Batería en capas (kick con pitch-drop, snare, hats) por grid de 16 pasos
   - Acordes con voicings + diccionario amplio de calidades
   - Editor de progresión + guardar/cargar (localStorage)
   ======================================================================== */

const KEYS = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const SEMIS = {C:0,Db:1,D:2,Eb:3,E:4,F:5,'F#':6,G:7,Ab:8,A:9,Bb:10,B:11};
const NOTE_NAMES = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

/* ---- Calidades de acorde: nombre -> intervalos (semitonos desde la fund.) ---- */
const CHORD_TYPES = {
  '':      [0,4,7],
  'm':     [0,3,7],
  '5':     [0,7,12],
  '6':     [0,4,7,9],
  'm6':    [0,3,7,9],
  '7':     [0,4,7,10],
  'maj7':  [0,4,7,11],
  'm7':    [0,3,7,10],
  'm7b5':  [0,3,6,10],
  'dim7':  [0,3,6,9],
  'aug':   [0,4,8],
  '9':     [0,4,7,10,14],
  'maj9':  [0,4,7,11,14],
  'm9':    [0,3,7,10,14],
  '11':    [0,4,7,10,14,17],
  '13':    [0,4,7,10,14,21],
  '7#9':   [0,4,7,10,15],
  'sus2':  [0,2,7],
  'sus4':  [0,5,7],
  'add9':  [0,4,7,14]
};
const QUALITY_LIST = Object.keys(CHORD_TYPES);

/* ---- Géneros: progresión por grados + estilo rítmico/armónico ---- */
const genrePatterns = {
  blues:  { degrees: [1,4,1,1,4,4,1,1,5,4,1,5], quality: 'bluesDom', drum: 'shuffle', bass: 'walking', tempo: 100 },
  rock:   { degrees: [1,6,4,5],                 quality: 'power',    drum: 'rock',    bass: 'root',    tempo: 120 },
  funk:   { degrees: [1,1,4,4],                 quality: 'minor7',   drum: 'funk',    bass: 'sync',    tempo: 104 },
  pop:    { degrees: [1,5,6,4],                 quality: 'pop',      drum: 'pop',     bass: 'root',    tempo: 110 },
  bossa:  { degrees: [1,6,2,5],                 quality: 'jazz',     drum: 'bossa',   bass: 'latin',   tempo: 132 },
  reggae: { degrees: [1,4,5,4],                 quality: 'triad',    drum: 'reggae',  bass: 'root',    tempo: 78 },
  jazz:   { degrees: [2,5,1,6],                 quality: 'jazz',     drum: 'swing',   bass: 'walking', tempo: 130 },
  soul:   { degrees: [1,3,4,2],                 quality: 'jazz',     drum: 'pop',     bass: 'root',    tempo: 96 }
};

/* ---- Balance de mezcla por género (batería / bajo / armonía) ---- */
const GENRE_MIX = {
  blues:  { drums:.6,  bass:.6,  chords:.5  },
  rock:   { drums:.7,  bass:.65, chords:.42 },
  funk:   { drums:.68, bass:.7,  chords:.4  },
  pop:    { drums:.6,  bass:.55, chords:.5  },
  bossa:  { drums:.48, bass:.55, chords:.6  },
  reggae: { drums:.6,  bass:.7,  chords:.45 },
  jazz:   { drums:.5,  bass:.6,  chords:.55 },
  soul:   { drums:.55, bass:.6,  chords:.58 }
};

const modeIntervals = {
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],
  dorian:     [0,2,3,5,7,9,10],
  mixolydian: [0,2,4,5,7,9,10],
  blues:      [0,3,5,6,7,10]
};

/* ---- Patrones de batería en 16 pasos (1 = golpe). Editable a futuro. ---- */
const DRUM_KITS = {
  rock:    { kick:[1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0], snare:[0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat:[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], swing:0 },
  pop:     { kick:[1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0], snare:[0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat:[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1], swing:0 },
  funk:    { kick:[1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0], snare:[0,0,0,0, 1,0,0,1, 0,0,1,0, 1,0,0,0], hat:[1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1], swing:.1 },
  shuffle: { kick:[1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0], snare:[0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat:[1,0,1,1, 0,1,1,0, 1,1,0,1, 1,0,1,1], swing:.55 },
  swing:   { kick:[1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0], snare:[0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1], hat:[1,0,1,1, 0,1,1,0, 1,0,1,1, 0,1,1,0], swing:.58 },
  bossa:   { kick:[1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0], snare:[0,0,1,0, 0,1,0,0, 1,0,0,1, 0,0,1,0], hat:[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], swing:.05 },
  reggae:  { kick:[0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0], snare:[0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0], hat:[0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0], swing:0 }
};

const challenges = [
  'Usa solo 3 notas durante una vuelta completa.',
  'Haz frases cortas y deja silencio entre cada idea.',
  'Empieza cada frase en el segundo tiempo.',
  'Toca únicamente corcheas durante 4 compases.',
  'Crea un motivo de 4 notas y repítelo con variaciones.',
  'Evita la tónica hasta el último compás.',
  'Responde cada frase como si fuera una conversación.',
  'Improvisa solo con notas del arpegio del acorde actual.'
];

/* ====================== Estado ====================== */
let audioCtx, master, comp, reverb, drumsGain, bassGain, chordsGain;
let progression = [];
let isPlaying = false;
let current16 = 0;           // paso actual dentro del compás (0..15)
let nextNoteTime = 0;        // tiempo (audioCtx) del próximo paso de 16
let schedulerId = null;
let barCount = 0;

const $ = id => document.getElementById(id);
const SCHEDULE_AHEAD = 0.12;  // s que miramos hacia adelante
const LOOKAHEAD_MS = 25;
const SAVED_PROGRESSIONS_KEY = 'musijam:progressions';
const METER_STEPS = { '4/4': 16, '3/4': 12, '6/8': 12 };

/* ====================== Init ====================== */
function init() {
  KEYS.forEach(k => $('key').insertAdjacentHTML('beforeend', `<option>${k}</option>`));
  $('key').value = 'A';
  applyGenreMix($('genre').value);
  buildProgression();
  updateScaleSuggestion();

  $('tempo').addEventListener('input', () => $('tempoValue').textContent = $('tempo').value);
  ['genre','key','mode','meter'].forEach(id => $(id).addEventListener('change', () => {
    if (id === 'genre') {
      const g = genrePatterns[$('genre').value];
      if (g.tempo) { $('tempo').value = g.tempo; $('tempoValue').textContent = g.tempo; }
      applyGenreMix($('genre').value);
    }
    buildProgression(); updateScaleSuggestion();
  }));
  $('startBtn').addEventListener('click', startJam);
  $('stopBtn').addEventListener('click', stopJam);
  $('randomBtn').addEventListener('click', randomize);
  $('challengeBtn').addEventListener('click', newChallenge);
  $('copyBtn').addEventListener('click', copyProgression);
  $('saveBtn')?.addEventListener('click', saveProgression);
  $('loadBtn')?.addEventListener('click', loadProgression);
  $('addBtn')?.addEventListener('click', () => { const c = progression[progression.length-1]; progression.push({ ...c, index: progression.length }); renderProgression(); });
  $('jazzBtn')?.addEventListener('click', jazzify);

  // Cargar la última progresión guardada al abrir (si existe)
  migrateLegacyProgression();
}

/* Ajusta los faders de la mezcla al balance ideal del género */
function applyGenreMix(genre) {
  const m = GENRE_MIX[genre]; if (!m) return;
  $('drumsVol').value = m.drums; $('bassVol').value = m.bass; $('chordsVol').value = m.chords;
  updateVolumes();
}

/* ====================== Progresión ====================== */
function buildProgression() {
  const key = $('key').value, genre = $('genre').value, mode = $('mode').value;
  const pattern = genrePatterns[genre];
  progression = pattern.degrees.map((d, i) => {
    const root = noteFromDegree(key, mode, d);
    const quality = chordQuality(d, mode, pattern.quality);
    return { root, quality, degree: d, index: i };
  });
  renderProgression();
}

function noteFromDegree(key, mode, degree) {
  const intervals = modeIntervals[mode] || modeIntervals.major;
  const semi = (SEMIS[key] + intervals[(degree - 1) % intervals.length]) % 12;
  return NOTE_NAMES[semi];
}

/* Devuelve la calidad (sufijo) según estilo armónico del género */
function chordQuality(degree, mode, style) {
  switch (style) {
    case 'power':    return '5';
    case 'bluesDom': return '7';
    case 'minor7':   return [1,2,4,6].includes(degree) ? 'm7' : degree === 5 ? '9' : 'm7';
    case 'jazz':     return degree === 1 ? 'maj7' : [2,3,6].includes(degree) ? 'm7' : degree === 5 ? '9' : 'm7b5';
    case 'pop':      return [2,3,6].includes(degree) ? 'm' : degree === 1 ? 'add9' : '';
    case 'triad':
    default:
      if (mode === 'minor' || mode === 'dorian') return [1,4,5].includes(degree) ? 'm' : '';
      return [2,3,6].includes(degree) ? 'm' : '';
  }
}

function chordName(c) { return c.root + c.quality; }

function renderProgression() {
  $('progression').innerHTML = progression.map((c, i) =>
    `<div class="chord" data-i="${i}">
       <small>${i+1}</small>
       <span class="chord-name">${chordName(c)}</span>
       <div class="chord-edit">
         <select class="root-sel" data-i="${i}">${NOTE_NAMES.map(n=>`<option ${n===c.root?'selected':''}>${n}</option>`).join('')}</select>
         <select class="qual-sel" data-i="${i}">${QUALITY_LIST.map(q=>`<option value="${q}" ${q===c.quality?'selected':''}>${q||'maj'}</option>`).join('')}</select>
         <button class="del-chord small ghost" data-i="${i}">✕</button>
       </div>
     </div>`).join('');

  document.querySelectorAll('.root-sel').forEach(s => s.addEventListener('change', e => { progression[+e.target.dataset.i].root = e.target.value; renderProgression(); }));
  document.querySelectorAll('.qual-sel').forEach(s => s.addEventListener('change', e => { progression[+e.target.dataset.i].quality = e.target.value; renderProgression(); }));
  document.querySelectorAll('.del-chord').forEach(b => b.addEventListener('click', e => { if (progression.length>1){ progression.splice(+e.target.dataset.i,1); renderProgression(); } }));
}

function updateActiveChord() {
  const idx = chordIndexForBar();
  document.querySelectorAll('.chord').forEach(el => el.classList.toggle('active', +el.dataset.i === idx));
  $('currentChord').textContent = chordName(progression[idx]) || '—';
}
function chordIndexForBar() { return barCount % progression.length; }

/* ====================== Audio (grafo) ====================== */
function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  master = audioCtx.createGain(); master.gain.value = .9;
  comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3; comp.attack.value = .005; comp.release.value = .25;
  master.connect(comp); comp.connect(audioCtx.destination);

  // Reverb por convolución (impulso sintético corto)
  reverb = audioCtx.createConvolver();
  reverb.buffer = makeImpulse(2.0, 2.6);
  const reverbHP = audioCtx.createBiquadFilter();   // recorta graves de la cola = menos barro
  reverbHP.type = 'highpass'; reverbHP.frequency.value = 350;
  const reverbGain = audioCtx.createGain(); reverbGain.gain.value = .2;
  reverb.connect(reverbHP); reverbHP.connect(reverbGain); reverbGain.connect(master);

  drumsGain = audioCtx.createGain();
  bassGain = audioCtx.createGain();
  chordsGain = audioCtx.createGain();
  [drumsGain, bassGain, chordsGain].forEach(g => g.connect(master));
  chordsGain.connect(reverb);   // solo la armonía va a la reverb (batería seca = pega más)

  ['drumsVol','bassVol','chordsVol'].forEach(id => $(id).addEventListener('input', updateVolumes));
  updateVolumes();
}

function makeImpulse(duration, decay) {
  const len = audioCtx.sampleRate * duration;
  const buf = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random()*2-1) * Math.pow(1 - i/len, decay);
  }
  return buf;
}

function updateVolumes() {
  if (!audioCtx) return;
  drumsGain.gain.value = Number($('drumsVol').value);
  bassGain.gain.value = Number($('bassVol').value);
  chordsGain.gain.value = Number($('chordsVol').value);
}

/* ====================== Transporte (scheduler look-ahead) ====================== */
function startJam() {
  ensureAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (isPlaying) return;
  isPlaying = true;
  current16 = 0; barCount = 0;
  const beatDur = 60 / Number($('tempo').value);
  const startAt = audioCtx.currentTime + .12;
  // Conteo de entrada: un compás de clics (el "1" acentuado) antes de tocar
  const countBeats = $('meter').value === '6/8' ? 6 : Number($('meter').value[0]);
  for (let i = 0; i < countBeats; i++) {
    countClick(startAt + i * beatDur, i === 0);
    flashBeat(startAt + i * beatDur, i === 0, 4 - i);
  }
  nextNoteTime = startAt + countBeats * beatDur;   // la música arranca tras el conteo
  $('audioStatus').textContent = 'Conteo…';
  setTimeout(() => { if (isPlaying) $('audioStatus').textContent = 'Sonando'; }, countBeats * beatDur * 1000);
  updateActiveChord();
  scheduler();
}

/* Clic de metrónomo para el conteo de entrada */
function countClick(time, accent) {
  const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
  osc.type = 'square'; osc.frequency.value = accent ? 1500 : 1000;
  g.gain.setValueAtTime(accent ? .3 : .18, time);
  g.gain.exponentialRampToValueAtTime(.0001, time + .05);
  osc.connect(g); g.connect(master); osc.start(time); osc.stop(time + .06);
}

/* Pulso visual sincronizado al audio (incluye número durante el conteo) */
function flashBeat(time, accent, countNumber) {
  const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
  setTimeout(() => {
    const dot = $('beatDot'); if (!dot) return;
    dot.classList.remove('pulse'); void dot.offsetWidth; dot.classList.add('pulse');
    dot.classList.toggle('accent', !!accent);
    if (countNumber) { $('currentChord').textContent = String(countNumber); }
  }, delay);
}

function stopJam() {
  isPlaying = false;
  if (schedulerId) clearTimeout(schedulerId);
  schedulerId = null;
  $('audioStatus').textContent = 'Audio apagado';
}

function stepDuration() {
  const bpm = Number($('tempo').value);
  return (60 / bpm) / 4;   // semicorchea; 3/4 y 6/8 usan 12 pasos por compás
}
function meterSteps() { return METER_STEPS[$('meter')?.value] || 16; }
function beatSteps() { return $('meter')?.value === '6/8' ? 2 : 4; }

function currentKit() { return DRUM_KITS[genrePatterns[$('genre').value].drum] || DRUM_KITS.rock; }

function scheduler() {
  if (!isPlaying) return;
  const kit = currentKit();
  while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
    const swing = (kit.swing || 0) * stepDuration();
    const t = nextNoteTime + (current16 % 2 === 1 ? swing : 0);
    scheduleStep(current16, t, kit);
    advanceStep();
  }
  schedulerId = setTimeout(scheduler, LOOKAHEAD_MS);
}

function advanceStep() {
  nextNoteTime += stepDuration();
  current16++;
  if (current16 >= meterSteps()) { current16 = 0; barCount++; }
}

function scheduleStep(step, time, kit) {
  // Inicio de compás: cambia acorde y dibuja
  if (step === 0) {
    const idx = chordIndexForBar();
    requestAnimationFrame(updateActiveChord);
    playChord(progression[idx], time);
  }
  if (kit.kick[step])  kick(time);
  if (kit.snare[step]) snare(time);
  if (kit.hat[step])   hat(time, step % 4 === 0 ? .9 : .5);
  // Bajo + pulso visual: en negras (cada 4 pasos)
  if (step % beatSteps() === 0) {
    const beat = Math.floor(step / beatSteps());
    playBass(progression[chordIndexForBar()], time, beat);
    flashBeat(time, step === 0, 0);
  }
}

/* ====================== Instrumentos ====================== */
function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function noteMidi(note, octave=3) { return 12 * (octave + 1) + SEMIS[note]; }

/* Voz con ADSR + filtro lowpass — base del sonido "cálido" */
function voice(freq, time, dur, { type='sawtooth', gainNode, peak=.2, cutoff=2200, q=1, attack=.008, release=.25, detune=0 } = {}) {
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  const filt = audioCtx.createBiquadFilter();
  osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
  filt.type = 'lowpass'; filt.frequency.value = cutoff; filt.Q.value = q;
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, time + dur + release);
  osc.connect(filt); filt.connect(amp); amp.connect(gainNode);
  osc.start(time); osc.stop(time + dur + release + .05);
}

/* Voz de piano eléctrico (Rhodes) por FM de 2 operadores:
   portadora senoidal + modulador senoidal con índice que decae => ataque tipo "tine"
   y cuerpo cálido en el sostenido. Suena mucho más musical que una onda filtrada. */
function epVoice(freq, time, dur, peak) {
  const car = audioCtx.createOscillator();
  const mod = audioCtx.createOscillator();
  const modGain = audioCtx.createGain();
  const amp = audioCtx.createGain();
  car.type = 'sine'; mod.type = 'sine';
  car.frequency.value = freq;
  mod.frequency.value = freq;                 // ratio 1:1 (timbre de Rhodes)

  // Índice de modulación: alto al inicio (campana/tine), cae rápido al cuerpo
  modGain.gain.setValueAtTime(freq * 2.4, time);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.18, time + 0.18);
  modGain.gain.exponentialRampToValueAtTime(freq * 0.04, time + dur);

  // Envolvente de amplitud: ataque rápido, decay natural, release con cola
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + 0.006);
  amp.gain.exponentialRampToValueAtTime(peak * 0.55, time + 0.25);
  amp.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.6);

  mod.connect(modGain); modGain.connect(car.frequency);
  car.connect(amp); amp.connect(chordsGain);
  mod.start(time); car.start(time);
  mod.stop(time + dur + 0.7); car.stop(time + dur + 0.7);
}

function playChord(c, time) {
  if (!c) return;
  const intervals = CHORD_TYPES[c.quality] || CHORD_TYPES[''];
  const base = noteMidi(c.root, 4) - 12;
  const dur = stepDuration() * 14;
  // Strum suave: las voces entran con micro-retraso para que respire como un piano real
  intervals.slice(0, 5).forEach((int, i) => {
    const f = midiToFreq(base + int);
    const t = time + i * 0.018;
    const peak = i === 0 ? 0.16 : 0.12;   // un poco más de fundamental
    epVoice(f, t, dur, peak);
  });
}

function playBass(c, time, beat) {
  if (!c) return;
  const genre = $('genre').value;
  let midi = noteMidi(c.root, 2);
  const fifth = midi + 7;
  // movimiento simple según estilo
  if (genre === 'jazz' || genre === 'blues') { midi += [0,4,7,9][beat % 4]; }      // caminando
  else if (genre === 'funk') { if (beat % 2 === 1) midi = fifth; }
  else if (beat === 2) midi = fifth;
  const dur = stepDuration()*3.2;
  // bajo redondo: cuerpo de triángulo filtrado + sub senoidal, ataque suave (dedo, no púa)
  voice(midiToFreq(midi), time, dur, { type:'triangle', gainNode:bassGain, peak:.26, cutoff:900, q:1.4, attack:.012, release:.18 });
  voice(midiToFreq(midi), time, dur, { type:'sine',     gainNode:bassGain, peak:.24, cutoff:300, attack:.012, release:.18 }); // sub
}

/* --- Batería en capas --- */
function kick(time) {
  const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(48, time + .12);
  g.gain.setValueAtTime(1, time);
  g.gain.exponentialRampToValueAtTime(.0001, time + .22);
  osc.connect(g); g.connect(drumsGain); osc.start(time); osc.stop(time + .24);
}

function snare(time) {
  // cuerpo tonal (dos tonos = caja más realista)
  [180, 240].forEach((f, i) => {
    const osc = audioCtx.createOscillator(); const og = audioCtx.createGain();
    osc.type = 'triangle'; osc.frequency.value = f;
    og.gain.setValueAtTime(i ? .18 : .3, time); og.gain.exponentialRampToValueAtTime(.0001, time + .09);
    osc.connect(og); og.connect(drumsGain); osc.start(time); osc.stop(time + .1);
  });
  // "esterilla": ruido con paso de banda, decaimiento corto
  noiseBurst(time, .14, .5, { type:'highpass', freq:1500, q:.7 });
}

function hat(time, vol=.6) {
  noiseBurst(time, .04, vol*.5, { type:'highpass', freq:7000, q:1 });
}

function noiseBurst(time, dur, vol, { type='highpass', freq=8000, q=1 } = {}) {
  const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random()*2-1;
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const filt = audioCtx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, time); g.gain.exponentialRampToValueAtTime(.0001, time + dur);
  src.connect(filt); filt.connect(g); g.connect(drumsGain); src.start(time); src.stop(time + dur + .02);
}

/* ====================== Guía / utilidades ====================== */
function updateScaleSuggestion() {
  const key = $('key').value, mode = $('mode').value;
  const labels = { major:'mayor / jónica', minor:'menor natural + pentatónica menor', dorian:'dórica', mixolydian:'mixolidia', blues:'blues + pentatónica menor' };
  $('scaleSuggestion').textContent = `${key} ${labels[mode]}. Prueba arpegios del acorde actual y resuelve frases en notas guía.`;
}
function newChallenge() { $('challenge').textContent = challenges[Math.floor(Math.random()*challenges.length)]; }

function randomize() {
  $('genre').value = Object.keys(genrePatterns)[Math.floor(Math.random()*Object.keys(genrePatterns).length)];
  $('key').value = KEYS[Math.floor(Math.random()*KEYS.length)];
  $('mode').value = Object.keys(modeIntervals)[Math.floor(Math.random()*Object.keys(modeIntervals).length)];
  const g = genrePatterns[$('genre').value];
  $('tempo').value = g.tempo || Math.floor(70+Math.random()*80); $('tempoValue').textContent = $('tempo').value;
  buildProgression(); updateScaleSuggestion(); newChallenge();
}

function copyProgression() {
  navigator.clipboard.writeText(progression.map(chordName).join(' | '));
  $('copyBtn').textContent = 'Copiado'; setTimeout(() => $('copyBtn').textContent = 'Copiar', 1000);
}

function saveProgression() {
  const requestedName = prompt('Nombre para esta progresión:');
  if (!requestedName?.trim()) return;
  const saved = getSavedProgressions();
  const name = getUniqueProgressionName(requestedName.trim(), saved);
  saved.push({ name, savedAt:new Date().toISOString(), key:$('key').value, mode:$('mode').value, meter:$('meter').value, genre:$('genre').value, tempo:$('tempo').value, progression });
  localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(saved));
  if ($('saveBtn')) { $('saveBtn').textContent = `Guardado: ${name}`; setTimeout(()=>$('saveBtn').textContent='Guardar',1600); }
}
function loadProgression() {
  const saved = getSavedProgressions();
  if (!saved.length) { alert('Todavía no hay progresiones personalizadas guardadas.'); return; }
  const list = saved.map((item, index) => `${index + 1}. ${item.name}`).join('\n');
  const selection = prompt(`Escribe el número de la progresión que quieres cargar:\n\n${list}`);
  if (selection === null) return;
  const d = saved[Number(selection) - 1];
  if (!d) { alert('Elige un número válido de la lista.'); return; }
  $('key').value = d.key; $('mode').value = d.mode; $('genre').value = d.genre;
  $('meter').value = d.meter || '4/4';
  $('tempo').value = d.tempo; $('tempoValue').textContent = d.tempo;
  applyGenreMix(d.genre);
  progression = d.progression; renderProgression(); updateScaleSuggestion();
}

function getSavedProgressions() {
  try { return JSON.parse(localStorage.getItem(SAVED_PROGRESSIONS_KEY)) || []; }
  catch { return []; }
}

function getUniqueProgressionName(requestedName, saved) {
  const existing = new Set(saved.map(item => item.name.toLocaleLowerCase()));
  if (!existing.has(requestedName.toLocaleLowerCase())) return requestedName;
  let copy = 2;
  while (existing.has(`${requestedName} (${copy})`.toLocaleLowerCase())) copy++;
  return `${requestedName} (${copy})`;
}

function migrateLegacyProgression() {
  const raw = localStorage.getItem('musijam:saved');
  if (!raw) return;
  try {
    const saved = getSavedProgressions();
    saved.push({ ...JSON.parse(raw), name:getUniqueProgressionName('Mi progresión', saved), savedAt:new Date().toISOString() });
    localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(saved));
    localStorage.removeItem('musijam:saved');
  } catch {}
}

/* ====================== Jazzificar ====================== */
/* Inserta un ii antes de cada V (acorde dominante) y aplica sustitución
   por tritono a algunos dominantes. Hace que cualquier progresión "respire" jazz. */
function jazzify() {
  const out = [];
  progression.forEach(c => {
    const isDom = ['7','9','13','7#9'].includes(c.quality);
    if (isDom) {
      // ii relativo (un quinto justo por encima del V => 2 semitonos abajo da el ii? )
      // El ii de un V está una 5ª justa por encima de la fund. del V (relación ii-V).
      const iiRoot = NOTE_NAMES[(SEMIS[c.root] + 7) % 12];
      out.push({ root: iiRoot, quality: 'm7', degree: 2, index: out.length });
      // 50% de los dominantes -> sustitución por tritono (fund. a un tritono de distancia)
      if (Math.random() < .5) {
        const subRoot = NOTE_NAMES[(SEMIS[c.root] + 6) % 12];
        out.push({ root: subRoot, quality: '13', degree: c.degree, index: out.length });
      } else {
        out.push({ ...c, quality: '13', index: out.length });
      }
    } else if (c.quality === '' || c.quality === 'm') {
      // triadas -> séptimas para color
      out.push({ ...c, quality: c.quality === 'm' ? 'm7' : 'maj7', index: out.length });
    } else {
      out.push({ ...c, index: out.length });
    }
  });
  progression = out;
  renderProgression();
}

init();
