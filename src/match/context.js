// Negation, suspicion and history context, in the spirit of NegEx / ConText, tuned for triage.
//
// Rules of the game:
//  - A NEGATION cue ("no", "denies", "without", "negative for", "ruled out") puts the words in its scope
//    out of play: "no history of stroke" does not count as stroke.
//  - A SUSPICION cue ("r/o", "rule out", "?", "query", "concern for", "suspected", "cannot exclude")
//    makes the words in its scope count as POSITIVE. A suspected condition is an urgent one for triage.
//    Suspicion always wins over negation and history.
//  - A HISTORY cue ("history of", "h/o", "prior", "previous", "family history of", "3 years ago") marks
//    the words as historical; rules ignore historical mentions unless a condition opts in.
//  - Pseudo cues ("no longer", "not improving", "3 weeks old") contain a cue word but are not cues.
//  - Scopes run for a window of words, stop at sentence ends, "?", terminators ("but", "however", "now"),
//    and at the next cue.
//  - Words like "cannot", "unable", "not passing" are NOT negation cues: in an order they usually describe
//    a symptom ("cannot pass urine"). Write such phrases into rules directly.

import { tokenize, normalizeWord } from './text.js';

export const DEFAULT_CUES = {
  negation_pre: [
    'no', 'denies', 'denied', 'deny', 'denying', 'without', 'negative for', 'neg for', 'free of',
    'absence of', 'no evidence of', 'no evidence for', 'no sign of', 'no signs of', 'no symptoms of',
    'no features of', 'no history of', 'no hx of', 'no h/o', 'nor', 'not a', 'not an', 'not any',
    'not the', 'not consistent with', 'not suggestive of', 'not associated with', 'not related to',
    'not concerned about', 'not worried about', 'not', 'non', 'resolution of', 'nothing',
  ],
  negation_post: [
    'ruled out', 'was ruled out', 'has been ruled out', 'excluded', 'was excluded', 'has been excluded',
    'negative', 'was negative', 'is negative', 'not seen', 'not present', 'not identified', 'not visualised',
    'not visualized', 'not found', 'absent', 'resolved', 'has resolved', 'have resolved', 'now resolved',
    'not detected', 'unremarkable', 'not a concern', 'is fixed', 'was fixed', 'fixed in', 'no longer happens',
    'intact', 'found intact', 'false positive', 'confirmed false positive', 'is not reachable', 'not reachable', 'not exploitable', 'is not exploitable', 'not affected', 'is not affected', 'accounted for', 'all accounted for', 'normal', 'is normal', 'was normal', 'were normal',
  ],
  suspicion_pre: [
    'rule out', 'to rule out', 'to exclude', 'exclude', 'query', 'concern for', 'concerning for',
    'concerned for', 'concern of', 'concerned about', 'worried about', 'worry for', 'worried re',
    'suspected', 'suspect', 'suspicion of', 'suspicion for', 'suspicious for', 'suspicious of',
    'possible', 'possibly', 'probable', 'probably', 'likely', 'presumed', 'presumptive', 'cannot exclude',
    'cannot rule out', 'unable to exclude', 'unable to rule out', 'evaluate for', 'evaluation for',
    'eval for', 'assess for', 'assessment for', 'look for', 'check for', 'investigate for', 'question of',
    'questionable', 'differential includes', 'ddx', 'low suspicion for', 'low suspicion of', 'could be',
    'might be', 'may be', 'may have', 'might have', 'could have', 'think', 'thinks', 'worried',
    'cannot be sure', 'not sure if', 'not sure whether', 'maybe', 'perhaps', 'potential', 'potentially',
  ],
  suspicion_post: [
    'suspected', 'not excluded', 'cannot be excluded', 'not ruled out', 'cannot be ruled out',
    'not yet excluded', 'unlikely', 'possible', 'likely', 'considered', 'queried', 'to be excluded',
  ],
  historical_pre: [
    'history of', 'hx of', 'past history of', 'past medical history of', 'pmh', 'pmhx', 'previous',
    'previously', 'prior', 'old', 'remote', 'chronic', 'longstanding', 'long standing', 'long-standing',
    'in the past',
  ],
  // Someone other than the patient or reporter: scope runs to the end of the sentence.
  experiencer_pre: [
    'family history of', 'family history', 'family hx of', 'family hx', 'fhx', 'fh of', 'mother had', 'father had',
    'sister had', 'brother had', 'mother with', 'father with', 'mother and sister', 'parents had',
  ],
  historical_post: [
    'years ago', 'yrs ago', 'year ago', 'months ago', 'last year', 'in the past', 'previously',
    'as a child', 'in childhood',
  ],
  pseudo: [
    'no longer', 'not only', 'no change', 'no increase', 'no further', 'not necessarily', 'not improving',
    'not improved', 'not resolving', 'not resolved', 'not responding', 'no improvement', 'no relief',
    'not settling', 'not settled', 'gram negative', 'no response to', 'not tolerating', 'prior to',
    'previously well', 'previous well', 'year old', 'years old', 'yr old', 'yrs old', 'month old',
    'months old', 'week old', 'weeks old', 'day old', 'days old', 'hour old', 'hours old', 'not sure',
    'no idea', 'no matter', 'no doubt', 'not just', 'whether or not', 'or not', 'if not', 'not working',
    'not work', 'does not work', 'did not work', 'is not working', 'not loading', 'not starting', 'not settling',
    'not keeping', 'not feeding', 'not moving', 'not passing', 'not rousable', 'not responding to', 'not able',
    'not opening', 'not saving', 'not syncing', 'not opening', 'normal saline', 'normal range',
  ],
  terminate: [
    'but', 'however', 'although', 'though', 'except', 'apart from', 'aside from', 'yet', 'now', 'presents',
    'presenting', 'presented', 'currently', 'which', 'who', 'so', 'because', 'since', 'until', 'whereas',
    'while', 'then', 'today', 'tonight', 'this morning', 'this evening', 'complains', 'complaining',
  ],
  terminate_historical: [
    'new', 'newly', 'acute', 'acutely', 'sudden', 'suddenly', 'worsening', 'worse', 'increasing',
    'recent', 'recently', 'ongoing', 'and now', 'with new', 'hours ago', 'hour ago', 'mins ago',
    'minutes ago', 'yesterday', 'last night', 'on arrival',
  ],
};

