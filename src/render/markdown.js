// board.md: for the terminal and for an agent to read.
import { escapeMd, parseTime, clip, safeUrl } from '../util.js';
import { clockLines, slaText, floorText, waitText, displayTime, uniqueQuotes, splitRules, maskingSummary, MASKED_NOTE, NO_RULE_HEADING, NO_RULE_NOTE, FOOTER_NOTE } from './common.js';

function quoteList(evidence) {
  return uniqueQuotes(evidence)
    .map((e) => `"${escapeMd(e.text)}"${e.context === 'suspected' ? ' (suspected)' : ''}${e.fuzzy ? ' (spelling-tolerant)' : ''} [${e.field}]`)
    .join(', ');
}

export function renderMarkdown(result, { pack, newIds = null } = {}) {
  const nowMs = parseTime(result.now);
  const L = [];
  const c = result.counts;
  const tiers = result.pack.tiers;
  const baseline = tiers[tiers.length - 1].id;
  L.push(`# Discuss First: ${escapeMd(result.pack.title || result.pack.name)}`);
  L.push('');
  if (result.pack.mode === 'research') {
    L.push(`> **Research mode.** ${pack.banner}`);
    L.push('');
  }
  const meta = [`Pack \`${result.pack.name}\` ${result.pack.version}`];
  if (result.input) meta.push(`Input: \`${result.input}\``);
  meta.push(`Items: ${c.total}`);
  if (result.now) meta.push(`As of: ${displayTime(result.now)}`);
  meta.push(`Engine: urgent-first ${result.engine.version}`);
  L.push(meta.join(' · '));
  L.push('');
  const tierCounts = tiers.filter((t) => t.id !== baseline).map((t) => `${t.id} ${t.name}: ${c.by_tier[t.id]}`).join(' · ');
  let summary = `**Discuss First: ${c.flagged}** (${tierCounts}) · **${NO_RULE_HEADING}: ${c.unmatched}**`;
  if (result.annotations) summary += ` · Annotations: ${result.annotations.applied} raised a tier, ${result.annotations.accepted} accepted, ${result.annotations.rejected} rejected`;
  if (newIds) summary += ` · New since last look: ${newIds.size}`;
  L.push(summary);
  L.push('');
  const ms = maskingSummary(result);
  if (ms) {
    L.push(ms.replace(`Shown dimmed as ${MASKED_NOTE}.`, `They are ${MASKED_NOTE}; \`urgent-first explain <run> --item ID\` lists them.`));
    L.push('');
  }
  L.push(`## Discuss First (${c.flagged})`);
  L.push('');
  if (!c.flagged) {
    L.push('No item matched a rule and no priority field set a raised floor. See the next section.');
    L.push('');
  }
  for (const t of tiers) {
    if (t.id === baseline) continue;
    const rows = result.items.filter((r) => r.tier === t.id);
    if (!rows.length) continue;
    L.push(`### ${t.id} · ${t.name} (${rows.length})`);
    L.push('');
    for (const r of rows) {
      const bits = [];
      if (r.priority) bits.push(`priority ${escapeMd(r.priority)}${r.floor.unknown_priority !== undefined ? ' (not in the pack floor map: sets no floor)' : ''}`);
      if (r.raised) bits.push(`raised from ${r.floor.tier} to ${r.tier}`);
      if (r.location) bits.push(escapeMd(r.location));
      const w = waitText(r, nowMs);
      if (w) bits.push(`waiting ${w}`);
      const isNew = newIds && newIds.has(r.id) ? ' **NEW**' : '';
      const title = safeUrl(r.url) ? `[${escapeMd(r.title || '(no title)')}](${safeUrl(r.url)})` : escapeMd(r.title || '(no title)');
      L.push(`${r.position}. **${escapeMd(r.id)}** · ${title}${isNew}${bits.length ? ` · ${bits.join(' · ')}` : ''}`);
      const { main, extra } = splitRules(r, tiers.map((x) => x.id));
      for (const rule of main) {
        const src = safeUrl(rule.source?.url) ? ` ([source](${safeUrl(rule.source.url)}))` : '';
        L.push(`   - ${rule.id} (${rule.tier}) ${escapeMd(rule.title)}${src}: ${quoteList(rule.evidence)}${rule.linked ? ` (${rule.linked.map((l) => `${escapeMd(l.id)} is ${l.tier} by ${escapeMd(l.by.join(', ') || 'its floor')}`).join('; ')})` : ''}`);
      }
      if (extra.length) L.push(`   - Also matched: ${extra.map((rule) => `${rule.id} (${rule.tier}) ${quoteList(rule.evidence.slice(0, 2))}`).join('; ')}`);
      for (const a of r.annotations) {
        L.push(`   - Annotation ${a.rule_id} (${a.raise_to}${a.applied ? ', raised' : ', no change'}): ${escapeMd(a.reason)} Quotes: ${a.quotes.map((q) => `"${escapeMd(q)}"`).join(', ')}`);
      }
      for (const line of clockLines(r, nowMs)) L.push(`   - Clock: ${escapeMd(line)}`);
      const sla = slaText(r, nowMs);
      if (sla) L.push(`   - Turnaround: ${sla}`);
      if (r.floor.reasons.length) L.push(`   - Floor: ${escapeMd(floorText(r))}`);
      if (r.masked && r.masked.length) L.push(`   - Masked: ${r.masked.length} line(s) of ${MASKED_NOTE}`);
    }
    L.push('');
  }
  L.push(`## ${NO_RULE_HEADING} (${c.unmatched})`);
  L.push('');
  L.push(NO_RULE_NOTE);
  L.push('');
  for (const r of result.items.filter((x) => x.tier === baseline)) {
    const bits = [];
    if (r.priority) bits.push(`priority ${escapeMd(r.priority)}${r.floor.unknown_priority !== undefined ? ' (not in the pack floor map: sets no floor)' : ''}`);
    if (r.location) bits.push(escapeMd(r.location));
    const w = waitText(r, nowMs);
    if (w) bits.push(`waiting ${w}`);
    if (r.suppressed.length) bits.push(`did not count: ${r.suppressed.slice(0, 3).map((s) => `"${escapeMd(clip(s.text, 40))}" (${s.context})`).join(', ')}`);
    const isNew = newIds && newIds.has(r.id) ? ' **NEW**' : '';
    const title = safeUrl(r.url) ? `[${escapeMd(r.title || '(no title)')}](${safeUrl(r.url)})` : escapeMd(r.title || '(no title)');
    L.push(`${r.position}. ${escapeMd(r.id)} · ${title}${isNew}${bits.length ? ` · ${bits.join(' · ')}` : ''}`);
  }
  L.push('');
  if (result.annotations && result.annotations.rejected_list.length) {
    L.push(`## Rejected Annotations (${result.annotations.rejected_list.length})`);
    L.push('');
    for (const x of result.annotations.rejected_list) L.push(`- Line ${x.line} (${escapeMd(x.item_id ?? '?')}): ${escapeMd(x.reasons.join('; '))}`);
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push(FOOTER_NOTE);
  if (result.pack.mode === 'research') {
    L.push('');
    L.push(`> ${pack.banner}`);
  }
  L.push('');
  return L.join('\n');
}
