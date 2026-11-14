// board.html: one standalone offline page. No external requests, no scripts required to read it.
import { escapeHtml, parseTime, formatMinutes, safeUrl } from '../util.js';
import { clockLines, slaText, waitText, evidenceByField, unionSpans, displayTime, uniqueQuotes, splitRules, maskedRanges, maskingSummary, MASKED_NOTE, NO_RULE_HEADING, NO_RULE_NOTE, FOOTER_NOTE } from './common.js';

const CSS = `
:root{--bg:#f6f7f9;--surface:#fff;--text:#16191d;--muted:#545b66;--border:#dfe2e7;--accent:#0057d9;--link:#0050c8;
--t1:#a61b13;--t1-bg:#fdecea;--t1-edge:#d93a2b;--t2:#7a4a00;--t2-bg:#fff2d9;--t2-edge:#e09a1a;--t3:#3d4654;--t3-bg:#eceff3;--t3-edge:#8a94a3;
--mark:#ffe27a;--mark-text:#16191d;--banner-bg:#fff4e5;--banner-border:#c25e00;--banner-text:#4a2600;--chip:#eef1f5;--code:#f1f3f6;}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--surface:#161a21;--text:#e7e9ec;--muted:#a3abb7;--border:#2a303a;--accent:#6ea8ff;--link:#8bb8ff;
--t1:#ffb4ab;--t1-bg:#3b1512;--t1-edge:#ff6b5b;--t2:#ffd08a;--t2-bg:#36270b;--t2-edge:#f0a930;--t3:#c6ccd6;--t3-bg:#232933;--t3-edge:#6f7a8a;
--mark:#6a5300;--mark-text:#fff3c4;--banner-bg:#2e1f0b;--banner-border:#e08a2e;--banner-text:#ffe2bf;--chip:#222833;--code:#1d222b;}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:20px 16px 48px}
a{color:var(--link)}
h1{font-size:1.6rem;line-height:1.2;margin:0 0 4px;letter-spacing:-.01em}
h2{font-size:1.2rem;margin:32px 0 6px}
h3{font-size:1rem;margin:22px 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sub{color:var(--muted);margin:0 0 14px;font-size:.92rem;overflow-wrap:anywhere}
.banner{background:var(--banner-bg);border:2px solid var(--banner-border);color:var(--banner-text);border-radius:10px;padding:12px 14px;margin:0 0 16px;font-size:.93rem}
.banner strong{display:block;margin-bottom:2px}
.summary{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px;padding:0;list-style:none}
.summary li{background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:4px 12px;font-size:.9rem}
.summary b{font-variant-numeric:tabular-nums}
.badge{display:inline-flex;align-items:center;gap:6px;border-radius:6px;padding:2px 8px;font-weight:650;font-size:.8rem;white-space:nowrap}
.badge.t1{background:var(--t1-bg);color:var(--t1)}.badge.t2{background:var(--t2-bg);color:var(--t2)}.badge.t3{background:var(--t3-bg);color:var(--t3)}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-left:5px solid var(--t3-edge);border-radius:10px;padding:12px 14px;min-width:0}
.card.t1{border-left-color:var(--t1-edge)}.card.t2{border-left-color:var(--t2-edge)}
.head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.pos{color:var(--muted);font-variant-numeric:tabular-nums;font-size:.85rem}
.id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem;color:var(--muted)}
.title{font-weight:650;overflow-wrap:anywhere}
.new{background:var(--accent);color:#fff;border-radius:4px;padding:0 6px;font-size:.72rem;font-weight:700;letter-spacing:.03em}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0;padding:0;list-style:none;font-size:.82rem;color:var(--muted)}
.meta li{background:var(--chip);border-radius:6px;padding:1px 8px}
.flags{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:6px}
.flags li{font-size:.9rem;overflow-wrap:anywhere}
.rule{font-weight:650}
.rid{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.8rem;background:var(--chip);border-radius:4px;padding:0 5px;margin-right:4px}
.q{font-style:italic}
.why{color:var(--muted);font-size:.85rem}
.kind{font-weight:600;color:var(--muted)}
.fields{margin:10px 0 0;display:grid;gap:6px}
.field{background:var(--code);border-radius:8px;padding:8px 10px;font-size:.88rem;white-space:pre-wrap;overflow-wrap:anywhere}
.field .fname{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:2px;white-space:normal}
.masked{color:var(--muted);font-style:italic;background:repeating-linear-gradient(135deg,transparent 0 6px,var(--border) 6px 7px)}
.masked-note{color:var(--muted);font-size:.8rem;margin:8px 0 0}
mark{background:var(--mark);color:var(--mark-text);border-radius:3px;padding:0 2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
details>summary{cursor:pointer;color:var(--muted);font-size:.85rem;margin-top:8px}
.plain{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}
.plain li{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;min-width:0}
.note{color:var(--muted);font-size:.9rem;margin:0}
.rejected li{border-left:4px solid var(--t1-edge)}
footer{margin-top:36px;color:var(--muted);font-size:.85rem;border-top:1px solid var(--border);padding-top:14px}
@media (max-width:480px){.wrap{padding:14px 12px 40px}h1{font-size:1.35rem}.card{padding:10px 11px}}
`;