const TYPE_OF = {
  negation_pre: { kind: 'neg', dir: 'pre' },
  negation_post: { kind: 'neg', dir: 'post' },
  suspicion_pre: { kind: 'susp', dir: 'pre' },
  suspicion_post: { kind: 'susp', dir: 'post' },
  historical_pre: { kind: 'hist', dir: 'pre' },
  historical_post: { kind: 'hist', dir: 'post' },
  experiencer_pre: { kind: 'hist', dir: 'pre', window: 30 },
  pseudo: { kind: 'pseudo', dir: 'none' },
  terminate: { kind: 'term', dir: 'none' },
  terminate_historical: { kind: 'termh', dir: 'none' },
};

// Cues with a narrower scope than the default window. A bare "not" negates only the next word, so
// "not tender" is negated but "could not find her words" still reads as a symptom ("words" is unscoped).
// Post-cues ("... ruled out", "... was normal") look back only a few words and never past a comma.
export const POST_WINDOW = 4;

export const CUE_WINDOWS = { not: 1, non: 1, nor: 3, nothing: 2, 'false positive': 12, 'confirmed false positive': 12 };

/** Compile cue lists (defaults plus a pack's additions) into token sequences. */
export function compileCues(extra = {}, abbrevs = []) {
  const cues = [];
  for (const [list, meta] of Object.entries(TYPE_OF)) {
    const phrases = [...(DEFAULT_CUES[list] || []), ...(extra[list] || [])];
    const removed = new Set((extra.remove || []).map((s) => s.toLowerCase()));
    const windows = { ...CUE_WINDOWS, ...(extra.windows || {}) };
    for (const phrase of phrases) {
      if (removed.has(phrase.toLowerCase())) continue;
      const words = tokenize(phrase, abbrevs).filter((t) => t.k === 'w').map((t) => t.t);
      if (words.length) cues.push({ words, phrase, ...meta, list, ...(windows[phrase] ? { window: windows[phrase] } : {}) });
    }
  }
  // Longest first, so "not excluded" (suspicion) beats "not" and "excluded" beats nothing.
  cues.sort((a, b) => b.words.length - a.words.length);
  const byFirst = new Map();
  for (const c of cues) {
    const key = c.words[0];
    if (!byFirst.has(key)) byFirst.set(key, []);
    byFirst.get(key).push(c);
  }
  return byFirst;
}

const YEAR_RE = /^(19[5-9]\d|20[0-4]\d)$/;

/**
 * Compute per-token context flags for a token list.
 * @returns {{neg:Uint8Array, susp:Uint8Array, hist:Uint8Array, cueAt:Int32Array, cues:Array}}
 */
