// Genera la lista nel formato di import di Moxfield.
// Formato: "<qty> <Nome Carta> (<SET>) <numero>"  — set/numero sono opzionali
// ma rendono l'import preciso sull'edizione esatta.
window.SM = window.SM || {};

function toMoxfield(cards, includeSet = true) {
  return cards
    .map(c => {
      let line = `${c.qty} ${c.name}`;
      if (includeSet && c.set) {
        line += ` (${c.set})`;
        if (c.collector) line += ` ${c.collector}`;
      }
      return line;
    })
    .join('\n');
}

// CSV nel formato "Collezione" di Moxfield (l'import collezione accetta solo .csv).
// Colonne identiche all'export nativo di Moxfield; valori di default ragionevoli
// (Near Mint, Inglese, non foil) dato che lo scanner non li rileva.
function csvCell(v) {
  return '"' + String(v).replace(/"/g, '""') + '"';
}

function toCollectionCsv(cards) {
  const header = [
    'Count', 'Tradelist Count', 'Name', 'Edition', 'Condition', 'Language',
    'Foil', 'Tags', 'Last Modified', 'Collector Number', 'Alter', 'Proxy', 'Purchase Price'
  ];
  const rows = cards.map(c => [
    c.qty, 0, c.name, (c.set || '').toLowerCase(), 'NM', 'English',
    '', '', '', c.collector || '', 'False', 'False', ''
  ]);
  return [header, ...rows]
    .map(r => r.map(csvCell).join(','))
    .join('\r\n');
}

// Formato per l'import "decklist → Wants" di Cardmarket: "<qty> <Nome inglese>".
// Cardmarket abbina per nome (inglese), niente set/numero.
function toCardmarketWants(cards) {
  return cards.map(c => `${c.qty} ${c.name}`).join('\n');
}

SM.moxfield = { toMoxfield, toCollectionCsv, toCardmarketWants };
