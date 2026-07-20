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

/* ---- Patrones de batería en 16 pasos. Los valores son VELOCITY (0 = sin golpe,
   0.2 ≈ ghost note, 1 = acento). ohat = hi-hat abierto, ride = plato ride. ---- */
const DRUM_KITS = {
  rock:    { kick:[1,0,0,0, 0,0,.9,0, 0,0,1,0, 0,0,0,0], snare:[0,0,.2,0, 1,0,0,0, 0,.2,0,0, 1,0,.3,0], hat:[.9,0,.6,0, .9,0,.6,0, .9,0,.6,0, .9,0,.7,.5], swing:0 },
  pop:     { kick:[1,0,0,0, 0,0,0,0, .9,0,0,0, 0,0,.8,0], snare:[0,0,0,0, 1,0,0,0, 0,0,.2,0, 1,0,0,0], hat:[.8,0,.5,0, .8,0,.5,0, .8,0,.5,0, .8,0,.6,.6], ohat:[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1], swing:0 },
  funk:    { kick:[1,0,0,.6, 0,0,.9,0, 0,.5,0,0, 1,0,0,.5], snare:[0,0,.25,0, 1,0,.2,.3, 0,0,1,0, .3,0,.2,0], hat:[.9,.5,.9,.5, .9,.5,.9,.5, .9,.5,.9,.5, .9,.5,.9,.6], ohat:[0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0], swing:.12 },
  shuffle: { kick:[1,0,0,0, 0,0,.85,0, 0,0,.9,0, 0,0,0,0], snare:[0,0,0,0, 1,0,0,0, 0,.2,0,0, 1,0,0,0], hat:[.9,0,.55,.7, 0,.6,.9,0, .6,.7,0,.6, .9,0,.55,.7], swing:.55 },
  swing:   { kick:[.5,0,0,0, 0,0,0,0, .5,0,0,0, 0,0,0,0], snare:[0,0,.2,0, .35,0,0,0, 0,0,.2,0, .35,0,0,.4], ride:[1,0,.6,.8, 0,.6,1,0, .6,0,1,.8, 0,.6,1,0], swing:.58 },
  bossa:   { kick:[1,0,0,0, 0,0,.7,0, 0,0,.8,0, 0,0,0,0], snare:[.4,0,.5,0, .6,.4,0,0, .6,0,0,.5, 0,0,.5,0], hat:[.7,0,.6,0, .7,0,.6,0, .7,0,.6,0, .7,0,.6,0], swing:.05 },
  reggae:  { kick:[0,0,0,0, 0,0,0,0, .9,0,0,0, 0,0,0,0], snare:[0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,.2,0], hat:[0,0,.7,0, 0,0,.7,0, 0,0,.7,0, 0,0,.7,0], ohat:[0,0,0,0, 0,0,.6,0, 0,0,0,0, 0,0,.6,0], swing:0 }
};

/* ---- Comping de la armonía por género: 16 pasos de velocity + cómo suena cada golpe.
   sustainSteps = cuánto se mantiene el acorde (en pasos de semicorchea).
   El comping por género hace que la armonía deje de ser un "acordazo" plano. ---- */
const COMP_PATTERNS = {
  rock:   { hits:[.85,0,0,0, 0,0,0,0, .6,0,0,0, 0,0,0,0],            sustainSteps:8  },  // pads largos
  pop:    { hits:[.8,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,.4,0],             sustainSteps:14 },  // sostenido + empujón
  soul:   { hits:[.8,0,0,0, 0,0,.5,0, 0,0,0,0, .5,0,0,0],            sustainSteps:6  },
  blues:  { hits:[.8,0,0,0, .5,0,0,0, .7,0,0,0, .5,0,0,0],           sustainSteps:3  },
  funk:   { hits:[.9,0,0,.6, 0,.7,0,0, .5,0,.7,0, 0,.6,0,.5],        sustainSteps:1.4 }, // stabs cortos
  reggae: { hits:[0,0,0,0, .9,0,0,0, 0,0,0,0, .9,0,0,0],             sustainSteps:1.6 }, // skank a contratiempo
  bossa:  { hits:[.75,0,0,0, 0,0,.6,0, 0,.5,0,0, .6,0,0,0],          sustainSteps:4  },
  jazz:   { hits:[.7,0,0,0, 0,.6,0,0, .55,0,0,.6, 0,0,.5,0],         sustainSteps:3  }   // comping sincopado
};
function currentComp() { return COMP_PATTERNS[$('genre').value] || COMP_PATTERNS.pop; }

