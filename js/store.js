// Persistenza locale della lista carte (localStorage) + statistiche.
window.SM = window.SM || {};

const KEY = 'scanmtg.cards.v2';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function save(cards) {
  localStorage.setItem(KEY, JSON.stringify(cards));
}

// Identità: stessa carta = stesso nome (EN) + set + numero.
function idOf(c) {
  return `${c.name}|${c.set}|${c.collector}`.toLowerCase();
}

function addCard(cards, card, qty) {
  const id = idOf(card);
  const existing = cards.find(c => idOf(c) === id);
  if (existing) {
    existing.qty += qty;
  } else {
    cards.push({ ...card, qty });
  }
  save(cards);
  return cards;
}

function setQty(cards, id, qty) {
  const c = cards.find(x => idOf(x) === id);
  if (c) c.qty = Math.max(1, qty);
  save(cards);
  return cards;
}

function removeCard(cards, id) {
  const out = cards.filter(c => idOf(c) !== id);
  save(out);
  return out;
}

function totalCount(cards) {
  return cards.reduce((n, c) => n + c.qty, 0);
}

// ---- Statistiche ----
const COLOR_NAMES = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde' };
const RARITY_NAMES = { common: 'Comuni', uncommon: 'Non comuni', rare: 'Rare', mythic: 'Mitiche' };

function colorBucket(c) {
  const cols = c.colors || [];
  if (cols.length === 0) return 'Incolore';
  if (cols.length > 1) return 'Multicolore';
  return COLOR_NAMES[cols[0]] || cols[0];
}

function stats(cards) {
  const total = totalCount(cards);
  let value = 0, priced = 0, unpriced = 0;
  const byColor = {}, byRarity = {}, bySet = {};

  for (const c of cards) {
    if (typeof c.priceEur === 'number') {
      value += c.priceEur * c.qty;
      priced += c.qty;
    } else {
      unpriced += c.qty;
    }
    const col = colorBucket(c);
    byColor[col] = (byColor[col] || 0) + c.qty;
    const rar = RARITY_NAMES[c.rarity] || (c.rarity ? c.rarity : 'Altre');
    byRarity[rar] = (byRarity[rar] || 0) + c.qty;
    const set = c.setName || c.set || '—';
    bySet[set] = (bySet[set] || 0) + c.qty;
  }

  const toSorted = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return {
    total, distinct: cards.length,
    value, priced, unpriced,
    byColor: toSorted(byColor),
    byRarity: toSorted(byRarity),
    bySet: toSorted(bySet)
  };
}

// ---- Collezione e Mazzi (array generici, salvataggio esplicito dal chiamante) ----
const COLL_KEY = 'scanmtg.collection.v1', DECKS_KEY = 'scanmtg.decks.v1';
function loadArr(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }
function saveArr(key, a) { localStorage.setItem(key, JSON.stringify(a)); }

// Unisce/incrementa una carta in un array qualsiasi (NON salva: pensa il chiamante).
function mergeCard(arr, card, qty) {
  const id = idOf(card);
  const ex = arr.find(c => idOf(c) === id);
  if (ex) ex.qty += qty; else arr.push({ ...card, qty });
  return arr;
}

const loadCollection = () => loadArr(COLL_KEY);
const saveCollection = a => saveArr(COLL_KEY, a);
const loadDecks = () => loadArr(DECKS_KEY);
const saveDecks = a => saveArr(DECKS_KEY, a);

SM.store = {
  load, save, idOf, addCard, setQty, removeCard, totalCount, stats,
  mergeCard, loadCollection, saveCollection, loadDecks, saveDecks
};
