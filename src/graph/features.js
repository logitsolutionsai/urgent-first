// Similarity features for candidate links (algorithm text-signals-v1). Similarity only: nothing here reads or
// changes a tier, and the original text stays untouched for evidence.
//
// Input per item: the title and the non-template body text.
//  - Template and boilerplate lines masked by the engine (src/mask.js, recorded per item in the snapshot) are
//    blanked, as are HTML comments.
//  - Fenced code blocks, inline code, stack-trace frames, log lines and Markdown images/links targets are left
//    out of the word features (they are long, repetitive and shared by unrelated failures) but searched for
//    error identifiers, which are among the most specific signals a report has.
//  - Unicode NFKC, case folded, words of letters and digits; version numbers ("3.2.0") kept whole.
//  - A frozen, versioned stopword list (STOPWORDS_V1) and generic issue-tracker words are dropped.
// Weights: title words x3, error identifiers x4, version numbers x2, body words x1; a word's weight is the
// highest weight of the fields it appears in, times (1 + ln tf) with tf capped at 4.
// Caps: at most MAX_TOKENS tokens read per item (truncation reported), at most MAX_FEATURES kept per item.

export const ALGORITHM = 'text-signals-v1';
export const MAX_TOKENS = 3000;

// Frozen list: changing it is a new algorithm version. English function words plus words that every issue
// template and bug report uses (bug, issue, steps, expected...), which say nothing about which problem it is.
export const STOPWORDS_V1 = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below
between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few
for from further get gets getting got had hadn't has hasn't have haven't having he her here hers herself him
himself his how i i'd i'll i'm i've if in into is isn't it it's its itself just let's like me more most mustn't my
myself no nor not now of off on once only or other ought our ours ourselves out over own same shan't she should
shouldn't so some such than that that's the their theirs them themselves then there there's these they they're
this those through to too under until up us very was wasn't we we're were weren't what what's when where which
while who whom why will with won't would wouldn't you you're your yours yourself yourselves
bug bugs issue issues problem problems please thanks thank hi hello help anyone someone something anything
steps step reproduce reproduction expected actual behavior behaviour result results happen happens happened
see seen saw try tried trying use used using user users work works working worked version versions describe
description report reported reporting new still also really just get got make made way thing things time times
one two first second able unable when whenever every everything nothing seems seem seemed think know want need
current currently latest today yesterday issue's would've could've should've etc e.g i.e via per`.split(/\s+/).filter(Boolean),
);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu;
const VERSION_RE = /\bv?\d+(?:\.\d+){1,3}\b/g;
// Error identifiers: JS/Java/Python exception names, errno names, ERR_ codes, prefixed numeric codes, hex
// status codes, HTTP status phrases, exit codes. Fixed patterns; nothing compiled from item text.
const ERROR_RES = [
  /\b[A-Z][A-Za-z0-9]*(?:Error|Exception|Fault|Panic)\b/g,
  /\bE(?:ACCES|ADDRINUSE|AGAIN|CONNREFUSED|CONNRESET|EXIST|ISDIR|MFILE|NOENT|NOSPC|NOTDIR|NOTEMPTY|PERM|PIPE|TIMEDOUT|NOTFOUND|INTEGRITY|RESOLVE|BUSY)\b/g,
  /\bERR_[A-Z0-9_]{3,}\b/g,
  /\b[A-Z]{1,5}-?\d{3,6}\b/g,
  /\b0x[0-9A-Fa-f]{6,16}\b/g,
  /\b(?:HTTP|status(?: code)?)\s?[1-5]\d\d\b/gi,
  /\bexit(?:ed with)? code \d{1,3}\b/gi,
  /\bSIG(?:SEGV|ABRT|KILL|BUS|ILL|TERM)\b/g,
];

const FIELD_WEIGHT = { title: 3, body: 1, error: 4, version: 2 };

function blank(m) {
  return m.replace(/[^\n]/g, ' ');
}

function applyRanges(text, ranges) {
  if (!ranges || !ranges.length) return text;
  let out = '';
  let pos = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const s = Math.max(pos, r.start);
    const e = Math.min(text.length, r.end);
    if (e <= s) continue;
    out += text.slice(pos, s) + blank(text.slice(s, e));
    pos = e;
  }
  return out + text.slice(pos);
}

/** Prose only: code, logs, stack frames, image and link targets blanked. */
export function proseOnly(text) {
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
    .replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1?\2[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/`[^`\n]+`/g, blank)
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, (m, label) => label + ' '.repeat(m.length - label.length))
    .replace(/https?:\/\/\S+/g, blank)
    .replace(/^[ \t]*(?:at |File "|Traceback|\s*\^|\d{4}-\d\d-\d\d[T ]\d\d:\d\d|\[(?:INFO|WARN|WARNING|ERROR|DEBUG|TRACE)\]|(?:INFO|WARN|ERROR|DEBUG|TRACE)\b)[^\n]*$/gm, blank);
}

/**
 * A light, frozen suffix folding (part of text-signals-v1): fails, failed, failing -> fail; crashes -> crash;
 * saves, saved -> sav. Not a linguistic stemmer: it only makes two phrasings of the same report share words.
 * Chosen on the development pair set (bench/maintainer-radar/candidates.dev.*), never on the held-out set.
 */
export function foldWord(w) {
  if (w.length <= 4 || /[^a-z]/.test(w)) return w;
  let s = w;
  if (s.endsWith('ies') && s.length > 5) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('ing') && s.length > 6) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 5) s = s.slice(0, -2);
  else if (/(?:sh|ch|x|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith('s') && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

function addWord(acc, key, weight) {
  const cur = acc.get(key);
  if (cur) {
    cur.tf++;
    if (weight > cur.w) cur.w = weight;
  } else acc.set(key, { w: weight, tf: 1 });
}

/**
 * Raw features of one snapshot item, before idf: Map feature -> base weight, plus the error signature.
 * Feature keys: "w:<word>", "v:<version>", "e:<error id>".
 */
export function itemFeatures(si) {
  const acc = new Map();
  const surface = new Map();
  const errors = new Set();
  let tokens = 0;
  let truncated = false;
  const masksByField = new Map();
  for (const m of si.masked || []) {
    if (!masksByField.has(m.field)) masksByField.set(m.field, []);
    masksByField.get(m.field).push(m);
  }
  const fields = [['title', si.title || ''], ...Object.entries(si.text || {})];
  for (const [field, raw] of fields) {
    if (typeof raw !== 'string' || !raw) continue;
    const unmasked = field === 'title' ? raw : applyRanges(raw, masksByField.get(field));
    const nf = unmasked.normalize('NFKC');
    for (const re of ERROR_RES) {
      re.lastIndex = 0;
      for (const m of nf.matchAll(re)) {
        const id = m[0].replace(/\s+/g, ' ').toUpperCase();
        if (/^(?:HTTP|STATUS)/.test(id) && /\b[23]\d\d$/.test(id)) continue; // 2xx and 3xx are not errors
        errors.add(id);
        addWord(acc, `e:${id}`, FIELD_WEIGHT.error);
      }
    }
    const prose = (field === 'title' ? nf : proseOnly(nf)).toLowerCase();
    const weight = field === 'title' ? FIELD_WEIGHT.title : FIELD_WEIGHT.body;
    VERSION_RE.lastIndex = 0;
    for (const m of prose.matchAll(VERSION_RE)) addWord(acc, `v:${m[0].replace(/^v/, '')}`, FIELD_WEIGHT.version);
    for (const m of prose.matchAll(WORD_RE)) {
      if (tokens >= MAX_TOKENS) {
        truncated = true;
        break;
      }
      tokens++;
      let w = m[0].replace(/’/g, "'").replace(/^['-]+|['-]+$/g, '');
      if (w.endsWith("'s")) w = w.slice(0, -2);
      if (w.length < 3 || /^\d+$/.test(w) || /^\d/.test(w) || STOPWORDS_V1.has(w)) continue;
      const key = `w:${foldWord(w)}`;
      if (!surface.has(key) || w < surface.get(key)) surface.set(key, w);
      addWord(acc, key, weight);
    }
  }
  const base = new Map();
  for (const [k, { w, tf }] of acc) base.set(k, w * (1 + Math.log(Math.min(tf, 4))));
  return { base, errors: [...errors].sort(), truncated, tokens, surface };
}