/* ---- Ritmo del bajo por género: 16 pasos de velocity (0 = silencio).
   Antes el bajo tocaba una negra por tiempo en TODOS los géneros; esto le da
   a cada estilo su propio groove (síncopas de funk, root-fifth de bossa, etc.). ---- */
const BASS_PATTERNS = {
  rock:   [1,0,0,0, 0,0,0,.6, 1,0,0,0, 0,0,.6,0],
  pop:    [1,0,0,0, .85,0,0,0, .85,0,0,0, .8,0,0,0],
  funk:   [1,0,.55,0, 0,.7,0,.5, .85,0,.55,0, 0,.7,0,.6],
  blues:  [1,0,0,0, .85,0,0,0, .85,0,0,0, .85,0,0,.6],
  reggae: [0,0,0,0, 1,0,0,0, 0,0,.7,0, 1,0,0,0],
  bossa:  [1,0,0,0, 0,0,.75,0, 0,0,.95,0, 0,0,.6,0],
  jazz:   [.95,0,0,0, .95,0,0,0, .95,0,0,0, .95,0,0,0],
  soul:   [1,0,0,0, 0,0,.55,0, .85,0,0,0, 0,.5,0,0]
};
function currentBassPattern() { return BASS_PATTERNS[$('genre').value] || BASS_PATTERNS.pop; }

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
let audioCtx, master, comp, reverb, drumsGain, bassGain, chordsGain, chordBus;
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

  // Cerrar modales: botones [data-close], click en backdrop, tecla Escape
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => {
    closeModal('libraryModal'); closeModal('nameModal');
  }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal('libraryModal'); closeModal('nameModal'); }
    if (e.key === 'Enter' && !$('nameModal').hidden) { e.preventDefault(); $('nameConfirm').click(); }
  });
  $('nameConfirm').addEventListener('click', () => {
    const text = $('nameInput').value.trim() || 'Sin nombre';
    closeModal('nameModal');
    if (typeof nameConfirmHandler === 'function') nameConfirmHandler(text);
    nameConfirmHandler = null;
  });

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

  // Bus de la armonía con CHORUS: da amplitud y "brillo" tipo Rhodes real.
  // Las voces del piano entran a chordBus; de ahí van en seco + por dos líneas de
  // delay moduladas por un LFO (desafinación suave que engorda el sonido).
  chordBus = audioCtx.createGain();
  const chorusDry = audioCtx.createGain(); chorusDry.gain.value = .8;
  const chorusWet = audioCtx.createGain(); chorusWet.gain.value = .5;
  chordBus.connect(chorusDry); chorusDry.connect(chordsGain);
  [{ delay: .012, rate: .6, depth: .003 }, { delay: .018, rate: .8, depth: .0035 }].forEach(cfg => {
    const dl = audioCtx.createDelay(); dl.delayTime.value = cfg.delay;
    const lfo = audioCtx.createOscillator(); const lfoGain = audioCtx.createGain();
    lfo.frequency.value = cfg.rate; lfoGain.gain.value = cfg.depth;
    lfo.connect(lfoGain); lfoGain.connect(dl.delayTime);
    chordBus.connect(dl); dl.connect(chorusWet); lfo.start();
  });
  chorusWet.connect(chordsGain);

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
  current16 = 0; barCount = 0; lastVoicing = null; currentVoicing = null;
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

/* Fill: en el último tiempo de cada 4º compás devuelve un golpe de tom (o null).
   Redoble descendente que "anuncia" el regreso al inicio de la vuelta. */