export function computeContext(tokens, cueIndex, { window = 6, itemYear = null } = {}) {
  const n = tokens.length;
  const neg = new Uint8Array(n);
  const susp = new Uint8Array(n);
  const hist = new Uint8Array(n);
  const cueAt = new Int32Array(n).fill(-1); // index into cues[] for tokens that are part of a cue
  const cues = [];

  // 1. Find cue occurrences, longest first, left to right, no overlaps.
  for (let i = 0; i < n; i++) {
    const tok = tokens[i];
    if (tok.k === 'q') {
      cues.push({ kind: 'q', a: i, b: i, phrase: '?' });
      cueAt[i] = cues.length - 1;
      continue;
    }
    if (tok.k !== 'w') continue;
    const candidates = cueIndex.get(tok.t);
    let found = null;
    if (candidates) {
      for (const c of candidates) {
        let ok = true;
        for (let k = 0; k < c.words.length; k++) {
          const t = tokens[i + k];
          if (!t || t.k !== 'w' || t.t !== c.words[k]) {
            ok = false;
            break;
          }
          // A cue cannot span two different abbreviations or an abbreviation and a plain word partially.
        }
        if (ok) {
          found = c;
          break;
        }
      }
    }
    if (!found && YEAR_RE.test(tok.t) && (itemYear === null || Number(tok.t) < itemYear)) {
      found = { kind: 'hist', dir: 'post', words: [tok.t], phrase: tok.t, list: 'year' };
    }
    if (found) {
      cues.push({ kind: found.kind, dir: found.dir, a: i, b: i + found.words.length - 1, phrase: found.phrase, list: found.list, window: found.window });
      for (let k = i; k < i + found.words.length; k++) cueAt[k] = cues.length - 1;
      i += found.words.length - 1;
    }
  }

  // soft: also stop at commas, colons and brackets (post-cues, history and "?" scopes stay local).
  const isStop = (idx, kind, self, soft) => {
    const t = tokens[idx];
    if (t.k === 'b' || t.k === 'q') return true;
    if (t.k === 'c') return soft;
    const c = cueAt[idx];
    if (c >= 0 && c !== self) {
      const ck = cues[c].kind;
      if (ck === 'term') return true;
      if (ck === 'termh') return kind === 'hist';
      return true; // another cue starts its own scope
    }
    return false;
  };

  const mark = (arr, from, dir, kind, self, limit = window, soft = false) => {
    let count = 0;
    for (let j = from; j >= 0 && j < n; j += dir) {
      if (isStop(j, kind, self, soft)) break;
      if (tokens[j].k !== 'w') continue;
      // Tokens of one abbreviation expansion count as one word.
      if (!(j !== from && tokens[j - dir] && tokens[j - dir].s === tokens[j].s && tokens[j].abbr)) count++;
      if (count > limit) break;
      arr[j] = 1;
    }
  };

  // 2. Apply scopes.
  cues.forEach((c, idx) => {
    if (c.kind === 'q') {
      const q = tokens[c.a];
      const prev = tokens[c.a - 1];
      const next = tokens[c.a + 1];
      const attachedPrev = !q.gapBefore && prev && prev.k === 'w';
      const attachedNext = !q.gapAfter && next && next.k === 'w';
      if (attachedNext || (!attachedPrev && next && next.k === 'w')) mark(susp, c.a + 1, 1, 'susp', idx, 4, true);
      if (attachedPrev || (!attachedNext && prev && prev.k === 'w' && (!next || next.k !== 'w'))) {
        mark(susp, c.a - 1, -1, 'susp', idx, 4, true);
      }
      return;
    }
    const arr = c.kind === 'neg' ? neg : c.kind === 'susp' ? susp : c.kind === 'hist' ? hist : null;
    if (!arr) return;
    // Cues with a long configured window (experiencer, "false positive") run to the sentence end.
    const sentence = c.list === 'experiencer_pre' || (c.window || 0) >= 10;
    if (c.dir === 'pre') mark(arr, c.b + 1, 1, c.kind, idx, c.window || window, !sentence);
    else if (c.dir === 'post') mark(arr, c.a - 1, -1, c.kind, idx, c.list === 'year' ? 4 : c.window || POST_WINDOW, !sentence);
  });

  return { neg, susp, hist, cueAt, cues };
}

/**
 * Classify a token range [a, b] of a match. Suspicion wins (any suspected word makes the mention
 * suspected). A mention is negated only when every word in it is inside a negation scope, and
 * historical only when every word is historical or negated: partial scopes leave it affirmed, which
 * errs towards flagging.
 */
export function classifyRange(ctx, a, b, tokens = null) {
  for (let i = a; i <= b; i++) if (ctx.susp[i]) return 'suspected';
  let allNeg = true;
  let allHist = true;
  for (let i = a; i <= b; i++) {
    if (tokens && tokens[i].k !== 'w') continue;
    if (!ctx.neg[i]) allNeg = false;
    if (!ctx.hist[i] && !ctx.neg[i]) allHist = false;
  }
  if (allNeg) return 'negated';
  if (allHist) return 'historical';
  return 'affirmed';
}

export { normalizeWord };
