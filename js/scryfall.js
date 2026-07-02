// Scryfall API — riconoscimento (EN/IT), edizioni e prezzi Cardmarket.
// Docs: https://scryfall.com/docs/api  (rate limit ~10 req/s)
window.SM = window.SM || {};

const SCRYFALL = 'https://api.scryfall.com';
const HEADERS = { 'Accept': 'application/json' };

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sfGet(url) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Normalizza un oggetto carta/stampa di Scryfall nel formato dell'app.
function normCard(c) {
  return {
    name: c.name,                                   // nome inglese (per Moxfield)
    printedName: c.printed_name && c.lang !== 'en' ? c.printed_name : null, // nome localizzato (IT)
    lang: c.lang || 'en',
    set: (c.set || '').toUpperCase(),
    setName: c.set_name || '',
    collector: c.collector_number || '',
    rarity: c.rarity || '',
    type: c.type_line || (c.card_faces?.[0]?.type_line) || '',
    colors: c.colors || (c.card_faces?.[0]?.colors) || [],
    colorIdentity: c.color_identity || [],
    priceEur: c.prices && c.prices.eur ? parseFloat(c.prices.eur) : null, // Cardmarket €
    image: c.image_uris?.normal || c.image_uris?.large || c.image_uris?.small
      || c.card_faces?.[0]?.image_uris?.normal || c.card_faces?.[0]?.image_uris?.small || null
  };
}

// 1) Match inglese (tollerante agli errori OCR).
async function fuzzyEnglish(query) {
  const q = query.trim();
  if (q.length < 3) return null;
  const c = await sfGet(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(q)}`);
  return c && !c.object?.includes?.('error') && c.name ? normCard(c) : null;
}

// Ripulisce la query dai token di 1 carattere (rumore OCR) — la ricerca
// multilingua non è fuzzy, quindi una lettera spuria farebbe fallire il match.
function cleanQuery(s) {
  return String(s || '').split(/\s+/).filter(w => w.length > 1).join(' ').trim();
}

// 2) Fallback italiano (e altre lingue) tramite ricerca multilingua.
// Sceglie tra i risultati quello il cui nome (localizzato o inglese) somiglia
// di più alla query, così "Fulmine" → Lightning Bolt e non "Fulmine ad Arco".
async function searchMultilingual(query) {
  const q = cleanQuery(query);
  if (q.length < 3) return null;
  const r = await sfGet(`${SCRYFALL}/cards/search?q=${encodeURIComponent(q)}&include_multilingual=true&unique=cards`);
  if (!r || !r.data || !r.data.length) return null;
  let best = null, bestScore = -1;
  for (const c of r.data) {
    const s = Math.max(similarity(q, c.printed_name || ''), similarity(q, c.name));
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best ? normCard(best) : null;
}

// ---- Somiglianza testo (per scegliere il match giusto EN vs IT) ----
function normStr(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // toglie accenti
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
// 0..1 — quanto la riga OCR somiglia a un nome (gestisce token extra in coda).
function similarity(raw, name) {
  const a = normStr(raw), b = normStr(name);
  if (!a || !b) return 0;
  const full = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  // prova anche a tagliare la riga OCR alla lunghezza del nome (token extra in coda)
  const head = a.slice(0, b.length);
  const partial = 1 - levenshtein(head, b) / Math.max(head.length, b.length);
  return Math.max(full, partial);
}

// Miglior match per NOME confrontando inglese e italiano. Ritorna {card, score}.
async function bestNameMatch(candidates) {
  const top = candidates.slice(0, 4);
  let best = null, bestScore = 0;
  for (const raw of top) {
    const c = await fuzzyEnglish(raw);
    if (c) {
      const s = similarity(raw, c.name);
      if (s > bestScore) { best = c; bestScore = s; }
      if (s >= 0.8) return { card: c, score: s };
    }
    await delay(110);
  }
  if (bestScore < 0.8) {
    for (const raw of top) {
      const c = await searchMultilingual(raw);
      if (c) {
        const s = Math.max(similarity(raw, c.printedName || ''), similarity(raw, c.name));
        if (s > bestScore) { best = c; bestScore = s; }
        if (s >= 0.8) return { card: c, score: s };
      }
      await delay(110);
    }
  }
  return { card: best, score: bestScore };
}

async function identifyFromCandidates(candidates) {
  const r = await bestNameMatch(candidates);
  return r.score >= 0.45 ? r.card : null;
}

// Cerca per TESTO REGOLE (oracle): prova 3→2→1 parole distintive finché trova.
// Ritorna { pool, n } (carte candidate, e quante parole hanno dato il risultato).
async function searchByOracle(tokens) {
  const distinct = (tokens || []).slice(0, 4);
  for (let n = Math.min(3, distinct.length); n >= 1; n--) {
    const q = distinct.slice(0, n).map(t => `o:${t}`).join(' ');
    const r = await sfGet(`${SCRYFALL}/cards/search?q=${encodeURIComponent(q)}&unique=cards`);
    if (r && r.data && r.data.length) return { pool: r.data.slice(0, 40).map(normCard), n };
    await delay(110);
  }
  return { pool: [], n: 0 };
}

// Riconoscimento completo: usa il nome e, se incerto, anche il testo della carta.
// `tokens` = parole distintive del testo regole (da ocrCard).
async function identify(candidates, tokens) {
  const prim = await bestNameMatch(candidates);
  if (prim.card && prim.score >= 0.78) return prim.card;

  let best = prim.card, bestScore = prim.score;

  if (tokens && tokens.length) {
    const { pool } = await searchByOracle(tokens);
    // Tra le carte che hanno QUEL testo, scegli quella col nome più simile a ciò che
    // l'OCR ha letto. Soglia alta (0.55): "aggancia" un nome letto male alla carta
    // giusta, ma non inventa carte a caso se il nome è illeggibile.
    const top = candidates.slice(0, 4);
    for (const c of pool) {
      let s = 0;
      for (const raw of top) s = Math.max(s, similarity(raw, c.name), similarity(raw, c.printedName || ''));
      if (s >= 0.55 && s > bestScore) { bestScore = s; best = c; }
    }
  }
  return bestScore >= 0.45 ? best : null;
}

// Carica una carta dal nome esatto (usato dalle alternative e dalla ricerca manuale).
async function cardByName(name) {
  const c = await sfGet(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`);
  return c && c.name ? normCard(c) : null;
}

// Carica una stampa specifica (set + numero di collezione) → per l'immagine esatta.
async function cardBySetNumber(set, num) {
  const c = await sfGet(`${SCRYFALL}/cards/${(set || '').toLowerCase()}/${encodeURIComponent(num)}`);
  return c && c.name ? normCard(c) : null;
}

// Nomi alternativi suggeriti (per quando l'OCR è incerto).
async function autocompleteNames(query, exclude) {
  const r = await sfGet(`${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(query)}`);
  if (!r || !r.data) return [];
  return r.data.filter(n => n.toLowerCase() !== (exclude || '').toLowerCase()).slice(0, 5);
}

// Tutte le edizioni (stampe) di una carta, con prezzo Cardmarket, dalla più recente.
async function printingsByName(name) {
  const q = `!"${name}" unique:prints`;
  const r = await sfGet(`${SCRYFALL}/cards/search?q=${encodeURIComponent(q)}&order=released&dir=desc`);
  if (!r || !r.data) return [];
  return r.data.map(normCard);
}

SM.scryfall = {
  fuzzyEnglish, searchMultilingual, identifyFromCandidates, identify,
  cardByName, cardBySetNumber, autocompleteNames, printingsByName
};