function fillHit(step) {
  if (barCount % 4 !== 3) return null;
  const bs = beatSteps();
  const start = meterSteps() - bs;     // primer paso del último tiempo del compás
  if (step < start) return null;
  const rel = step - start;            // posición dentro del fill (0..bs-1)
  const freqs = [300, 260, 210, 160];  // toms de agudo a grave
  const freq = freqs[Math.min(freqs.length - 1, Math.floor(rel / Math.max(1, bs / 4)))];
  const vel = 0.6 + (rel / bs) * 0.35;
  const snareHit = (rel === 0 || rel === bs - 1) ? 0.5 : 0;   // acento al abrir y cerrar
  return { freq, vel, snare: snareHit };
}

/* Pequeño "humanizador": desplaza el tiempo unos ms al azar (feel humano) */
function humanize(amount = 0.006) { return (Math.random() * 2 - 1) * amount; }
/* Varía la velocity un poco para que ningún golpe suene idéntico al anterior */
function humanizeVel(v) { return Math.max(0, Math.min(1, v * (0.88 + Math.random() * 0.18))); }

function scheduler() {
  if (!isPlaying) return;
  const kit = currentKit();
  while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
    const swing = (kit.swing || 0) * stepDuration();
    const t = nextNoteTime + (current16 % 2 === 1 ? swing : 0) + humanize();
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
    setChordForBar(progression[idx]);
    // Crash suave al comenzar cada vuelta de la progresión (no en cada compás)
    if (chordIndexForBar() === 0 && barCount > 0) crash(time, .5);
  }
  // Comping de la armonía según el patrón del género
  const compPat = currentComp();
  if (compPat.hits[step]) playChordHit(time, humanizeVel(compPat.hits[step]), compPat.sustainSteps);

  // Fill de batería: en el último tiempo de cada 4º compás, redoble de toms
  // que reemplaza el patrón normal para "anunciar" el cambio de vuelta.
  const fill = fillHit(step);
  if (fill) {
    tom(time, fill.freq, humanizeVel(fill.vel));
    if (fill.snare) snare(time, humanizeVel(fill.snare));
  } else {
    // Batería normal (solo si no estamos en un golpe de fill)
    if (kit.kick[step])  kick(time, humanizeVel(kit.kick[step]));
    if (kit.snare[step]) snare(time, humanizeVel(kit.snare[step]));
    if (kit.hat && kit.hat[step])   hat(time, humanizeVel(kit.hat[step]));
    if (kit.ohat && kit.ohat[step]) openHat(time, humanizeVel(kit.ohat[step]));
    if (kit.ride && kit.ride[step]) ride(time, humanizeVel(kit.ride[step]));
  }
  // Bajo: sigue el groove rítmico del género (no solo las negras)
  const bassPat = currentBassPattern();
  if (bassPat[step]) playBass(progression[chordIndexForBar()], time, step, humanizeVel(bassPat[step]));
  // Pulso visual: en cada negra
  if (step % beatSteps() === 0) flashBeat(time, step === 0, 0);
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
  car.connect(amp); amp.connect(chordBus || chordsGain);
  mod.start(time); car.start(time);
  mod.stop(time + dur + 0.7); car.stop(time + dur + 0.7);
}

let lastVoicing = null;   // notas MIDI del acorde anterior (para conducir voces)

/* Elige el voicing (octavas) más cercano al acorde previo => transiciones suaves */
function voiceLead(c) {
  const intervals = (CHORD_TYPES[c.quality] || CHORD_TYPES['']).slice(0, 5);
  const base = noteMidi(c.root, 4);   // fundamental en registro medio
  let notes = intervals.map(int => base + int);
  if (lastVoicing && lastVoicing.length) {
    const prevCenter = lastVoicing.reduce((a, b) => a + b, 0) / lastVoicing.length;
    // Sube o baja el bloque una octava si acerca el centro al del acorde anterior
    let center = notes.reduce((a, b) => a + b, 0) / notes.length;
    if (center - prevCenter > 6) notes = notes.map(n => n - 12);
    else if (prevCenter - center > 6) notes = notes.map(n => n + 12);
  }
  lastVoicing = notes;
  return notes;
}

