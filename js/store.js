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

SM.store = { load, save, idOf, addCard, setQty, removeCard, totalCount, stats };
