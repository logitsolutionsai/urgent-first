// Release Pulse and digest pages: Markdown (the full record, for terminals and agents) and offline HTML.
// The HTML reuses board.html's styles and its one inline script (fluid.js + motion.js) unchanged, so it has the
// same Content-Security-Policy: no network, scripts only by hash, no unsafe-inline script. Ink palette, one
// accent for links and focus; tiers are L3 and L2 chips, never a hue. All item text is escaped; links are
// http(s) only and open with rel="noopener noreferrer".
import { escapeHtml, escapeMd, safeUrl, clip } from '../util.js';
import { CSS, SCRIPT, SCRIPT_HASH } from '../render/html.js';

const EXTRA_CSS = `
.prov{display:block;margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.74rem;color:var(--muted);overflow-wrap:anywhere}
.pane{border-top:1px solid var(--line);margin-top:40px}
.pane>h2{margin-top:24px}
.warn{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.warn>li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 16px;font-size:.9rem}
.warn code{color:var(--ink)}
.members{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:8px}
.members>li{border-top:1px solid var(--line);padding-top:8px;font-size:.9rem;overflow-wrap:anywhere}
.l0note{border:1px dashed var(--line-strong);border-radius:10px;padding:12px 16px;color:var(--muted);font-size:.9rem;margin:12px 0 0}
`;

function tierClass(tiers, id) {
  const i = tiers.findIndex((t) => t.id === id);
  return i < 0 ? 't3' : `t${Math.min(i + 1, 3)}`;
}

function link(url, inner, cls = '') {
  const href = safeUrl(url);
  return href ? `<a${cls ? ` class="${cls}"` : ''} href="${escapeHtml(href)}" rel="noopener noreferrer">${inner}</a>` : `<span${cls ? ` class="${cls}"` : ''}>${inner}</span>`;
}

function provLine(e) {
  return `${e.field}[${e.start}:${e.end}] · ${e.evidenceId} · snapshot ${e.snapshotId.slice(7, 19)}`;
}

/** One entry per rule and exact quote; every place it occurs keeps its own provenance. */
export function groupEvidence(evidence) {
  const groups = [];
  const by = new Map();
  for (const e of evidence) {
    const k = `${e.ruleId}\u0000${e.text}`;
    if (!by.has(k)) {
      by.set(k, { ruleId: e.ruleId, text: e.text, context: e.context, places: [] });
      groups.push(by.get(k));
    }
    by.get(k).places.push(e);
  }
  return groups;
}

const MAX_GROUPS_HTML = 4;

function evidenceHtml(x) {
  if (x.withheld) return '<li><span class="kind">Withheld</span> security report: no title or quote in a public export</li>';
  const groups = groupEvidence(x.evidence);
  const shown = groups.slice(0, MAX_GROUPS_HTML).map((g) => `<li data-rule="${escapeHtml(g.ruleId)}"><span class="rid">${escapeHtml(g.ruleId)}</span><span class="q">“${escapeHtml(g.text)}”</span>${g.context === 'suspected' ? ' <span class="why">(suspected)</span>' : ''}${g.places.map((e) => `<span class="prov">${escapeHtml(provLine(e))}</span>`).join('')}</li>`);
  if (groups.length > MAX_GROUPS_HTML) shown.push(`<li class="why">${groups.length - MAX_GROUPS_HTML} more quote(s), with provenance, in the Markdown and JSON files</li>`);
  return shown.join('');
}