function tierClass(result, tierId) {
  const idx = result.pack.tiers.findIndex((t) => t.id === tierId);
  return `t${Math.min(idx + 1, 3)}`;
}

function highlightRange(text, unions, from, to, itemId, field) {
  let out = '';
  let pos = from;
  for (const u of unions) {
    const s = Math.max(u.start, from);
    const e = Math.min(u.end, to);
    if (e <= s) continue;
    out += escapeHtml(text.slice(pos, s));
    const tags = [...u.tags].join(' ');
    out += `<mark data-item="${escapeHtml(itemId)}" data-field="${escapeHtml(field)}" data-start="${s}" data-end="${e}" title="${escapeHtml(tags)}">${escapeHtml(text.slice(s, e))}</mark>`;
    pos = e;
  }
  return out + escapeHtml(text.slice(pos, to));
}

/** The text with evidence marked and masked ranges (template text the rules did not read) dimmed. */
function highlight(text, spans, itemId, field, masked = []) {
  const unions = unionSpans(spans);
  let out = '';
  let pos = 0;
  for (const m of masked) {
    out += highlightRange(text, unions, pos, m.start, itemId, field);
    out += `<span class="masked" title="${MASKED_NOTE}" data-masked="${m.start}-${m.end}">${highlightRange(text, unions, m.start, m.end, itemId, field)}</span>`;
    pos = m.end;
  }
  return out + highlightRange(text, unions, pos, text.length, itemId, field);
}

function quoteHtml(e) {
  const extra = [];
  if (e.context === 'suspected') extra.push('suspected');
  if (e.fuzzy) extra.push('spelling-tolerant');
  return `<span class="q">“${escapeHtml(e.text)}”</span>${extra.length ? ` <span class="why">(${extra.join(', ')})</span>` : ''}`;
}

function itemFields(r, item, { open }) {
  const by = evidenceByField(r);
  const parts = [];
  const textFields = Object.entries(item.text);
  for (const [name, value] of textFields) {
    if (!value) continue;
    const spans = by.get(name) || [];
    const masked = maskedRanges(r, name);
    const body = `<div class="field"><span class="fname">${escapeHtml(name)}${masked.length ? ` · dimmed: ${MASKED_NOTE}` : ''}</span>${highlight(value, spans, r.id, name, masked)}</div>`;
    parts.push({ has: spans.length > 0, html: body });
  }
  const shown = parts.filter((p) => p.has || open).map((p) => p.html).join('');
  const hidden = parts.filter((p) => !p.has && !open).map((p) => p.html).join('');
  let html = shown ? `<div class="fields">${shown}</div>` : '';
  if (hidden) html += `<details><summary>Other text fields</summary><div class="fields">${hidden}</div></details>`;
  return html;
}

function titleHtml(r, item) {
  const by = evidenceByField(r);
  const spans = by.get('title') || [];
  const inner = spans.length ? highlight(item.title || '', spans, r.id, 'title') : escapeHtml(item.title || '(no title)');
  const href = safeUrl(r.url);
  return href ? `<a class="title" href="${escapeHtml(href)}" rel="noreferrer">${inner}</a>` : `<span class="title">${inner}</span>`;
}

function metaChips(r, item, nowMs) {
  const by = evidenceByField(r);
  const chips = [];
  const fieldChip = (label, field, value) => {
    const spans = by.get(field) || [];
    chips.push(`<li>${label} ${spans.length ? highlight(value, spans, r.id, field) : escapeHtml(value)}</li>`);
  };
  if (item.priority) fieldChip('priority', 'priority', item.priority);
  if (r.floor.unknown_priority !== undefined) chips.push('<li>priority not in the pack floor map: sets no floor</li>');
  if (r.raised) chips.push(`<li>raised from ${escapeHtml(r.floor.tier)}</li>`);
  if (item.location) fieldChip('', 'location', item.location);
  item.labels.forEach((l, i) => fieldChip('label', `labels[${i}]`, l));
  const w = waitText(r, nowMs);
  if (w) chips.push(`<li>waiting ${escapeHtml(w)}</li>`);
  return chips.length ? `<ul class="meta">${chips.join('')}</ul>` : '';
}

