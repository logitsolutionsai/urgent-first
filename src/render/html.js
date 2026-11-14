// board.html: one standalone offline page. No external requests, no scripts required to read it.
// One inline script (fluid.js plus motion.js, allowed by its hash in the CSP) adds the toggles and
// motion; without it every card and group renders open.
// Palette: Ink (brand-kit/INTERFACE-SPEC.md). Status is carried by weight and shape, never by hue:
// T1 is an ink chip (L3), T2 an ink outline (L2), T3 a grey fill (L1), "No rule matched" a dashed outline (L0).
// The one accent (#0065FD, #5b9cff in dark) is only for links, focus and selection.
// Text on --surface-2 (L1 chips, rule ids) is --ink-2, and the L0 label is --muted, because --muted on
// --surface-2 (4.43:1) and --faint anywhere (2.4-3.5:1) miss 4.5:1. Masked template text keeps --faint on purpose.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { escapeHtml, parseTime, formatMinutes, safeUrl } from '../util.js';
import { clockLines, slaText, waitText, evidenceByField, unionSpans, displayTime, uniqueQuotes, splitRules, maskedRanges, maskingSummary, MASKED_NOTE, NO_RULE_HEADING, NO_RULE_NOTE, FOOTER_NOTE } from './common.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
const CSS = `
:root{--bg:#f7f7f5;--surface:#ffffff;--surface-2:#f0f0ed;--line:#e3e3df;--line-strong:#c9c9c3;--ink:#111110;--ink-2:#3a3a37;--muted:#6f6f69;--faint:#a3a39c;
--accent:#0065FD;--accent-press:#0654c8;--accent-soft:rgba(0,101,253,.10);--bar-h:60px}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e0d;--surface:#171716;--surface-2:#1f1f1d;--line:#2b2b29;--line-strong:#3d3d3a;--ink:#f4f4f2;--ink-2:#d6d6d2;--muted:#9a9a94;--faint:#6a6a65;
--accent:#5b9cff;--accent-press:#3f86ff;--accent-soft:rgba(91,156,255,.14)}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--bg);color:var(--ink-2);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
::selection{background:var(--accent-soft)}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}
a{color:var(--accent);text-underline-offset:2px}
a:active{color:var(--accent-press)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code{font-family:${MONO};font-size:.9em}
h1{font-size:1.6rem;line-height:1.2;margin:0 0 4px;letter-spacing:-.01em;color:var(--ink)}
h2{font-size:1.2rem;line-height:1.3;margin:40px 0 8px;color:var(--ink);display:flex;align-items:center;gap:4px}
h3{font-size:1rem;margin:24px 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--ink)}
section,h3{scroll-margin-top:calc(var(--bar-h) + 16px)}
main>section:first-child>h2{margin-top:24px}
.intro{padding-top:24px}
.sub{color:var(--muted);margin:0 0 16px;font-size:.92rem;overflow-wrap:anywhere}
.banner{background:var(--surface);border:1.5px solid var(--ink);color:var(--ink);border-radius:10px;padding:12px 16px;margin:0 0 4px;font-size:.93rem}
.banner strong{display:block;margin-bottom:4px}
#bar-sentinel{height:1px;margin-bottom:-1px}
.bar{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid transparent}
.bar.stuck{background:color-mix(in srgb,var(--surface) 78%,transparent);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border-bottom-color:var(--line)}
@media (prefers-reduced-motion:no-preference){.bar{transition:background-color .16s ease,border-color .16s ease}}
.summary{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:12px 0;list-style:none}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:4px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink-2);font-size:.88rem;line-height:1.3;text-decoration:none;white-space:nowrap;-webkit-tap-highlight-color:transparent}
a.chip{cursor:pointer;-webkit-user-select:none;user-select:none}
a.chip:hover{border-color:var(--line-strong)}
.chip b{font-variant-numeric:tabular-nums;font-weight:700;color:inherit}
.chip.t1{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.chip.t2{background:transparent;border:1.5px solid var(--ink);color:var(--ink);padding:3.5px 11.5px}
.chip.t3{background:var(--surface-2);border-color:var(--surface-2);color:var(--ink-2)}
.chip.l0{background:transparent;border:1px dashed var(--line-strong);color:var(--muted)}
.badge{display:inline-flex;align-items:center;border:1.5px solid transparent;border-radius:4px;padding:0 6px;font-weight:650;font-size:.78rem;line-height:1.45;white-space:nowrap;font-variant-numeric:tabular-nums}
.badge.t1{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.badge.t2{border-color:var(--ink);color:var(--ink)}
.badge.t3{background:var(--surface-2);color:var(--ink-2)}
.tog{position:relative;flex:none;display:inline-grid;place-items:center;width:24px;height:24px;margin:0 0 0 -4px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.tog::after{content:"";position:absolute;inset:-8px}
.tog:hover{background:var(--surface-2);color:var(--ink)}
.chev{display:block;width:16px;height:16px}
details.disc[open]>summary .chev{transform:rotate(90deg)}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.card{--pad:16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px var(--pad);min-width:0}
.card.t1{border-left:3px solid var(--ink);padding-left:calc(var(--pad) - 2px)}
.card.t2{border-left:1.5px solid var(--ink-2);padding-left:calc(var(--pad) - .5px)}
.head{display:flex;gap:8px;align-items:flex-start}
.hl{display:flex;flex:1;gap:8px;align-items:baseline;flex-wrap:wrap;min-width:0}
.tog+.hl{margin-left:-2px}
.pos{color:var(--muted);font-variant-numeric:tabular-nums;font-size:.85rem}
.id{font-family:${MONO};font-size:.85rem;color:var(--muted)}
.title{font-weight:650;color:var(--ink);overflow-wrap:anywhere}
a.title{text-decoration:none}
a.title:hover{color:var(--accent);text-decoration:underline}
.new{display:inline-flex;align-items:center;background:var(--surface-2);color:var(--ink-2);border-radius:4px;padding:0 6px;font-size:.72rem;font-weight:700;letter-spacing:.04em}
.meta{display:flex;flex-wrap:wrap;margin:4px 0 0;padding:0;list-style:none;font-size:.82rem;color:var(--muted)}
.meta li:not(:last-child)::after{content:"·";padding:0 8px;color:var(--faint)}
.flags{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:8px}
.flags li{font-size:.9rem;overflow-wrap:anywhere}
.rule{font-weight:650;color:var(--ink)}
.rid{font-family:${MONO};font-size:.78rem;color:var(--ink-2);background:var(--surface-2);border-radius:4px;padding:1px 6px;margin-right:6px}
.q{font-style:italic;color:var(--ink)}
.why{color:var(--muted);font-size:.85rem}
.kind{font-weight:600;color:var(--muted)}
.fields{margin:12px 0 0;display:grid;gap:8px}
.field{border:1px solid var(--line);border-radius:6px;padding:8px 12px;font-size:.88rem;white-space:pre-wrap;overflow-wrap:anywhere}
.field .fname{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:4px;white-space:normal}
.masked{color:var(--faint);text-decoration-line:underline;text-decoration-style:dashed;text-decoration-color:var(--faint);text-decoration-thickness:1px;text-underline-offset:3px}
.masked-note{color:var(--muted);font-size:.8rem;margin:12px 0 0}
mark{background:var(--surface-2);color:var(--ink);text-decoration-line:underline;text-decoration-color:var(--ink);text-decoration-thickness:1.5px;text-underline-offset:3px;text-decoration-skip-ink:none;border-radius:2px;padding:0 2px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
details.disc>summary{display:flex;align-items:center;gap:4px;width:fit-content;margin:8px 0 0 -4px;padding:2px 8px 2px 4px;border-radius:6px;list-style:none;cursor:pointer;color:var(--muted);font-size:.85rem;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
details.disc>summary::-webkit-details-marker{display:none}
details.disc>summary:hover{background:var(--surface-2);color:var(--ink)}
.plain{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.plain>li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:0}
.note{color:var(--muted);font-size:.9rem;margin:0}
.rejected>li{display:flex;gap:8px;align-items:baseline}
footer{margin-top:48px;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line);padding:16px 0 48px}
@media (max-width:600px){.chip .tn{display:none}.summary{gap:6px;padding:8px 0}.chip{min-height:30px;padding:3px 10px}.chip.t2{padding:2.5px 9.5px}}
@media (max-width:480px){.wrap{padding:0 12px}.intro{padding-top:16px}h1{font-size:1.35rem}.card{--pad:12px}.plain>li{padding:12px}}
`;

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
// fluid.js is a verbatim copy of brand-kit/fluid.js; motion.js wires it to the board.
const SCRIPT = `\n${read('./fluid.js')}\n${read('./motion.js')}`;
const SCRIPT_HASH = crypto.createHash('sha256').update(SCRIPT).digest('base64');
const CHEV = '<svg class="chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A chevron button that opens and closes the element with id `controls`. Hidden until the script runs. */
function toggleButton(controls, label) {
  return `<button class="tog" type="button" hidden aria-expanded="true" aria-controls="${controls}" aria-label="${escapeHtml(label)}">${CHEV}</button>`;
}