let currentVoicing = null;   // voicing (MIDI) del compás en curso, para el comping

/* Fija el voicing del compás (conducción de voces) al cambiar de acorde */
function setChordForBar(c) {
  if (!c) { currentVoicing = null; return; }
  currentVoicing = { notes: voiceLead(c), bass: noteMidi(c.root, 3) - 12 };
}

/* Un golpe de comping del acorde actual: vel = intensidad, durSteps = duración */
function playChordHit(time, vel, durSteps) {
  if (!currentVoicing) return;
  const dur = stepDuration() * durSteps;
  // La fundamental grave solo suena en golpes fuertes (no en cada stab, para no embarrar)
  if (vel > .6) epVoice(midiToFreq(currentVoicing.bass), time, dur, 0.12 * vel);
  currentVoicing.notes.forEach((m, i) => {
    const t = time + i * 0.014 + humanize(0.004);
    const peak = (i === 0 ? 0.13 : 0.1) * vel;
    epVoice(midiToFreq(m), t, dur, peak);
  });
}

/* Una nota de bajo: cuerpo de triángulo filtrado + sub senoidal (ataque de dedo) */
function bassHit(midi, time, dur, peak = .26) {
  voice(midiToFreq(midi), time, dur, { type:'triangle', gainNode:bassGain, peak, cutoff:900, q:1.4, attack:.012, release:.18 });
  voice(midiToFreq(midi), time, dur, { type:'sine',     gainNode:bassGain, peak:peak*.92, cutoff:300, attack:.012, release:.18 }); // sub
}

function nextChordRoot() {
  const nextIdx = (chordIndexForBar() + 1) % progression.length;
  return noteMidi(progression[nextIdx].root, 2);
}

function playBass(c, time, step, vel = 1) {
  if (!c) return;
  const genre = $('genre').value;
  const root = noteMidi(c.root, 2);
  const fifth = root + 7, octave = root + 12;
  const bs = beatSteps();
  const isDownbeat = step % bs === 0;
  const beat = Math.floor(step / bs);
  const beatsPerBar = Math.max(1, Math.round(meterSteps() / bs));
  const isLastBeat = beat === beatsPerBar - 1;
  // Notas fuera del tiempo fuerte duran menos (más percusivas)
  const dur = (isDownbeat ? 3.2 : 1.6) * stepDuration();
  const peak = 0.26 * vel;

  let midi;
  switch (genre) {
    case 'jazz':
      // Walking en negras con nota guía; en el último tiempo, aproximación cromática
      // + una CORCHEA swingueada (tresillo) que empuja al siguiente "1".
      midi = isLastBeat ? root : root + [0,4,7,9][beat % 4];
      bassHit(midi, time, dur, peak);
      if (isLastBeat) {
        const approach = nextChordRoot() + (Math.random() < .5 ? -1 : 1);
        bassHit(approach, time + stepDuration() * bs * 0.66, stepDuration() * 1.6, peak * .85);
      }
      return;
    case 'blues':
      midi = isLastBeat && isDownbeat ? nextChordRoot() + (Math.random() < .5 ? -1 : 1)
                                      : root + [0,4,7,9][beat % 4];
      break;
    case 'funk':
      // Fundamental en los golpes fuertes; octava/quinta en las síncopas (pops)
      midi = isDownbeat ? (beat % 2 === 0 ? root : fifth) : (Math.random() < .5 ? octave : fifth);
      break;
    case 'bossa':
      // Patrón root-fifth latino: fundamental en fuertes, quinta en las síncopas
      midi = isDownbeat ? root : fifth;
      break;
    case 'reggae':
      midi = root;
      break;
    default: // rock, pop, soul
      midi = isDownbeat ? (beat === 2 ? fifth : root) : (Math.random() < .4 ? octave : root);
  }
  bassHit(midi, time, dur, peak);
}