export function renderHtml(result, { pack, itemsById, newIds = null } = {}) {
  const nowMs = parseTime(result.now);
  const c = result.counts;
  const tiers = result.pack.tiers;
  const baseline = tiers[tiers.length - 1].id;
  const research = result.pack.mode === 'research';
  const title = `Discuss First: ${result.pack.title || result.pack.name}`;
  const H = [];
  H.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  H.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  H.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`);
  H.push('<meta name="color-scheme" content="light dark">');
  H.push(`<title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><div class="wrap">`);
  H.push(`<header><h1>Discuss First</h1>`);
  H.push(`<p class="sub">${escapeHtml(result.pack.title || result.pack.name)} · pack <code>${escapeHtml(result.pack.name)}</code> ${escapeHtml(result.pack.version)}${result.input ? ` · input <code>${escapeHtml(result.input)}</code>` : ''}${result.now ? ` · as of ${escapeHtml(displayTime(result.now))}` : ''}</p>`);
  if (research) {
    H.push(`<div class="banner" role="note" id="research-banner"><strong>Research mode</strong>${escapeHtml(pack.banner)}</div>`);
  }
  const tierCounts = tiers
    .filter((t) => t.id !== baseline)
    .map((t) => `<li data-count-tier="${escapeHtml(t.id)}"><span class="badge ${tierClass(result, t.id)}">${escapeHtml(t.id)} ${escapeHtml(t.name)}</span> <b>${c.by_tier[t.id]}</b></li>`)
    .join('');
  H.push(`<ul class="summary" aria-label="Counts"><li data-count="flagged">Discuss First <b>${c.flagged}</b></li>${tierCounts}<li data-count="unmatched">${NO_RULE_HEADING} <b>${c.unmatched}</b></li><li data-count="total">Items <b>${c.total}</b></li>`);
  if (result.annotations) H.push(`<li data-count="annotations">Annotations <b>${result.annotations.applied}</b> raised · <b>${result.annotations.rejected}</b> rejected</li>`);
  if (newIds) H.push(`<li data-count="new">New since last look <b>${newIds.size}</b></li>`);
  H.push('</ul>');
  const ms = maskingSummary(result);
  if (ms) H.push(`<p class="masked-note" id="masking">${escapeHtml(ms)}</p>`);
  H.push('</header><main>');

  H.push(`<section id="discuss-first" aria-labelledby="h-df"><h2 id="h-df">Discuss First (${c.flagged})</h2>`);
  if (!c.flagged) H.push('<p class="note">No item matched a rule and no priority field set a raised floor.</p>');
  for (const t of tiers) {
    if (t.id === baseline) continue;
    const rows = result.items.filter((r) => r.tier === t.id);
    if (!rows.length) continue;
    const sla = t.sla_minutes ? ` <span class="why">turnaround target ${escapeHtml(formatMinutes(t.sla_minutes))} (pack setting)</span>` : '';
    H.push(`<h3><span class="badge ${tierClass(result, t.id)}">${escapeHtml(t.id)}</span> ${escapeHtml(t.name)} (${rows.length})${sla}</h3><ol class="cards">`);
    for (const r of rows) {
      const item = itemsById.get(r.id);
      const flags = [];
      const { main, extra } = splitRules(r, tiers.map((x) => x.id));
      for (const rule of main) {
        const srcUrl = safeUrl(rule.source?.url);
        const src = srcUrl ? ` · <a href="${escapeHtml(srcUrl)}" rel="noreferrer" title="${escapeHtml(rule.source.citation || '')}">source</a>` : '';
        flags.push(`<li data-rule="${escapeHtml(rule.id)}"><span class="rid">${escapeHtml(rule.id)}</span><span class="rule">${escapeHtml(rule.title)}</span> <span class="badge ${tierClass(result, rule.tier)}">${escapeHtml(rule.tier)}</span>${src}<br>${uniqueQuotes(rule.evidence).map(quoteHtml).join(' · ')}</li>`);
      }
      if (extra.length) {
        flags.push(`<li class="also"><span class="kind">Also matched</span> ${extra.map((rule) => `<span data-rule="${escapeHtml(rule.id)}"><span class="rid">${escapeHtml(rule.id)}</span>${escapeHtml(rule.tier)} ${uniqueQuotes(rule.evidence).slice(0, 2).map(quoteHtml).join(' · ')}</span>`).join('; ')}</li>`);
      }
      for (const a of r.annotations) {
        flags.push(`<li data-annotation="${escapeHtml(a.rule_id)}"><span class="rid">${escapeHtml(a.rule_id)}</span><span class="rule">Annotation</span> <span class="badge ${tierClass(result, a.raise_to)}">${escapeHtml(a.raise_to)}</span>${a.applied ? '' : ' <span class="why">(no change)</span>'}<br>${escapeHtml(a.reason)} ${a.quotes.map((q) => `<span class="q">“${escapeHtml(q)}”</span>`).join(' · ')}</li>`);
      }
      for (const rule of main) for (const l of rule.linked || []) flags.push(`<li data-linked="${escapeHtml(l.id)}"><span class="kind">Linked issue</span> ${escapeHtml(l.id)} “${escapeHtml(l.title || '')}” is ${escapeHtml(l.tier)} by ${escapeHtml(l.by.join(', ') || 'its floor')}</li>`);
      for (const line of clockLines(r, nowMs)) flags.push(`<li><span class="kind">Clock</span> ${escapeHtml(line)}</li>`);
      const s = slaText(r, nowMs);
      if (s) flags.push(`<li><span class="kind">Turnaround</span> ${escapeHtml(s)}</li>`);
      for (const f of r.floor.reasons) flags.push(`<li><span class="kind">Floor</span> ${escapeHtml(f.kind)} “${escapeHtml(f.evidence[0].text)}” sets ${escapeHtml(f.tier)}</li>`);
      H.push(`<li class="card ${tierClass(result, r.tier)}" data-id="${escapeHtml(r.id)}" data-tier="${escapeHtml(r.tier)}"><div class="head"><span class="pos">${r.position}.</span><span class="badge ${tierClass(result, r.tier)}">${escapeHtml(r.tier)} ${escapeHtml(r.tier_name)}</span><span class="id">${escapeHtml(r.id)}</span>${titleHtml(r, item)}${newIds && newIds.has(r.id) ? '<span class="new">NEW</span>' : ''}</div>`);
      H.push(metaChips(r, item, nowMs));
      H.push(`<ul class="flags">${flags.join('')}</ul>`);
      H.push(itemFields(r, item, { open: false }));
      H.push('</li>');
    }
    H.push('</ol>');
  }
  H.push('</section>');

  H.push(`<section id="no-rule-matched" aria-labelledby="h-nr"><h2 id="h-nr">${NO_RULE_HEADING} (${c.unmatched})</h2><p class="note">${NO_RULE_NOTE}</p><ol class="plain">`);
  for (const r of result.items.filter((x) => x.tier === baseline)) {
    const item = itemsById.get(r.id);
    const sup = r.suppressed.length ? `<p class="why">Did not count: ${r.suppressed.slice(0, 4).map((s) => `“${escapeHtml(s.text)}” (${escapeHtml(s.context)}, ${escapeHtml(s.rule)})`).join(' · ')}</p>` : '';
    H.push(`<li data-id="${escapeHtml(r.id)}" data-tier="${escapeHtml(r.tier)}"><div class="head"><span class="pos">${r.position}.</span><span class="id">${escapeHtml(r.id)}</span>${titleHtml(r, item)}${newIds && newIds.has(r.id) ? '<span class="new">NEW</span>' : ''}</div>${metaChips(r, item, nowMs)}${sup}<details><summary>Item text</summary>${itemFields(r, item, { open: true })}</details></li>`);
  }
  H.push('</ol></section>');

  if (result.annotations && result.annotations.rejected_list.length) {
    H.push(`<section id="rejected" aria-labelledby="h-rej"><h2 id="h-rej">Rejected Annotations (${result.annotations.rejected_list.length})</h2><ol class="plain rejected">`);
    for (const x of result.annotations.rejected_list) H.push(`<li>Line ${x.line} (${escapeHtml(x.item_id ?? '?')}): ${escapeHtml(x.reasons.join('; '))}</li>`);
    H.push('</ol></section>');
  }
  H.push(`</main><footer><p>${escapeHtml(FOOTER_NOTE)}</p>`);
  if (research) H.push(`<p><strong>Research mode.</strong> ${escapeHtml(pack.banner)}</p>`);
  H.push(`<p>Generated by urgent-first ${escapeHtml(result.engine.version)}.</p></footer>`);
  // Machine-readable summary for tests and tools. Never executed.
  const data = { counts: c, evidence: result.items.map((r) => ({ id: r.id, tier: r.tier, quotes: [...r.rules.flatMap((x) => x.evidence.map((e) => ({ field: e.field, text: e.text }))), ...r.annotations.flatMap((a) => a.evidence.map((e) => ({ field: e.field, text: e.text })))] })) };
  H.push(`<script type="application/json" id="uf-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  H.push('</div></body></html>');
  return H.join('\n');
}