function cardHtml(x, tiers, { meta = [], extra = '' } = {}) {
  const cls = tierClass(tiers, x.tier);
  const metaHtml = meta.length ? `<ul class="meta">${meta.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : '';
  return `<li class="card ${cls}" data-id="${escapeHtml(x.id)}" data-tier="${escapeHtml(x.tier)}"><div class="head"><div class="hl"><span class="badge ${cls}">${escapeHtml(x.tier)}</span><span class="id">${escapeHtml(x.localId)}</span>${link(x.url, escapeHtml(x.title || '(no title)'), 'title')}</div></div>${metaHtml}<ul class="flags">${evidenceHtml(x)}${extra}</ul></li>`;
}

function entryMeta(x, pulse) {
  const m = [];
  if (x.isNew) m.push('new since the previous snapshot');
  if (x.reportedAfterRelease && pulse.release) m.push(`reported after release ${pulse.release.tag}`);
  if (x.state && x.state !== 'open') m.push(`state ${x.state}`);
  return m;
}

function page(title, body, data) {
  const H = [];
  H.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  H.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  H.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; img-src data:; base-uri 'none'; form-action 'none'">`);
  H.push('<meta name="color-scheme" content="light dark">');
  H.push(`<title>${escapeHtml(title)}</title><style>${CSS}${EXTRA_CSS}</style></head><body>`);
  H.push(body);
  H.push(`<script type="application/json" id="uf-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  H.push(`<script>${SCRIPT}</script>`);
  H.push('</body></html>');
  return H.join('\n');
}

function chipBar(chips) {
  return `<div id="bar-sentinel" aria-hidden="true"></div><nav class="bar" id="bar" aria-label="Counts"><div class="wrap"><ul class="summary">${chips.map(([cls, href, label, n, key]) => `<li data-count="${key}">${href && n ? `<a class="chip${cls}" href="${href}">` : `<span class="chip${cls}">`}${escapeHtml(label)} <b>${n}</b>${href && n ? '</a>' : '</span>'}</li>`).join('')}</ul></div></nav>`;
}

function warningsHtml(warnings, id = 'warnings') {
  if (!warnings.length) return '';
  return `<section id="${id}" aria-labelledby="h-${id}"><h2 id="h-${id}">Data Warnings (${warnings.length})</h2><ul class="warn">${warnings.map((w) => `<li data-warning="${escapeHtml(w.code)}"><code>${escapeHtml(w.code)}</code> · ${escapeHtml(w.severity)}<br>${escapeHtml(w.message)}</li>`).join('')}</ul></section>`;
}

function bannerHtml(pulse) {
  const B = [];
  if (pulse.visibility && pulse.visibility.public) B.push(`<div class="banner" role="note" id="public-banner"><strong>Public export</strong>${escapeHtml(pulse.visibility.note)}</div>`);
  if (pulse.visibility && pulse.visibility.data === 'real') B.push('<div class="banner" role="note" id="real-data-banner"><strong>Real repository data</strong>This page was exported from real issues with --allow-real-public-export. Check every title and quote before you share it.</div>');
  if (pulse.status === 'partial') B.push('<div class="banner" role="note" id="partial-banner"><strong>Partial data</strong>At least one snapshot stopped early. Counts cover only what was collected.</div>');
  if (pulse.configChanged) B.push('<div class="banner" role="note" id="config-banner"><strong>Configuration changed</strong>The pack or engine differs between the snapshots, so tier changes may come from the rules rather than from the issues.</div>');
  return B.join('');
}

function causeText(c) {
  const one = (x) => {
    switch (x.kind) {
      case 'labels_changed':
        return `labels changed (${(x.before || []).join(', ') || 'none'} -> ${(x.after || []).join(', ') || 'none'})`;
      case 'content_changed':
        return 'the item text changed';
      case 'priority_changed':
        return `priority changed (${x.before} -> ${x.after})`;
      case 'linked_issue_changed':
        return 'the linked issue changed';
      case 'pack_changed':
        return 'the pack changed (config_changed)';
      case 'other_items_changed':
        return x.note;
      default:
        return x.kind;
    }
  };
  const parts = c.causes.map(one);
  const rules = [c.rulesGained.length ? `rules now matching: ${c.rulesGained.join(', ')}` : null, c.rulesLost.length ? `rules no longer matching: ${c.rulesLost.join(', ')}` : null].filter(Boolean);
  return [...parts, ...rules].join('; ');
}

// ---------------------------------------------------------------------------------------------------------
// Pulse

export function renderPulseMarkdown(p) {
  const L = [];
  const S = p.sections;
  const repo = p.newer.source.repository || p.newer.source.input || p.newer.source.kind;
  L.push(`# Release Pulse: ${escapeMd(repo)}`);
  L.push('');
  L.push(`Older snapshot \`${p.older.snapshotId.slice(0, 19)}\` (${p.older.items} items${p.older.release ? `, latest release ${p.older.release.tag}` : ''}) · newer snapshot \`${p.newer.snapshotId.slice(0, 19)}\` (${p.newer.items} items${p.newer.release ? `, latest release ${p.newer.release.tag}` : ''}) · status ${p.status}`);
  L.push('');
  if (p.visibility.public) L.push(`> **Public export.** ${p.visibility.note}`, '');
  if (p.visibility.data === 'real') L.push('> **Real repository data.** Check every title and quote before you share it.', '');
  if (p.status === 'partial') L.push('> **Partial data.** At least one snapshot stopped early. Counts cover only what was collected.', '');
  if (p.configChanged) L.push('> **Configuration changed.** The pack or engine differs, so tier changes may come from the rules rather than from the issues.', '');
  if (p.release) L.push(`Latest release from the GitHub API: **${escapeMd(p.release.tag)}**, published ${p.release.publishedAt}${p.release.previousTag && p.release.previousTag !== p.release.tag ? ` (the older snapshot saw ${escapeMd(p.release.previousTag)})` : ''}. ${p.release.reportedAfter} report(s) in the newer snapshot were filed after it. Reported after release is an order of timestamps, not a cause.`, '');
  L.push(`New since the previous snapshot: ${p.counts.new} · not in the newer snapshot: ${p.counts.notInNewer} · tier changes: ${p.counts.tierChanges} · resolved: ${p.resolutionsAsserted ? p.counts.resolved : 'not asserted (see Data Warnings)'}`);
  L.push('');
  const entry = (x, extra = []) => {
    const meta = [...entryMeta(x, p), ...extra];
    L.push(`- **${x.tier}** ${escapeMd(x.localId)} ${x.url && safeUrl(x.url) ? `[${escapeMd(x.title)}](${safeUrl(x.url)})` : escapeMd(x.title)}${meta.length ? ` · ${meta.join(' · ')}` : ''}`);
    if (x.withheld) L.push('  - security report withheld from the public export');
    for (const g of groupEvidence(x.evidence)) L.push(`  - ${g.ruleId}: "${escapeMd(g.text)}"${g.context === 'suspected' ? ' (suspected)' : ''} — ${g.places.map(provLine).join('; ')}`);
  };
  L.push(`## 1. Newly Flagged T1 And T2 (${S.newlyFlagged.length})`, '');
  if (!S.newlyFlagged.length) L.push('None.');
  S.newlyFlagged.forEach((x) => entry(x));
  L.push('', `## 2. Changed Tier (${S.tierChanges.length})`, '');
  if (!S.tierChanges.length) L.push('None.');
  for (const x of S.tierChanges) entry(x, [`${x.before} -> ${x.after}${x.direction === 'cross_run_downgrade' ? ' (cross-run downgrade, not a lowering within a run)' : ''}`, `because ${causeText(x)}`]);
  L.push('', `## 3. Still Open From Before (${S.unresolvedPrior.length})`, '');
  if (!S.unresolvedPrior.length) L.push('None.');
  for (const x of S.unresolvedPrior) entry(x, [`flagged ${x.previousTier} in the older snapshot`]);
  if (S.priorFlaggedNotInNewer.length) {
    L.push('', 'Flagged before and not in the newer snapshot (status unknown, not called resolved):', '');
    for (const x of S.priorFlaggedNotInNewer) entry(x, ['not in the newer snapshot']);
  }
  L.push('', `## 4. Related Reports With New Members (${S.clustersWithNewMembers.length})`, '');
  L.push('Candidates only: they may describe the same problem. Every member keeps its own tier and place on the board. Scores rank candidates; they are not probabilities.', '');
  if (!S.clustersWithNewMembers.length) L.push('None.');
  for (const c of S.clustersWithNewMembers) {
    entry(c.anchor, ['cluster anchor']);
    for (const m of c.members) entry(m, [`${m.linkType === 'possible_duplicate' ? 'may describe the same problem' : 'same error signature'} as ${c.anchor.localId}`, `score ${m.score}`, `shared: ${m.sharedFeatures.join(', ')}`]);
  }
  L.push('', '## 5. Misses Against Labels', '');
  if (!S.goldMisses) L.push('No labelled evaluation set was given, so no misses are counted.');
  else {
    L.push(`${S.goldMisses.missed.length} of ${S.goldMisses.goldTopTier} labelled top-tier item(s) are not top tier on the board (${S.goldMisses.labelledItems} labelled item(s)). ${S.goldMisses.note}`, '');
    for (const x of S.goldMisses.missed) entry(x, [`labelled ${x.goldTier}`]);
  }
  if (p.warnings.length) {
    L.push('', `## Data Warnings (${p.warnings.length})`, '');
    for (const w of p.warnings) L.push(`- \`${w.code}\` (${w.severity}): ${escapeMd(w.message)}`);
  }
  L.push('', `Pulse ${p.pulseId}. Generated by urgent-first ${p.engineVersion}. Read-only: nothing was changed on GitHub.`);
  return L.join('\n') + '\n';
}

