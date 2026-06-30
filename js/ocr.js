// OCR on-device con Tesseract.js. Legge il testo della carta e produce
// una lista di righe candidate (il nome MtG sta in alto, quindi diamo
// priorità alle prime righe alfabetiche più lunghe).
window.SM = window.SM || {};

// Tesseract impacchettato DENTRO l'app (offline, avvio rapido, niente download).
// Percorsi assoluti (dalla cartella della pagina) per funzionare anche dentro il Web Worker.
const BASE = new URL('.', location.href).href; // es. http://localhost/
const TESS_OPTS = {
  workerPath: BASE + 'tesseract/worker.min.js',
  corePath: BASE + 'tesseract/',
  langPath: BASE + 'tesseract/lang',
  gzip: true
};

// Lingua OCR corrente. Default 'eng' (veloce). 'eng+ita' quando servono le carte
// italiane (più lento ma legge meglio i nomi localizzati). Modelli inclusi nell'app.
let currentLangs = 'eng';
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await Tesseract.createWorker(currentLangs, 1, TESS_OPTS);
      // PSM 6 = blocco di testo uniforme: adatto sia alla fascia del nome sia al box testo.
      await w.setParameters({ tessedit_pageseg_mode: '6' });
      return w;
    })();
  }
  return workerPromise;
}

// Cambia lingua: scarta il worker corrente, il prossimo OCR ne crea uno nuovo.
async function setLanguages(langs) {
  if (langs === currentLangs) return;
  currentLangs = langs;
  const old = workerPromise;
  workerPromise = null;
  if (old) { try { (await old).terminate(); } catch (e) { /* ignora */ } }
}

// Esegue OCR su un dataURL immagine. Ritorna solo i candidati-nome (compatibilità).
async function ocrImage(dataUrl) {
  const worker = await getWorker();
  const { data } = await worker.recognize(dataUrl);
  return extractCandidates(data.text || '');
}

// OCR dell'intera carta: ritorna i candidati-nome E le parole distintive del
// testo (per aiutare la ricerca quando il nome è letto male).
async function ocrCard(dataUrl) {
  const worker = await getWorker();
  const { data } = await worker.recognize(dataUrl);
  const text = data.text || '';
  return { candidates: extractCandidates(text), tokens: extractTokens(text), text };
}

// Parole "di contenuto" dal testo regole: lunghe e poco comuni = distintive.
const STOPWORDS = new Set([
  'creature', 'creatures', 'target', 'damage', 'player', 'players', 'battlefield', 'control',
  'controls', 'whenever', 'enters', 'counter', 'counters', 'search', 'library', 'reveal',
  'basic', 'tapped', 'untapped', 'shuffle', 'until', 'other', 'token', 'tokens', 'equal',
  'among', 'their', 'there', 'draw', 'cards', 'color', 'colors', 'colored', 'spell', 'spells',
  'ability', 'abilities', 'combat', 'attack', 'attacks', 'block', 'blocks', 'attacking',
  'sacrifice', 'return', 'graveyard', 'graveyards', 'these', 'those', 'this', 'that', 'with',
  'from', 'when', 'your', 'have', 'this', 'into', 'onto', 'then', 'each', 'mana', 'creature'
]);
function extractTokens(text) {
  const words = (text.toLowerCase().match(/[a-zà-ÿ]{5,}/g) || []);
  const seen = new Set(), out = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w); out.push(w);
  }
  out.sort((a, b) => b.length - a.length); // le più lunghe (distintive) per prime
  return out.slice(0, 5);
}

// Da blocco di testo a righe candidate per il nome carta.
// Il nome di una carta MtG sta SEMPRE in cima, quindi diamo priorità alla
// posizione verticale (le righe più in alto si provano per prime), con una
// leggera preferenza per le righe "nome-simili" (poche parole, quasi tutte lettere).
function extractCandidates(text) {
  const lines = text
    .split('\n')
    .map(cleanLine)
    .filter(l => l.length >= 3 && /[a-zA-ZÀ-ÿ]/.test(l));

  const scored = lines.map((line, i) => {
    const words = line.split(' ').length;
    // Penalità forte per la posizione: più in basso = meno probabile sia il nome.
    let score = -i * 10;
    // Un nome è breve (1-4 parole): bonus; il testo descrittivo è lungo: malus.
    if (words >= 1 && words <= 4) score += 6;
    if (words > 6) score -= 6;
    return { line, score, i };
  });

  // Ordine stabile: prima per punteggio, a parità per posizione originale.
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));

  const seen = new Set();
  const out = [];
  for (const s of scored) {
    const key = s.line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.line);
    if (out.length >= 6) break;
  }
  return out;
}

// Pulisce simboli OCR spuri mantenendo lettere (anche accentate, per l'italiano),
// spazi, apostrofi, virgole, trattini.
function cleanLine(s) {
  return s
    .replace(/[^a-zA-ZÀ-ÿ'’,\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

SM.ocr = { ocrImage, ocrCard, extractCandidates, extractTokens, setLanguages };
