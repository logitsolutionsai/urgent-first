// Numeric values and clocks pulled out of free text with pack-defined patterns.
//
// numbers: { "spo2": { "label": "SpO2", "patterns": ["(?:spo2|sats?)\\s*(?:of|at|=|:)?\\s*(\\d{2,3})\\s*%"] } }
//   The first capture group (or a group named "value") is the number. The whole match is the evidence.
//
// clocks: { "lkw": { "label": "Last known well", "patterns": ["..."], "windows": [{"label": "...", "minutes": 270}] } }
//   A pattern must capture a named group "time" (a wall-clock time such as 07:40, 0740, 7.40pm) or "ago"
//   (a duration such as "45 min", "2 hours", "1.5h") meaning that long before the item's time.
//   Wall-clock times are read in the same clock as the item's created_at (its UTC offset, or UTC for "Z").

export function compilePatterns(patterns, flags = 'giu') {
  return (patterns || []).map((p) => new RegExp(p, flags.includes('g') ? flags : flags + 'g'));
}

export function extractNumbers(def, fieldTexts) {
  const out = [];
  for (const { field, text } of fieldTexts) {
    for (const re of def._compiled) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const raw = m.groups?.value ?? m[1];
        if (raw === undefined) continue;
        const value = Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(value)) continue;
        out.push({ value, field, start: m.index, end: m.index + m[0].length, text: m[0] });
      }
    }
  }
  return out;
}

function parseDurationMinutes(s) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (unit.startsWith('d')) return n * 1440;
  if (unit.startsWith('h')) return n * 60;
  return n;
}

function parseWallTime(s) {
  const m = /^\s*(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3] ? m[3].toLowerCase()[0] : null;
  if (!m[2] && !ampm) return null; // a bare "7" is not a time
  if (ampm === 'p' && h < 12) h += 12;
  if (ampm === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Offset in minutes of an ISO string ("+05:30" -> 330, "Z" -> 0). */
function isoOffsetMinutes(iso) {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(String(iso || ''));
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -v : v;
}

/**
 * Extract clock events. Returns [{field,start,end,text, kind, elapsedMinutes, eventMs}].
 * eventMs is null when the item has no created_at (elapsed is then known only for "ago" clocks).
 */
export function extractClocks(def, fieldTexts, itemMs, itemIso) {
  const out = [];
  for (const { field, text } of fieldTexts) {
    for (const re of def._compiled) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const g = m.groups || {};
        let elapsed = null;
        let eventMs = null;
        let kind = null;
        if (g.ago !== undefined) {
          const d = parseDurationMinutes(g.ago);
          if (d === null) continue;
          kind = 'ago';
          elapsed = d;
          if (itemMs !== null) eventMs = itemMs - d * 60000;
        } else if (g.time !== undefined) {
          const wall = parseWallTime(g.time);
          if (wall === null || itemMs === null) continue;
          kind = 'time';
          const offset = isoOffsetMinutes(itemIso);
          const localItem = new Date(itemMs + offset * 60000);
          const dayStartLocal = Date.UTC(localItem.getUTCFullYear(), localItem.getUTCMonth(), localItem.getUTCDate());
          let candidate = dayStartLocal + wall * 60000 - offset * 60000;
          // A time later than the order (beyond 10 minutes of clock skew) means the previous day.
          if (candidate > itemMs + 10 * 60000) candidate -= 1440 * 60000;
          eventMs = candidate;
          elapsed = Math.max(0, (itemMs - candidate) / 60000);
        } else continue;
        out.push({ field, start: m.index, end: m.index + m[0].length, text: m[0], kind, elapsedMinutes: elapsed, eventMs });
      }
    }
  }
  return out;
}