/* --- Batería en capas (todas reciben velocity 0..1) --- */
function kick(time, vel = 1) {
  // "click" de ataque para que pegue más en la mezcla
  noiseBurst(time, .012, vel * .5, { type:'highpass', freq:2200, q:.7 });
  const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(48, time + .12);
  g.gain.setValueAtTime(vel, time);
  g.gain.exponentialRampToValueAtTime(.0001, time + .22);
  osc.connect(g); g.connect(drumsGain); osc.start(time); osc.stop(time + .24);
}

function snare(time, vel = 1) {
  // cuerpo tonal (dos tonos = caja más realista)
  [180, 240].forEach((f, i) => {
    const osc = audioCtx.createOscillator(); const og = audioCtx.createGain();
    osc.type = 'triangle'; osc.frequency.value = f;
    og.gain.setValueAtTime(vel * (i ? .18 : .3), time); og.gain.exponentialRampToValueAtTime(.0001, time + .09);
    osc.connect(og); og.connect(drumsGain); osc.start(time); osc.stop(time + .1);
  });
  // "esterilla": ruido con paso de banda; en ghost notes decae aún más rápido
  noiseBurst(time, vel < .4 ? .07 : .14, vel * .5, { type:'highpass', freq:1500, q:.7 });
}

function hat(time, vel = .6) {
  noiseBurst(time, .04, vel * .5, { type:'highpass', freq:7000, q:1 });
}

function openHat(time, vel = .6) {
  noiseBurst(time, .22, vel * .38, { type:'highpass', freq:6500, q:.8 });
}

function ride(time, vel = .6) {
  // ping metálico: tono agudo corto + cola de ruido tenue
  const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
  osc.type = 'square'; osc.frequency.value = 5200;
  g.gain.setValueAtTime(vel * .09, time); g.gain.exponentialRampToValueAtTime(.0001, time + .12);
  osc.connect(g); g.connect(drumsGain); osc.start(time); osc.stop(time + .13);
  noiseBurst(time, .18, vel * .16, { type:'highpass', freq:8000, q:.6 });
}

function crash(time, vel = .5) {
  noiseBurst(time, 1.1, vel * .32, { type:'highpass', freq:5000, q:.4 });
}

/* Tom (para fills): tono senoidal con caída de pitch, cuerpo redondo */
function tom(time, freq, vel = .8) {
  const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(freq * .6, time + .18);
  g.gain.setValueAtTime(vel, time); g.gain.exponentialRampToValueAtTime(.0001, time + .25);
  osc.connect(g); g.connect(drumsGain); osc.start(time); osc.stop(time + .26);
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

/* ---- Modales genéricos ---- */
function openModal(id) { const m = $(id); if (!m) return; m.hidden = false; }
function closeModal(id) { const m = $(id); if (m) m.hidden = true; }

/* Pide un nombre con el modal bonito; devuelve el texto vía callback (o null si cancela) */
let nameConfirmHandler = null;
function askName({ title, value = '', confirmLabel = 'Guardar', onConfirm }) {
  $('nameTitle').textContent = title;
  $('nameConfirm').textContent = confirmLabel;
  $('nameInput').value = value;
  nameConfirmHandler = onConfirm;
  openModal('nameModal');
  setTimeout(() => { $('nameInput').focus(); $('nameInput').select(); }, 30);
}

/* ---- Guardar ---- */
function saveProgression() {
  askName({
    title: 'Guardar progresión',
    value: '',
    confirmLabel: 'Guardar',
    onConfirm: (text) => {
      const saved = getSavedProgressions();
      const name = getUniqueProgressionName(text, saved);
      saved.push({
        id: cryptoId(), name, savedAt: new Date().toISOString(),
        key: $('key').value, mode: $('mode').value, meter: $('meter').value,
        genre: $('genre').value, tempo: $('tempo').value,
        progression: progression.map(c => ({ ...c }))
      });
      localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(saved));
      if ($('saveBtn')) { $('saveBtn').textContent = `Guardado ✓`; setTimeout(() => $('saveBtn').textContent = 'Guardar', 1600); }
    }
  });
}

/* ---- Abrir el gestor visual ---- */
function loadProgression() { renderLibrary(); openModal('libraryModal'); }

