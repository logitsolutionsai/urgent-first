// FHIR R4 ServiceRequest adapter.
// Accepts a Bundle (any type), a single ServiceRequest, or NDJSON of resources.
// Mapping:
//   id          <- ServiceRequest.id (or identifier[0].value)
//   title       <- code.text, else code.coding[0].display
//   priority    <- priority (routine | urgent | asap | stat); missing stays null
//   text.reason <- reasonCode[].text (else coding display), joined with "; "
//   text.note   <- note[].text joined with newlines
//   text.detail <- orderDetail[].text joined with "; "
//   location    <- Encounter.class code (EMER -> ED, IMP/ACUTE -> inpatient, AMB -> outpatient, else the code)
//   created_at  <- authoredOn, else occurrenceDateTime
//   synthetic   <- meta.security or meta.tag contains code HTEST (v3 ActReason "test health data")
// ServiceRequests with status completed, revoked or entered-in-error are skipped (counted in warnings).

const SKIP_STATUS = new Set(['completed', 'revoked', 'entered-in-error']);
const CLASS_TO_LOCATION = { EMER: 'ED', IMP: 'inpatient', ACUTE: 'inpatient', NONAC: 'inpatient', AMB: 'outpatient', OBSENC: 'observation', SS: 'day case', HH: 'home', VR: 'virtual', PRENC: 'pre-admission' };

function textOf(cc) {
  if (!cc) return '';
  if (cc.text) return cc.text;
  const c = (cc.coding || []).find((x) => x.display);
  return c ? c.display : '';
}

function isSynthetic(res) {
  const tags = [...(res.meta?.security || []), ...(res.meta?.tag || [])];
  return tags.some((t) => t && (t.code === 'HTEST' || t.code === 'synthetic'));
}

export function fhirToRawItems(input) {
  const warnings = [];
  let resources = [];
  if (Array.isArray(input)) resources = input;
  else if (input && input.resourceType === 'Bundle') resources = (input.entry || []).map((e) => ({ ...e.resource, _fullUrl: e.fullUrl }));
  else if (input && input.resourceType) resources = [input];
  const bundleSynthetic = input && !Array.isArray(input) && input.resourceType === 'Bundle' && isSynthetic(input);
  const byRef = new Map();
  for (const r of resources) {
    if (!r || !r.resourceType) continue;
    if (r.id) byRef.set(`${r.resourceType}/${r.id}`, r);
    if (r._fullUrl) byRef.set(r._fullUrl, r);
    for (const c of r.contained || []) if (c.id) byRef.set(`#${c.id}`, c);
  }
  const items = [];
  let skipped = 0;
  for (const r of resources) {
    if (!r || r.resourceType !== 'ServiceRequest') continue;
    if (SKIP_STATUS.has(r.status)) {
      skipped++;
      continue;
    }
    const enc = r.encounter?.reference ? byRef.get(r.encounter.reference) : null;
    const cls = enc?.class?.code || null;
    const text = {};
    const reason = (r.reasonCode || []).map(textOf).filter(Boolean).join('; ');
    if (reason) text.reason = reason;
    const note = (r.note || []).map((n) => n.text).filter(Boolean).join('\n');
    if (note) text.note = note;
    const detail = (r.orderDetail || []).map(textOf).filter(Boolean).join('; ');
    if (detail) text.detail = detail;
    items.push({
      id: r.id || r.identifier?.[0]?.value,
      title: textOf(r.code),
      text,
      priority: r.priority ?? null,
      labels: [],
      created_at: r.authoredOn || r.occurrenceDateTime || null,
      location: cls ? CLASS_TO_LOCATION[cls] || cls : null,
      source: 'fhir',
      synthetic: bundleSynthetic || isSynthetic(r),
      metadata: { status: r.status || null, intent: r.intent || null, encounter_class: cls, category: (r.category || []).map(textOf).filter(Boolean).join('; ') || null },
    });
  }
  if (skipped) warnings.push(`skipped ${skipped} ServiceRequest(s) with status completed, revoked or entered-in-error`);
  return { items, warnings };
}

export function looksLikeFhir(obj) {
  return Boolean(obj && (obj.resourceType === 'Bundle' || obj.resourceType === 'ServiceRequest'));
}