export function renderPulseHtml(p) {
  const S = p.sections;
  const tiers = [{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }];
  const repo = p.newer.source.repository || p.newer.source.input || p.newer.source.kind;
  const B = [];
  B.push(`<header class="wrap intro"><h1>Release Pulse</h1><p class="sub">${escapeHtml(repo)} · older snapshot <code>${escapeHtml(p.older.snapshotId.slice(0, 19))}</code>${p.older.release ? ` (${escapeHtml(p.older.release.tag)})` : ''} · newer snapshot <code>${escapeHtml(p.newer.snapshotId.slice(0, 19))}</code>${p.newer.release ? ` (${escapeHtml(p.newer.release.tag)})` : ''} · status ${escapeHtml(p.status)}</p>${bannerHtml(p)}</header>`);
  B.push(chipBar([['', '#newly-flagged', 'Newly flagged', S.newlyFlagged.length, 'newly-flagged'], ['', '#tier-changes', 'Changed tier', S.tierChanges.length, 'tier-changes'], ['', '#still-open', 'Still open', S.unresolvedPrior.length, 'still-open'], ['', '#related', 'Related with new members', S.clustersWithNewMembers.length, 'related'], ['', null, 'New since previous', p.counts.new, 'new']]));
  B.push('<div class="wrap"><main>');
  if (p.release) B.push(`<p class="note" id="release">Latest release from the GitHub API: <b>${escapeHtml(p.release.tag)}</b>, published ${escapeHtml(p.release.publishedAt)}. ${p.release.reportedAfter} report(s) were filed after it. Reported after release is an order of timestamps, not a cause.</p>`);
  const sec = (id, title, items, inner) => B.push(`<section id="${id}" aria-labelledby="h-${id}"><h2 id="h-${id}">${escapeHtml(title)} (${items})</h2>${inner}</section>`);
  sec('newly-flagged', '1. Newly Flagged T1 And T2', S.newlyFlagged.length, S.newlyFlagged.length ? `<ol class="cards">${S.newlyFlagged.map((x) => cardHtml(x, tiers, { meta: entryMeta(x, p) })).join('')}</ol>` : '<p class="note">None.</p>');
  sec('tier-changes', '2. Changed Tier', S.tierChanges.length, S.tierChanges.length ? `<ol class="cards">${S.tierChanges.map((x) => cardHtml(x, tiers, { meta: [...entryMeta(x, p), `${x.before} -> ${x.after}${x.direction === 'cross_run_downgrade' ? ' (cross-run downgrade)' : ''}`], extra: `<li><span class="kind">Because</span> ${escapeHtml(causeText(x))}</li>` })).join('')}</ol>` : '<p class="note">None.</p>');
  const missing = S.priorFlaggedNotInNewer.length ? `<p class="l0note">Flagged before and not in the newer snapshot, status unknown and not called resolved: ${S.priorFlaggedNotInNewer.map((x) => escapeHtml(`${x.localId} ${x.title}`)).join(' · ')}</p>` : '';
  sec('still-open', '3. Still Open From Before', S.unresolvedPrior.length, (S.unresolvedPrior.length ? `<ol class="cards">${S.unresolvedPrior.map((x) => cardHtml(x, tiers, { meta: [...entryMeta(x, p), `flagged ${x.previousTier} in the older snapshot`] })).join('')}</ol>` : '<p class="note">None.</p>') + missing);
  const clusters = S.clustersWithNewMembers.map((c) => cardHtml(c.anchor, tiers, { meta: [...entryMeta(c.anchor, p), 'cluster anchor'], extra: `<li><span class="kind">May describe the same problem</span><ul class="members">${c.members.map((m) => `<li data-member="${escapeHtml(m.id)}"><span class="badge ${tierClass(tiers, m.tier)}">${escapeHtml(m.tier)}</span> <span class="id">${escapeHtml(m.localId)}</span> ${link(m.url, escapeHtml(m.title))}<br><span class="why">${escapeHtml(m.linkType === 'possible_duplicate' ? 'similar wording' : 'same error signature')} · score ${m.score} (ranking signal, not a probability) · shared: ${escapeHtml(m.sharedFeatures.join(', '))}${m.reportedAfterRelease && p.release ? ` · reported after release ${escapeHtml(p.release.tag)}` : ''}</span></li>`).join('')}</ul></li>` })).join('');
  sec('related', '4. Related Reports With New Members', S.clustersWithNewMembers.length, `<p class="note">Candidates only. Every member keeps its own tier and place on the board.</p>${clusters ? `<ol class="cards">${clusters}</ol>` : '<p class="note">None.</p>'}`);
  sec('misses', '5. Misses Against Labels', S.goldMisses ? S.goldMisses.missed.length : 0, S.goldMisses ? `<p class="note">${S.goldMisses.missed.length} of ${S.goldMisses.goldTopTier} labelled top-tier item(s) are not top tier. ${escapeHtml(S.goldMisses.note)}</p>${S.goldMisses.missed.length ? `<ol class="cards">${S.goldMisses.missed.map((x) => cardHtml(x, tiers, { meta: [`labelled ${x.goldTier}`] })).join('')}</ol>` : ''}` : '<p class="l0note">No labelled evaluation set was given, so no misses are counted.</p>');
  B.push(warningsHtml(p.warnings));
  B.push(`</main><footer><p>Read-only: nothing was changed on GitHub. Every quote is an exact substring of its item, with its field, offsets, evidence id and snapshot.</p><p>Pulse ${escapeHtml(p.pulseId.slice(0, 19))}. Generated by urgent-first ${escapeHtml(p.engineVersion)}.</p></footer></div>`);
  return page(`Release Pulse: ${repo}`, B.join('\n'), { kind: 'urgent-first-pulse', status: p.status, counts: p.counts, public: Boolean(p.visibility.public) });
}