function renderLibrary() {
  const saved = getSavedProgressions();
  const list = $('libraryList');
  if (!saved.length) {
    list.innerHTML = `<p class="library-empty">Todavía no has guardado ninguna progresión.<br>Arma una y pulsa <strong>Guardar</strong>.</p>`;
    return;
  }
  list.innerHTML = saved.map(item => {
    const chords = (item.progression || []).map(chordName).join(' · ');
    const when = formatSavedDate(item.savedAt);
    return `<div class="lib-item" data-id="${item.id}">
      <div class="lib-main">
        <div>
          <div class="lib-name">${escapeHtml(item.name)}</div>
          <div class="lib-meta">
            <span class="lib-tag">${escapeHtml(item.genre || '—')}</span>
            <span class="lib-tag">${escapeHtml(item.key || '')} ${escapeHtml(item.mode || '')}</span>
            <span class="lib-tag">${escapeHtml(item.meter || '4/4')}</span>
            <span class="lib-tag">${escapeHtml(String(item.tempo || ''))} BPM</span>
            ${when ? `<span class="lib-tag">${when}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="lib-chords">${escapeHtml(chords)}</div>
      <div class="lib-actions">
        <button data-act="load">▶ Cargar</button>
        <button class="ghost" data-act="rename">Renombrar</button>
        <button class="ghost" data-act="duplicate">Duplicar</button>
        <button class="danger-btn" data-act="delete">Eliminar</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.lib-item').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-act="load"]').addEventListener('click', () => loadSavedById(id));
    el.querySelector('[data-act="rename"]').addEventListener('click', () => renameSaved(id));
    el.querySelector('[data-act="duplicate"]').addEventListener('click', () => duplicateSaved(id));
    el.querySelector('[data-act="delete"]').addEventListener('click', e => confirmDelete(e.currentTarget, id));
  });
}

function loadSavedById(id) {
  const d = getSavedProgressions().find(x => x.id === id);
  if (!d) return;
  $('key').value = d.key; $('mode').value = d.mode; $('genre').value = d.genre;
  $('meter').value = d.meter || '4/4';
  $('tempo').value = d.tempo; $('tempoValue').textContent = d.tempo;
  applyGenreMix(d.genre);
  progression = (d.progression || []).map(c => ({ ...c }));
  renderProgression(); updateScaleSuggestion();
  closeModal('libraryModal');
}

function renameSaved(id) {
  const saved = getSavedProgressions();
  const item = saved.find(x => x.id === id);
  if (!item) return;
  askName({
    title: 'Renombrar progresión', value: item.name, confirmLabel: 'Guardar',
    onConfirm: (text) => {
      const others = saved.filter(x => x.id !== id);
      item.name = getUniqueProgressionName(text, others);
      localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(saved));
      renderLibrary();
    }
  });
}

function duplicateSaved(id) {
  const saved = getSavedProgressions();
  const item = saved.find(x => x.id === id);
  if (!item) return;
  const copy = { ...item, id: cryptoId(), name: getUniqueProgressionName(`${item.name} (copia)`, saved), savedAt: new Date().toISOString(), progression: (item.progression || []).map(c => ({ ...c })) };
  saved.push(copy);
  localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(saved));
  renderLibrary();
}

/* Eliminar con confirmación en dos pasos sobre el propio botón */
function confirmDelete(btn, id) {
  if (btn.classList.contains('confirm')) {
    const saved = getSavedProgressions().filter(x => x.id !== id);
    localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(saved));
    renderLibrary();
    return;
  }
  btn.classList.add('confirm');
  btn.textContent = '¿Seguro? Eliminar';
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = 'Eliminar'; } }, 3000);
}

function getSavedProgressions() {
  let list;
  try { list = JSON.parse(localStorage.getItem(SAVED_PROGRESSIONS_KEY)) || []; }
  catch { return []; }
  let changed = false;
  list.forEach(item => { if (!item.id) { item.id = cryptoId(); changed = true; } });
  if (changed) localStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(list));
  return list;
}

function cryptoId() {
  return (crypto?.randomUUID?.() || 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s]));
}
function formatSavedDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return ''; }
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
