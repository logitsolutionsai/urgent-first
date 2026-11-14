// Tokenizer with abbreviation expansion and light spelling normalisation.
//
// Every token keeps the [start, end) offsets of the original text it came from, so any match can be
// turned back into an exact substring of the item (the quote-or-reject guarantee depends on this).
// Abbreviations are expanded into several tokens that all point at the abbreviation's own span:
// "SOB" -> shortness | of | breath, each with the offsets of "SOB".

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/uy;

/** Abbreviations every pack gets. They exist so the context cues ("rule out", "history of") work. */
export const BUILTIN_ABBREVIATIONS = {
  'w/o': 'without',
  'r/o': 'rule out',
  'h/o': 'history of',
  'c/o': 'complains of',
  'y/o': 'years old',
  'y.o.': 'years old',
  "can't": 'cannot',
  'cant': 'cannot',
  "won't": 'will not',
  'wont': 'will not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "isn't": 'is not',
  "wasn't": 'was not',
  "aren't": 'are not',
  "weren't": 'were not',
  "hasn't": 'has not',
  "haven't": 'have not',
  "hadn't": 'had not',
  "don't": 'do not',
  "couldn't": 'could not',
  "shouldn't": 'should not',
};

/**
 * Blank out issue-template text with spaces, keeping every other character and every offset:
 *  - HTML comments (`<!-- ... -->`), invisible guidance on GitHub;
 *  - an issue-form field left empty: its "### Label" heading and GitHub's "_No response_" marker.
 * Neither is the reporter's words, so rules never read them ("### Crash log / _No response_" is not a crash,
 * and "### Known workarounds / _No response_" is not a workaround).
 */