// ---------------------------------------------------------------------------------------------------------
// Digest: three panes. Discuss First (board order, quotes), Related Reports (typed links only, every member
// visible), Since Last Snapshot (actual changes and data warnings, or a note that there is no previous one).

export function renderDigestMarkdown(d) {
  const L = [];
  const repo = d.source.repository || d.source.input || d.source.kind;
  L.push(`# Maintainer Digest: ${escapeMd(repo)}`, '');
  L.push(`Snapshot \`${d.snapshotId.slice(0, 19)}\` · pack \`${d.pack.id}\` ${d.pack.version} · status ${d.status} · ${d.counts.total} items, Discuss First ${d.counts.flagged}, No rule matched ${d.counts.unmatched}`, '');
  if (d.status === 'partial') L.push('> **Partial data.** The collection stopped early. Totals cover only what was collected.', '');
  L.push(`## Discuss First (${d.discussFirst.length})`, '');
  if (!d.discussFirst.length) L.push('No item matched a rule.');
  for (const x of d.discussFirst) {
    L.push(`- **${x.tier}** ${escapeMd(x.localId)} ${x.url && safeUrl(x.url) ? `[${escapeMd(x.title)}](${safeUrl(x.url)})` : escapeMd(x.title)}${x.reportedAfterRelease && d.release ? ` · reported after release ${d.release.tag}` : ''}${x.related.length ? ` · related: ${x.related.join(', ')}` : ''}`);
    for (const g of groupEvidence(x.evidence)) L.push(`  - ${g.ruleId}: "${escapeMd(g.text)}" — ${g.places.map(provLine).join('; ')}`);
  }
  L.push('', `${d.counts.unmatched} item(s) had no rule matched. That does not mean they are not urgent; they stay in their original order on the board.`, '');
  L.push(`## Related Reports (${d.related.direct.length + d.related.clusters.length})`, '');
  L.push('Direct links quote the reference. Candidates may describe the same problem; no member is hidden or merged.', '');
  for (const e of d.related.direct) L.push(`- ${e.type}: ${escapeMd(e.fromLocal)} -> ${escapeMd(e.toLocal)} (quote "${escapeMd(e.quote)}")`);
  for (const c of d.related.clusters) L.push(`- candidates around ${escapeMd(c.anchorLocal)}: ${c.members.map((m) => `${escapeMd(m.localId)} (${m.type === 'possible_duplicate' ? 'similar wording' : 'same error signature'}, score ${m.score})`).join('; ')}`);
  if (!d.related.direct.length && !d.related.clusters.length) L.push('None.');
  L.push('', '## Since Last Snapshot', '');
  if (!d.since) L.push('No previous snapshot was given (use --previous DIR).');
  else {
    L.push(`Compared with \`${d.since.older.snapshotId.slice(0, 19)}\`: ${d.since.counts.new} new, ${d.since.counts.notInNewer} not in this snapshot, ${d.since.counts.tierChanges} tier change(s), ${d.since.counts.newlyFlagged} newly flagged.`);
    for (const x of d.since.sections.newlyFlagged) L.push(`- newly flagged ${x.tier} ${escapeMd(x.localId)} ${escapeMd(x.title)}${x.reportedAfterRelease && d.release ? ` (reported after release ${d.release.tag})` : ''}`);
    for (const x of d.since.sections.tierChanges) L.push(`- ${escapeMd(x.localId)} ${x.before} -> ${x.after} because ${causeText(x)}`);
  }
  const warnings = [...d.warnings, ...(d.since ? d.since.warnings : [])];
  if (warnings.length) {
    L.push('', `## Data Warnings (${warnings.length})`, '');
    for (const w of warnings) L.push(`- \`${w.code}\` (${w.severity}): ${escapeMd(w.message)}`);
  }
  L.push('', `Generated by urgent-first ${d.engineVersion}. Read-only: nothing was changed on GitHub.`);
  return L.join('\n') + '\n';
}