/** A native <details> whose body the script opens and closes on a height spring. */
function disclosure(summary, inner, open = false) {
  return `<details class="disc"${open ? ' open' : ''}><summary>${CHEV}<span>${summary}</span></summary><div class="dbody"><div class="din">${inner}</div></div></details>`;
}

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
  if (hidden) html += disclosure('Other text fields', `<div class="fields">${hidden}</div>`);
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

// Shared with the Maintainer Radar pages (src/pulse/render.js): the same styles, the same inline script and
// therefore the same CSP hash. Exporting them changes nothing in board.html.
export { CSS, SCRIPT, SCRIPT_HASH, MONO, toggleButton, disclosure };

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
  H.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; img-src data:; base-uri 'none'; form-action 'none'">`);
  H.push('<meta name="color-scheme" content="light dark">');
  H.push(`<title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>`);
  H.push(`<header class="wrap intro"><h1>Discuss First</h1>`);
  H.push(`<p class="sub">${escapeHtml(result.pack.title || result.pack.name)} · pack <code>${escapeHtml(result.pack.name)}</code> ${escapeHtml(result.pack.version)}${result.input ? ` · input <code>${escapeHtml(result.input)}</code>` : ''}${result.now ? ` · as of ${escapeHtml(displayTime(result.now))}` : ''}</p>`);
  if (research) {
    H.push(`<div class="banner" role="note" id="research-banner"><strong>Research mode</strong>${escapeHtml(pack.banner)}</div>`);
  }
  H.push('</header>');
  // The counts bar: sticky, and each chip jumps to its section. Status by weight: T1 ink, T2 outline, No rule matched dashed.
  const chip = (cls, href, inner) => (href ? `<a class="chip${cls}" href="${href}">${inner}</a>` : `<span class="chip${cls}">${inner}</span>`);
  const tierCounts = tiers
    .filter((t) => t.id !== baseline)
    .map((t) => `<li data-count-tier="${escapeHtml(t.id)}">${chip(` ${tierClass(result, t.id)}`, c.by_tier[t.id] ? `#tier-${escapeHtml(t.id)}` : null, `${escapeHtml(t.id)}<span class="tn"> ${escapeHtml(t.name)}</span> <b>${c.by_tier[t.id]}</b>`)}</li>`)
    .join('');
  H.push('<div id="bar-sentinel" aria-hidden="true"></div><nav class="bar" id="bar" aria-label="Counts"><div class="wrap"><ul class="summary">');
  H.push(`<li data-count="flagged">${chip('', '#discuss-first', `Discuss First <b>${c.flagged}</b>`)}</li>${tierCounts}<li data-count="unmatched">${chip(' l0', '#no-rule-matched', `${NO_RULE_HEADING} <b>${c.unmatched}</b>`)}</li><li data-count="total">${chip('', null, `Items <b>${c.total}</b>`)}</li>`);
  if (result.annotations) H.push(`<li data-count="annotations">${chip('', result.annotations.rejected_list.length ? '#rejected' : null, `Annotations <b>${result.annotations.applied}</b> raised · <b>${result.annotations.rejected}</b> rejected`)}</li>`);
  if (newIds) H.push(`<li data-count="new">${chip('', null, `New since last look <b>${newIds.size}</b>`)}</li>`);
  H.push('</ul></div></nav><div class="wrap">');
  const ms = maskingSummary(result);
  if (ms) H.push(`<p class="masked-note" id="masking">${escapeHtml(ms)}</p>`);
  H.push('<main>');

  H.push(`<section id="discuss-first" aria-labelledby="h-df"><h2 id="h-df">Discuss First (${c.flagged})</h2>`);
  if (!c.flagged) H.push('<p class="note">No item matched a rule and no priority field set a raised floor.</p>');
  for (const t of tiers) {
    if (t.id === baseline) continue;
    const rows = result.items.filter((r) => r.tier === t.id);
    if (!rows.length) continue;
    const sla = t.sla_minutes ? ` <span class="why">turnaround target ${escapeHtml(formatMinutes(t.sla_minutes))} (pack setting)</span>` : '';
    H.push(`<h3 id="tier-${escapeHtml(t.id)}"><span class="badge ${tierClass(result, t.id)}">${escapeHtml(t.id)}</span> ${escapeHtml(t.name)} (${rows.length})${sla}</h3><ol class="cards">`);
    for (const r of rows) {
      const item = itemsById.get(r.id);
      const flags = [];
      const { main, extra } = splitRules(r, tiers.map((x) => x.id));
      for (const rule of main) {
        const srcUrl = safeUrl(rule.source?.url);
        const src = srcUrl ? ` · <a href="${escapeHtml(srcUrl)}" rel="noreferrer" title="${escapeHtml(rule.source.citation || '')}">source</a>` : '';
        // The card already shows its tier as a chip; repeat it on the rule line only when the rule's tier differs.
        const ruleTier = rule.tier === r.tier ? '' : ` <span class="badge ${tierClass(result, rule.tier)}">${escapeHtml(rule.tier)}</span>`;
        flags.push(`<li data-rule="${escapeHtml(rule.id)}" data-rule-tier="${escapeHtml(rule.tier)}"><span class="rid">${escapeHtml(rule.id)}</span><span class="rule">${escapeHtml(rule.title)}</span>${ruleTier}${src}<br>${uniqueQuotes(rule.evidence).map(quoteHtml).join(' · ')}</li>`);
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
      const body = `cb-${r.position}`;
      H.push(`<li class="card ${tierClass(result, r.tier)}" data-id="${escapeHtml(r.id)}" data-tier="${escapeHtml(r.tier)}"><div class="head">${toggleButton(body, `Details of ${r.id}`)}<div class="hl"><span class="pos">${r.position}.</span><span class="badge ${tierClass(result, r.tier)}">${escapeHtml(r.tier)} ${escapeHtml(r.tier_name)}</span><span class="id">${escapeHtml(r.id)}</span>${titleHtml(r, item)}${newIds && newIds.has(r.id) ? '<span class="new">NEW</span>' : ''}</div></div>`);
      H.push(`<div class="cbody" id="${body}"><div class="cin">`);
      H.push(metaChips(r, item, nowMs));
      H.push(`<ul class="flags">${flags.join('')}</ul>`);
      H.push(itemFields(r, item, { open: false }));
      H.push('</div></div></li>');
    }
    H.push('</ol>');
  }
  H.push('</section>');

  H.push(`<section id="no-rule-matched" aria-labelledby="h-nr"><h2 id="h-nr">${toggleButton('nr-body', `${NO_RULE_HEADING} items`)}<span>${NO_RULE_HEADING} (${c.unmatched})</span></h2><div class="cbody" id="nr-body"><div class="cin"><p class="note">${NO_RULE_NOTE}</p><ol class="plain">`);
  for (const r of result.items.filter((x) => x.tier === baseline)) {
    const item = itemsById.get(r.id);
    const sup = r.suppressed.length ? `<p class="why">Did not count: ${r.suppressed.slice(0, 4).map((s) => `“${escapeHtml(s.text)}” (${escapeHtml(s.context)}, ${escapeHtml(s.rule)})`).join(' · ')}</p>` : '';
    H.push(`<li data-id="${escapeHtml(r.id)}" data-tier="${escapeHtml(r.tier)}"><div class="head"><div class="hl"><span class="pos">${r.position}.</span><span class="id">${escapeHtml(r.id)}</span>${titleHtml(r, item)}${newIds && newIds.has(r.id) ? '<span class="new">NEW</span>' : ''}</div></div>${metaChips(r, item, nowMs)}${sup}${disclosure('Item text', itemFields(r, item, { open: true }))}</li>`);
  }
  H.push('</ol></div></div></section>');

  if (result.annotations && result.annotations.rejected_list.length) {
    H.push(`<section id="rejected" aria-labelledby="h-rej"><h2 id="h-rej">Rejected Annotations (${result.annotations.rejected_list.length})</h2><ol class="plain rejected">`);
    for (const x of result.annotations.rejected_list) H.push(`<li><span class="badge t1" aria-hidden="true">✕</span><span>Line ${x.line} (${escapeHtml(x.item_id ?? '?')}): ${escapeHtml(x.reasons.join('; '))}</span></li>`);
    H.push('</ol></section>');
  }
  H.push(`</main><footer><p>${escapeHtml(FOOTER_NOTE)}</p>`);
  if (research) H.push(`<p><strong>Research mode.</strong> ${escapeHtml(pack.banner)}</p>`);
  H.push(`<p>Generated by urgent-first ${escapeHtml(result.engine.version)}.</p></footer>`);
  // Machine-readable summary for tests and tools. Never executed.
  const data = { counts: c, evidence: result.items.map((r) => ({ id: r.id, tier: r.tier, quotes: [...r.rules.flatMap((x) => x.evidence.map((e) => ({ field: e.field, text: e.text }))), ...r.annotations.flatMap((a) => a.evidence.map((e) => ({ field: e.field, text: e.text })))] })) };
  H.push(`<script type="application/json" id="uf-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  H.push(`<script>${SCRIPT}</script>`);
  H.push('</div></body></html>');
  return H.join('\n');
}
