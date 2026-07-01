// Genera la lista nel formato di import di Moxfield.
// Formato: "<qty> <Nome Carta> (<SET>) <numero>"  — set/numero sono opzionali
// ma rendono l'import preciso sull'edizione esatta.
window.SM = window.SM || {};

// `anyEdition` = l'utente ha scelto "Default (edizione automatica)" → nessuna edizione fissa.
function toMoxfield(cards, includeSet = true) {
  return cards
    .map(c => {
      let line = `${c.qty} ${c.name}`;
      if (includeSet && c.set && !c.anyEdition) {
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
    c.qty, 0, c.name, c.anyEdition ? '' : (c.set || '').toLowerCase(), 'NM', 'English',
    '', '', '', c.anyEdition ? '' : (c.collector || ''), 'False', 'False', ''
  ]);
  return [header, ...rows]
    .map(r => r.map(csvCell).join(','))
    .join('\r\n');
}

// Formato per l'import "decklist → Wants" di Cardmarket: "<qty> <Nome inglese>",
// con "(Espansione)" per le carte con edizione scelta (default = solo nome).
// La condizione minima (Near Mint) è un'impostazione della lista su Cardmarket.
function toCardmarketWants(cards) {
  return cards.map(c => {
    let line = `${c.qty} ${c.name}`;
    if (!c.anyEdition && c.setName) line += ` (${c.setName})`;
    return line;
  }).join('\n');
}

SM.moxfield = { toMoxfield, toCollectionCsv, toCardmarketWants };