export function maskTemplateText(text) {
  let out = text;
  if (out.includes('<!--')) out = out.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  if (out.includes('_No response_')) out = out.replace(/^#{1,6}[ \t][^\n]*\n(?:[ \t\r]*\n)*[ \t]*_No response_[ \t\r]*$/gm, (m) => m.replace(/[^\n]/g, ' '));
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** British/American and other spelling variants folded to one form. Applied to text and patterns alike. */
export function normalizeWord(raw) {
  let w = raw.toLowerCase().replace(/’/g, "'");
  if (w.endsWith("'s")) w = w.slice(0, -2);
  if (w.length > 4) {
    w = w
      .replace(/^oe/, 'e') // oesophagus, oedema, oestrogen
      .replace(/^foet/, 'fet') // foetal
      .replace(/aem/g, 'em') // haemorrhage, ischaemia, anaemia
      .replace(/paed/g, 'ped') // paediatric, orthopaedic
      .replace(/aes/g, 'es') // anaesthesia
      .replace(/aec/g, 'ec') // faeces, caecum
      .replace(/^tumour/, 'tumor')
      .replace(/isation/, 'ization')
      .replace(/ising$/, 'izing')
      .replace(/ised$/, 'ized');
  }
  return w;
}

/**
 * Compile an abbreviation table: { "SOB": "shortness of breath", "LKW": {"expand": "last known well", "case": "insensitive"} }.
 * A key containing an upper-case letter matches case-sensitively unless "case": "insensitive" is given.
 */
export function compileAbbreviations(table = {}, { includeBuiltins = true } = {}) {
  const merged = { ...(includeBuiltins ? BUILTIN_ABBREVIATIONS : {}), ...table };
  const out = [];
  for (const [key, val] of Object.entries(merged)) {
    const expand = typeof val === 'string' ? val : val.expand;
    const caseMode = typeof val === 'object' && val.case ? val.case : /[A-Z]/.test(key) ? 'sensitive' : 'insensitive';
    const flags = caseMode === 'sensitive' ? 'gu' : 'giu';
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(key)}(?![\\p{L}\\p{N}])`, flags);
    const words = [];
    for (const m of expand.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)) words.push(normalizeWord(m[0]));
    out.push({ key, expand, re, words });
  }
  // Longest keys first so "r/o" wins over "o" style collisions.
  out.sort((a, b) => b.key.length - a.key.length);
  return out;
}

function findAbbreviations(rawText, abbrevs) {
  const text = rawText.replace(/’/g, "'");
  const hits = [];
  for (const a of abbrevs) {
    a.re.lastIndex = 0;
    for (const m of text.matchAll(a.re)) hits.push({ s: m.index, e: m.index + m[0].length, words: a.words, key: a.key });
  }
  hits.sort((x, y) => x.s - y.s || y.e - x.e);
  const kept = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.s >= lastEnd) {
      kept.push(h);
      lastEnd = h.e;
    }
  }
  return kept;
}

/**
 * Tokenize text. Token kinds: "w" word, "q" question mark, "b" boundary (sentence end, semicolon, newline),
 * "c" soft boundary (comma, colon, bracket).
 * @returns {Array<{t:string,s:number,e:number,k:string,abbr?:string,gapBefore?:boolean,gapAfter?:boolean}>}
 */
export function tokenize(text, abbrevs = []) {
  const tokens = [];
  const abbrHits = findAbbreviations(text, abbrevs);
  let ai = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (ai < abbrHits.length && abbrHits[ai].s === i) {
      const h = abbrHits[ai++];
      for (const w of h.words) tokens.push({ t: w, s: h.s, e: h.e, k: 'w', abbr: h.key });
      i = h.e;
      continue;
    }
    while (ai < abbrHits.length && abbrHits[ai].s < i) ai++;
    const ch = text[i];
    WORD_RE.lastIndex = i;
    const m = WORD_RE.exec(text);
    if (m && m.index === i) {
      let end = i + m[0].length;
      // Do not swallow the start of an abbreviation that begins inside this word run (rare).
      if (ai < abbrHits.length && abbrHits[ai].s < end) end = abbrHits[ai].s;
      if (end > i) {
        tokens.push({ t: normalizeWord(text.slice(i, end)), s: i, e: end, k: 'w' });
        i = end;
        continue;
      }
    }
    if (ch === '?') {
      tokens.push({
        t: '?',
        s: i,
        e: i + 1,
        k: 'q',
        gapBefore: i === 0 || /\s/.test(text[i - 1]),
        gapAfter: i + 1 >= n || /\s/.test(text[i + 1]),
      });
      i++;
      continue;
    }
    if (ch === ',' || ch === ':' || ch === '(' || ch === ')') {
      tokens.push({ t: ch, s: i, e: i + 1, k: 'c' });
      i++;
      continue;
    }
    if (ch === '\n') {
      tokens.push({ t: '\n', s: i, e: i + 1, k: 'b' });
      i++;
      continue;
    }
    if ((ch === '.' || ch === '!' || ch === ';') && (i + 1 >= n || /\s/.test(text[i + 1]))) {
      tokens.push({ t: ch, s: i, e: i + 1, k: 'b' });
      i++;
      continue;
    }
    i++;
  }
  return tokens;
}

/** Damerau-Levenshtein distance capped at max+1 (optimal string alignment). */
export function editDistance(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/**
 * Compile a term ("worst headache of * life", "dissect*") into pattern tokens.
 * "*" alone matches any single word; a trailing "*" makes a prefix match.
 */
export function compileTerm(term, abbrevs = []) {
  const parts = [];
  const marked = term
    .replace(/(^|\s)\*(?=\s|$)/g, '$1 qqanyqq ')
    .replace(/([\p{L}\p{N}])\*/gu, '$1qqpfxqq');
  for (const tok of tokenize(marked, abbrevs)) {
    if (tok.k !== 'w') continue;
    if (tok.t === 'qqanyqq') parts.push({ any: true });
    else if (tok.t.endsWith('qqpfxqq')) parts.push({ t: tok.t.slice(0, -7), prefix: true });
    else parts.push({ t: tok.t });
  }
  return parts;
}

export function tokenMatches(pt, tt, { typos = false, typoMinLength = 7 } = {}) {
  if (pt.any) return { ok: true };
  if (pt.prefix) return { ok: tt.startsWith(pt.t) && pt.t.length >= 3 };
  if (tt === pt.t) return { ok: true };
  if (tt === pt.t + 's' || tt === pt.t + 'es') return { ok: true };
  if (pt.t.endsWith('y') && tt === pt.t.slice(0, -1) + 'ies') return { ok: true };
  if (typos && pt.t.length >= typoMinLength && tt.length >= typoMinLength - 1 && tt[0] === pt.t[0] && !/\d/.test(tt)) {
    if (editDistance(pt.t, tt, 1) <= 1) return { ok: true, fuzzy: true };
    if (editDistance(pt.t + 's', tt, 1) <= 1) return { ok: true, fuzzy: true };
  }
  return { ok: false };
}

/**
 * Find all occurrences of a compiled term in a token list.
 * Returns [{a, b, fuzzy}] where a..b are token indexes (inclusive).
 */
export function findTerm(pattern, tokens, opts) {
  const out = [];
  if (!pattern.length) return out;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].k !== 'w') continue;
    let j = i;
    let fuzzy = false;
    let ok = true;
    for (let p = 0; p < pattern.length; p++) {
      // A comma between two words of a phrase does not break it ("sudden, severe headache").
      if (p > 0 && tokens[j] && tokens[j].k === 'c' && tokens[j].t === ',') j++;
      const tok = tokens[j];
      if (!tok || tok.k !== 'w') {
        ok = false;
        break;
      }
      const r = tokenMatches(pattern[p], tok.t, opts);
      if (!r.ok) {
        ok = false;
        break;
      }
      if (r.fuzzy) fuzzy = true;
      j++;
    }
    if (ok) out.push({ a: i, b: j - 1, fuzzy });
  }
  return out;
}