export function renderDigestHtml(d) {
  const tiers = d.pack.tiers;
  const repo = d.source.repository || d.source.input || d.source.kind;
  const B = [];
  B.push(`<header class="wrap intro"><h1>Maintainer Digest</h1><p class="sub">${escapeHtml(repo)} · snapshot <code>${escapeHtml(d.snapshotId.slice(0, 19))}</code> · pack <code>${escapeHtml(d.pack.id)}</code> ${escapeHtml(d.pack.version)} · status ${escapeHtml(d.status)}</p>${d.status === 'partial' ? '<div class="banner" role="note" id="partial-banner"><strong>Partial data</strong>The collection stopped early. Totals cover only what was collected.</div>' : ''}</header>`);
  B.push(chipBar([['', '#discuss-first', 'Discuss First', d.discussFirst.length, 'flagged'], ['', '#related', 'Related reports', d.related.direct.length + d.related.clusters.length, 'related'], ['', '#since', 'Since last snapshot', d.since ? d.since.counts.new + d.since.counts.tierChanges : 0, 'since'], [' l0', null, 'No rule matched', d.counts.unmatched, 'unmatched']]));
  B.push('<div class="wrap"><main>');
  const cards = d.discussFirst.map((x) => cardHtml(x, tiers, { meta: [...(x.reportedAfterRelease && d.release ? [`reported after release ${d.release.tag}`] : []), ...(x.related.length ? [`related: ${x.related.join(', ')}`] : [])] })).join('');
  B.push(`<section id="discuss-first" class="pane" aria-labelledby="h-df"><h2 id="h-df">Discuss First (${d.discussFirst.length})</h2>${cards ? `<ol class="cards">${cards}</ol>` : '<p class="note">No item matched a rule.</p>'}<p class="l0note">${d.counts.unmatched} item(s) had no rule matched. That does not mean they are not urgent; they stay in their original order on the board.</p></section>`);
  const direct = d.related.direct.map((e) => `<li data-edge="${escapeHtml(e.id)}"><span class="kind">${escapeHtml(e.type)}</span> ${escapeHtml(e.fromLocal)} → ${escapeHtml(e.toLocal)} · quote <span class="q">“${escapeHtml(e.quote)}”</span></li>`).join('');
  const clusters = d.related.clusters.map((c) => `<li data-cluster="${escapeHtml(c.id)}"><span class="kind">Candidates around ${escapeHtml(c.anchorLocal)}</span> ${c.members.map((m) => `${escapeHtml(m.localId)} <span class="why">(${m.type === 'possible_duplicate' ? 'similar wording' : 'same error signature'}, score ${m.score})</span>`).join(' · ')}</li>`).join('');
  B.push(`<section id="related" class="pane" aria-labelledby="h-rel"><h2 id="h-rel">Related Reports</h2><p class="note">Direct links quote the reference. Candidates may describe the same problem; no member is hidden or merged, and links never change a tier.</p>${direct || clusters ? `<ul class="warn">${direct}${clusters}</ul>` : '<p class="note">None.</p>'}</section>`);
  let since = '<p class="l0note">No previous snapshot was given (use --previous DIR).</p>';
  if (d.since) {
    const s = d.since;
    since = `<p class="note">Compared with <code>${escapeHtml(s.older.snapshotId.slice(0, 19))}</code>: ${s.counts.new} new, ${s.counts.notInNewer} not in this snapshot, ${s.counts.tierChanges} tier change(s), ${s.counts.newlyFlagged} newly flagged.</p>`;
    if (s.sections.newlyFlagged.length) since += `<ol class="cards">${s.sections.newlyFlagged.map((x) => cardHtml(x, tiers, { meta: entryMeta(x, s) })).join('')}</ol>`;
    if (s.sections.tierChanges.length) since += `<ul class="warn">${s.sections.tierChanges.map((x) => `<li>${escapeHtml(x.localId)} ${escapeHtml(x.before)} → ${escapeHtml(x.after)} because ${escapeHtml(causeText(x))}</li>`).join('')}</ul>`;
  }
  B.push(`<section id="since" class="pane" aria-labelledby="h-since"><h2 id="h-since">Since Last Snapshot</h2>${since}</section>`);
  B.push(warningsHtml([...d.warnings, ...(d.since ? d.since.warnings : [])]));
  B.push(`</main><footer><p>Read-only: nothing was changed on GitHub. Every quote is an exact substring of its item.</p><p>Generated by urgent-first ${escapeHtml(d.engineVersion)}.</p></footer></div>`);
  return page(`Maintainer Digest: ${repo}`, B.join('\n'), { kind: 'urgent-first-digest', status: d.status, counts: d.counts });
}

export { clip };
