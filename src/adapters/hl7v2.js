// HL7 v2 ORM^O01 / OMI^O23 adapter (order messages).
//
// Mapping per ORC/OBR group:
//   id         <- ORC-2 placer order number, else OBR-2, else OBR-3 (first component)
//   title      <- OBR-4 text component (component 2), else component 1
//   text.reason  <- OBR-31 reason for study (repeats; text component), joined with "; "
//   text.history <- OBR-13 relevant clinical information
//   text.note    <- NTE-3 comments that follow the OBR
//   priority   <- TQ1-9 (v2.5+), else OBR-27 component 6 (older messages), else ORC-7 component 6
//                 S -> stat, A -> asap, R -> routine, T -> urgent (timing critical), P -> routine (pre-op),
//                 C -> routine (callback). Missing stays null so a pack can refuse it.
//   location   <- PV1-2 patient class (E -> ED, I -> inpatient, O -> outpatient, ...), PV1-3 point of care in metadata
//   created_at <- ORC-9, else OBR-6, else MSH-7 (HL7 TS; no offset is read as UTC)
//   synthetic  <- MSH-11 processing ID T (training) or D (debugging)
//
// The trap this adapter avoids: from v2.5 the priority lives in TQ1-9 and OBR-27 is usually empty.
// A reader that only looks at OBR-27.6 turns a STAT order into a routine one. We read TQ1-9 first and
// record which field the priority came from in metadata.priority_source.

const PRIORITY_CODES = { S: 'stat', A: 'asap', R: 'routine', T: 'urgent', P: 'routine', C: 'routine' };
const PATIENT_CLASS = { E: 'ED', I: 'inpatient', O: 'outpatient', P: 'pre-admission', R: 'outpatient', B: 'obstetrics' };

function unescape(s, enc) {
  const esc = enc.escape;
  if (!s || !s.includes(esc)) return s;
  const re = new RegExp(`\\${esc}(F|S|T|R|E|\\.br|X[0-9A-Fa-f]+)\\${esc}`, 'g');
  return s.replace(re, (_, code) => {
    switch (code) {
      case 'F': return enc.field;
      case 'S': return enc.component;
      case 'T': return enc.subcomponent;
      case 'R': return enc.repetition;
      case 'E': return esc;
      case '.br': return '\n';
      default: return String.fromCharCode(...(code.slice(1).match(/../g) || []).map((h) => parseInt(h, 16)));
    }
  });
}

function parseTs(ts) {
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?([+-]\d{4})?$/.exec((ts || '').trim());
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', off] = m;
  const zone = off ? `${off.slice(0, 3)}:${off.slice(3)}` : 'Z';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`;
}

export function splitMessages(text) {
  const segs = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r').map((s) => s.trim()).filter(Boolean);
  const msgs = [];
  for (const s of segs) {
    if (s.startsWith('MSH')) msgs.push([s]);
    else if (msgs.length) msgs[msgs.length - 1].push(s);
  }
  return msgs;
}

export function hl7ToRawItems(text) {
  const items = [];
  const warnings = [];
  for (const segs of splitMessages(text)) {
    const msh = segs[0];
    const enc = { field: msh[3], component: msh[4] || '^', repetition: msh[5] || '~', escape: msh[6] || '\\', subcomponent: msh[7] || '&' };
    const fieldsOf = (seg) => seg.split(enc.field);
    const mshF = fieldsOf(msh);
    // MSH-1 is the separator itself, so MSH-n is at index n-1.
    const msh7 = mshF[6] || '';
    const msh11 = (mshF[10] || '').split(enc.component)[0];
    const version = (mshF[11] || '').split(enc.component)[0];
    let pv1 = null;
    let current = null;
    const flush = () => {
      if (current && current.obr) items.push(current.build());
      current = null;
    };
    for (const seg of segs.slice(1)) {
      const f = fieldsOf(seg);
      const type = f[0];
      const get = (n) => f[n] ?? '';
      const comp = (v, i) => unescape((v || '').split(enc.component)[i] ?? '', enc);
      if (type === 'PV1') pv1 = f;
      else if (type === 'ORC') {
        flush();
        current = makeGroup();
        current.orc = f;
      } else if (type === 'OBR') {
        if (!current || current.obr) {
          flush();
          current = makeGroup();
        }
        current.obr = f;
      } else if (type === 'TQ1' && current) current.tq1 = f;
      else if (type === 'NTE' && current && current.obr) current.notes.push(unescape(get(3), enc));
      void comp;
    }
    flush();

    function makeGroup() {
      const g = {
        orc: null,
        obr: null,
        tq1: null,
        notes: [],
        build() {
          const comp = (v, i) => unescape((v || '').split(enc.component)[i] ?? '', enc);
          const orc = g.orc || [];
          const obr = g.obr || [];
          const id = comp(orc[2], 0) || comp(obr[2], 0) || comp(obr[3], 0);
          const title = comp(obr[4], 1) || comp(obr[4], 0);
          const reason = (obr[31] || '').split(enc.repetition).map((r) => comp(r, 1) || comp(r, 0)).filter(Boolean).join('; ');
          const history = (obr[13] || '').split(enc.repetition).map((r) => comp(r, 1) || comp(r, 0)).filter(Boolean).join('; ');
          let priorityCode = null;
          let prioritySource = null;
          if (g.tq1 && comp(g.tq1[9], 0)) {
            priorityCode = comp(g.tq1[9], 0);
            prioritySource = 'TQ1-9';
          } else if (comp(obr[27], 5)) {
            priorityCode = comp(obr[27], 5);
            prioritySource = 'OBR-27.6';
          } else if (comp(orc[7], 5)) {
            priorityCode = comp(orc[7], 5);
            prioritySource = 'ORC-7.6';
          }
          if (prioritySource && prioritySource !== 'TQ1-9' && version && Number(version.replace(/^2\./, '')) >= 5) {
            warnings.push(`${id}: v${version} message without TQ1-9; priority read from ${prioritySource}`);
          }
          const priority = priorityCode ? PRIORITY_CODES[priorityCode.toUpperCase()] || priorityCode : null;
          const pclass = pv1 ? comp(pv1[2], 0) : '';
          const text = {};
          if (reason) text.reason = reason;
          if (history) text.history = history;
          if (g.notes.length) text.note = g.notes.join('\n');
          return {
            id,
            title,
            text,
            priority,
            labels: [],
            created_at: parseTs(comp(orc[9], 0)) || parseTs(comp(obr[6], 0)) || parseTs(msh7.split(enc.component)[0]),
            location: pclass ? PATIENT_CLASS[pclass] || pclass : null,
            source: 'hl7v2',
            synthetic: msh11 === 'T' || msh11 === 'D',
            metadata: { hl7_version: version || null, priority_source: prioritySource, priority_code: priorityCode, point_of_care: pv1 ? comp(pv1[3], 0) || null : null },
          };
        },
      };
      return g;
    }
  }
  return { items, warnings };
}
