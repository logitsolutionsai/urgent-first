// Shadow mode: the expert keeps working as usual and records their own first picks.
// We compare the picks with the board and keep a log in the run folder, so agreement can be followed
// over time (copy or append shadow.jsonl files across runs to build a longer history).
import fs from 'node:fs';
import path from 'node:path';
import { writeInside, readJsonl } from './util.js';
import { pct } from './stats.js';

export function recordShadow(dir, result, picks, { note = null, at = new Date().toISOString() } = {}) {
  const byId = new Map(result.items.map((r) => [r.id, r]));
  const k = picks.length;
  const top = result.pack.tiers[0].id;
  const baseline = result.pack.tiers[result.pack.tiers.length - 1].id;
  const boardTop = result.items.slice(0, k).map((r) => r.id);
  const known = picks.filter((id) => byId.has(id));
  const entry = {
    at,
    run_now: result.now,
    pack: result.pack.name,
    picks,
    k,
    note,
    unknown_ids: picks.filter((id) => !byId.has(id)),
    overlap_at_k: known.filter((id) => boardTop.includes(id)).length,
    picks_flagged: known.filter((id) => byId.get(id).tier !== baseline).length,
    picks_top_tier: known.filter((id) => byId.get(id).tier === top).length,
    top_tier_not_picked: result.items.filter((r) => r.tier === top && !picks.includes(r.id)).map((r) => r.id),
    picked_not_flagged: known.filter((id) => byId.get(id).tier === baseline),
    board_top_k: boardTop,
  };
  const file = path.join(dir, 'shadow.jsonl');
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  writeInside(dir, 'shadow.jsonl', prev + JSON.stringify(entry) + '\n');
  return entry;
}

export function shadowReport(dir) {
  const file = path.join(dir, 'shadow.jsonl');
  if (!fs.existsSync(file)) return 'No shadow picks recorded yet.';
  const rows = readJsonl(file);
  const L = ['Shadow log (expert first picks vs the board):', '', '| When | Picks | Top-k overlap | Picks in Discuss First | Picked but unmatched |', '| --- | ---: | ---: | ---: | --- |'];
  let sumK = 0;
  let sumOverlap = 0;
  let sumFlagged = 0;
  for (const r of rows) {
    sumK += r.k;
    sumOverlap += r.overlap_at_k;
    sumFlagged += r.picks_flagged;
    L.push(`| ${r.at} | ${r.k} | ${r.overlap_at_k}/${r.k} | ${r.picks_flagged}/${r.k} | ${r.picked_not_flagged.join(', ') || 'none'} |`);
  }
  L.push('');
  L.push(`Cumulative over ${rows.length} session(s): top-k overlap ${sumOverlap}/${sumK} (${pct(sumK ? sumOverlap / sumK : null)}), picks in Discuss First ${sumFlagged}/${sumK} (${pct(sumK ? sumFlagged / sumK : null)}).`);
  L.push('Agreement is not accuracy: it shows where the pack and the expert differ, so the rules can be discussed.');
  return L.join('\n');
}
