// Deterministic snapshots: one manifest (snapshot.json) of a triaged queue, written by `urgent-first snapshot`.
//
// The snapshot reuses the existing engine unchanged: items are normalised by the same adapters and triaged by
// triage() exactly as `run` and `github` do. This module only re-expresses the result:
//   - every item with a stable identity (repository + kind + number for GitHub; the explicit id otherwise),
//     its original order, its original priority, its effective tier and a content digest;
//   - every evidence span as its own object, re-validated here against the original, unmodified field
//     (`text.slice(start, end) === quote`, UTF-16 offsets, the same semantics as the engine and the validator);
//   - the source with its scope and completeness (`complete: false` always carries a concrete reason);
//   - the latest release, only when the GitHub API supplied one;
//   - diagnostics (src/diagnostics.js) as first-class warning objects.
// snapshotId is the digest of the canonical JSON of everything else, so the same input, pack and engine give
// the same id on any machine at any time. Nothing in snapshot.json depends on the wall clock or on local paths;
// fetch timing and request counts go to collection.json, which is not part of the digest.
import fs from 'node:fs';
import path from 'node:path';
import { UserError, VERSION, assertInside, readJson } from '../util.js';
import { fieldValue } from '../items.js';
import { canonicalJson, digestOf, sha256 } from './canonical.js';
import { diagnose } from '../diagnostics.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const PARTIAL_REASONS = ['rate_limit', 'pagination_failed', 'filter_applied', 'missing_permission', 'limit_reached'];

/** The digest of a pack: canonical JSON of its pack.json (whitespace and key order do not matter). */
export function packDigest(pack) {
  if (pack._file && fs.existsSync(pack._file)) return digestOf(readJson(pack._file));
  const plain = Object.fromEntries(Object.entries(pack).filter(([k]) => !k.startsWith('_')));
  return digestOf(plain);
}

export function isResearchPack(pack) {
  return pack.mode === 'research' || pack.researchOnly === true || pack.research_only === true;
}

function numberOf(item) {
  if (item.metadata && Number.isInteger(item.metadata.number)) return item.metadata.number;
  const m = /^#(\d+)$/.exec(item.id);
  return m ? Number(m[1]) : null;
}

/**
 * Stable identity. GitHub: `github:<owner>/<repo>:<issue|pull>:<number>` (numbers alone never match across
 * repositories). Anything else: `item:<scope>:<id>`, where scope is the item's own `source` field or "local";
 * the adapters require an explicit id on every item, so no identity is ever a guess.
 */
export function itemIdentity(item) {
  const src = item.source || '';
  const n = numberOf(item);
  if (/^github:[^/\s]+\/[^/\s]+$/.test(src) && n !== null) return `${src}:${item.metadata?.type === 'pull_request' ? 'pull' : 'issue'}:${n}`;
  return `item:${src || 'local'}:${item.id}`;
}

export function itemKind(item) {
  const t = item.metadata?.type;
  if (t === 'pull_request') return 'pull_request';
  if (t === 'issue') return 'issue';
  return 'item';
}

/** What the engine reads, and nothing volatile (comment counts, reactions, updated_at). */
export function contentDigest(item) {
  return digestOf({ title: item.title, text: item.text, labels: item.labels, priority: item.priority, location: item.location });
}

function evidenceKind(rule, inheritId) {
  if (rule.id === inheritId) return 'inherited_link';
  return 'direct_quote';
}

/** Check one span against the original item. Returns null when exact, else the reason. */
export function spanProblem(item, ev) {
  const value = fieldValue(item, ev.field);
  if (typeof value !== 'string') return `field ${ev.field} does not exist`;
  if (!Number.isInteger(ev.start) || !Number.isInteger(ev.end) || ev.start < 0 || ev.end > value.length || ev.start >= ev.end) return `offsets ${ev.start}-${ev.end} are outside field ${ev.field}`;
  if (value.slice(ev.start, ev.end) !== ev.text) return `text at ${ev.field}[${ev.start}:${ev.end}] is not the quoted text`;
  return null;
}

/**
 * Build the manifest from items and the engine result (triage() output).
 * @param {object} o
 * @param {object} o.pack compiled pack
 * @param {object[]} o.items the normalised items, in original order
 * @param {object} o.result triage() result for exactly these items
 * @param {object} o.source { kind, repository?, input?, scope, complete, reason?, continuation?, pageCount? }
 * @param {object|null} o.release { tag, publishedAt, source } from the GitHub API, or null
 * @param {object[]} o.warnings extra warning objects (collection problems)
 */
export function buildSnapshot({ pack, items, result, source, release = null, warnings = [] }) {
  if (source.complete === false && !PARTIAL_REASONS.includes(source.reason)) throw new Error(`snapshot: an incomplete source needs a reason (${PARTIAL_REASONS.join(', ')})`);
  const byId = new Map(result.items.map((r) => [r.id, r]));
  const inheritId = pack.inherit ? pack.inherit.id : null;
  const outItems = [];
  const evidence = [];
  const identities = new Map();
  items.forEach((item, i) => {
    const r = byId.get(item.id);
    if (!r) throw new Error(`snapshot: no engine result for ${item.id}`);
    const identity = itemIdentity(item);
    if (identities.has(identity)) throw new UserError(`Two items have the same identity ${identity} (${identities.get(identity)} and ${item.id})`, { code: 1 });
    identities.set(identity, item.id);
    const evIds = [];
    let k = 0;
    const add = (ev) => {
      const problem = spanProblem(item, ev);
      // The engine guarantees exact spans; a mismatch here is a bug, never something to paper over.
      if (problem) throw new Error(`snapshot: evidence for ${item.id} failed validation: ${problem}`);
      k++;
      const id = `ev:${item.id}:${k}`;
      evIds.push(id);
      evidence.push({ id, itemId: identity, ...ev });
    };
    for (const rule of r.rules) {
      for (const e of rule.evidence) {
        add({ ruleId: rule.id, tier: rule.tier, category: rule.category || null, field: e.field, start: e.start, end: e.end, text: e.text, kind: evidenceKind(rule, inheritId), context: e.context || 'affirmed', ...(e.fuzzy ? { fuzzy: true } : {}), ...(rule.linked ? { linked: rule.linked.map((l) => l.id) } : {}) });
      }
    }
    for (const f of r.floor.reasons) {
      for (const e of f.evidence) add({ ruleId: `floor:${f.kind}`, tier: f.tier, category: null, field: e.field, start: e.start, end: e.end, text: e.text, kind: f.kind === 'label' ? 'floor_label' : 'floor_priority', context: 'affirmed' });
    }
    outItems.push({
      id: identity,
      localId: item.id,
      kind: itemKind(item),
      number: numberOf(item),
      title: item.title,
      text: item.text,
      labels: item.labels,
      priority: item.priority,
      location: item.location,
      state: typeof item.metadata?.state === 'string' ? item.metadata.state : null,
      createdAt: item.created_at,
      updatedAt: typeof item.metadata?.updated_at === 'string' ? item.metadata.updated_at : null,
      url: item.url,
      synthetic: item.synthetic,
      originalOrder: i,
      originalPriority: item.priority,
      floorTier: r.floor.tier,
      effectiveTier: r.tier,
      boardPosition: r.position,
      ruleIds: r.rules.map((x) => x.id),
      evidenceIds: evIds,
      suppressed: r.suppressed.map((s) => ({ ruleId: s.rule, field: s.field, start: s.start, end: s.end, text: s.text, context: s.context })),
      masked: (r.masked || []).map((m) => ({ field: m.field, start: m.start, end: m.end, kind: m.kind })),
      ...(r.floor.unknown_priority !== undefined ? { unknownPriority: r.floor.unknown_priority } : {}),
      ...(item.metadata && item.metadata.after_latest_release !== undefined ? { afterLatestRelease: item.metadata.after_latest_release } : {}),
      contentDigest: contentDigest(item),
    });
  });
  const snap = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: 'urgent-first-snapshot',
    engineVersion: VERSION,
    status: source.complete === false ? 'partial' : 'complete',
    pack: { id: pack.name, version: pack.version, digest: packDigest(pack), mode: pack.mode, tiers: pack.tiers.map((t) => ({ id: t.id, name: t.name })) },
    source,
    ...(release ? { release } : {}),
    counts: result.counts,
    items: outItems,
    evidence,
    warnings: [],
  };
  snap.warnings = [...warnings, ...diagnose({ snapshot: snap, result, pack })];
  snap.snapshotId = snapshotDigest(snap);
  return snap;
}

export function snapshotDigest(snap) {
  const { snapshotId, ...rest } = snap;
  void snapshotId;
  return digestOf(rest);
}

/** Pretty JSON with sorted keys, so the file itself is byte-identical for the same snapshot. */
export function stableJson(value) {
  return JSON.stringify(JSON.parse(canonicalJson(value)), null, 2) + '\n';
}

// ---------------------------------------------------------------------------------------------------------
// Writing: inside the output folder only, never through a link, temp file + rename, private permissions where
// the platform has them, and no overwriting an earlier snapshot without --force.

export function prepareOutDir(dir, { marker, force = false, what = 'snapshot' }) {
  const abs = path.resolve(dir);
  if (fs.existsSync(abs)) {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) throw new UserError(`Refusing to write a ${what} into a link: ${abs}`);
    if (!st.isDirectory()) throw new UserError(`Output path exists and is not a folder: ${abs}`);
    const entries = fs.readdirSync(abs);
    if (entries.length) {
      if (!entries.includes(marker)) throw new UserError(`Output folder ${abs} is not empty and is not an urgent-first ${what} folder. Choose a new folder with --out.`);
      if (!force) throw new UserError(`Output folder ${abs} already holds a ${what}. Use --force to replace it, or choose a new folder with --out.`);
    }
  }
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

export function writeAtomic(root, relPath, content, { mode = 0o600 } = {}) {
  const target = assertInside(root, path.join(root, relPath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertInside(fs.realpathSync(root), fs.realpathSync(path.dirname(target)));
  try {
    if (fs.lstatSync(target).isSymbolicLink()) throw new UserError(`Refusing to write through a link inside the output folder: ${target}`);
  } catch (err) {
    if (err instanceof UserError) throw err;
  }
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, { mode });
  fs.renameSync(tmp, target);
  try {
    fs.chmodSync(target, mode);
  } catch {
    // Windows keeps the folder's ACL; chmod is best effort.
  }
  return target;
}

// ---------------------------------------------------------------------------------------------------------
// Loading and verification

/**
 * Load a snapshot folder (or a snapshot.json path) and verify it: schema version and kind, snapshotId equals
 * the digest of the content, every item's content digest, every evidence span against the item's own text.
 * Any failure throws (exit 1): a snapshot edited by hand cannot be compared as if it were genuine.
 */
export function loadSnapshot(target) {
  const abs = path.resolve(target);
  const file = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? path.join(abs, 'snapshot.json') : abs;
  if (!fs.existsSync(file)) throw new UserError(`${target} is not a snapshot folder (no snapshot.json)`);
  const snap = readJson(file);
  const problems = verifySnapshot(snap);
  if (problems.length) throw new UserError(`Snapshot ${file} failed verification`, { details: problems });
  const dir = path.dirname(file);
  const graphFile = path.join(dir, 'evidence-graph.json');
  const collectionFile = path.join(dir, 'collection.json');
  return { dir, file, snapshot: snap, graph: fs.existsSync(graphFile) ? readJson(graphFile) : null, collection: fs.existsSync(collectionFile) ? readJson(collectionFile) : null };
}

/** Rebuild the minimal item model the evidence fields refer to. */
export function snapshotItemAsItem(si) {
  return { id: si.localId, title: si.title, text: si.text, labels: si.labels, priority: si.priority, location: si.location, metadata: {} };
}

export function verifySnapshot(snap) {
  const problems = [];
  if (!snap || snap.kind !== 'urgent-first-snapshot') return ['not an urgent-first snapshot (kind)'];
  if (snap.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return [`unsupported schemaVersion ${snap.schemaVersion} (this version reads ${SNAPSHOT_SCHEMA_VERSION})`];
  if (snapshotDigest(snap) !== snap.snapshotId) problems.push('snapshotId does not match the content: the file was changed after it was written');
  const byId = new Map();
  for (const si of snap.items || []) {
    if (byId.has(si.id)) problems.push(`duplicate item identity ${si.id}`);
    byId.set(si.id, si);
    if (contentDigest(snapshotItemAsItem(si)) !== si.contentDigest) problems.push(`content digest mismatch for ${si.id}`);
  }
  for (const ev of snap.evidence || []) {
    const si = byId.get(ev.itemId);
    if (!si) {
      problems.push(`evidence ${ev.id} refers to unknown item ${ev.itemId}`);
      continue;
    }
    const p = spanProblem(snapshotItemAsItem(si), ev);
    if (p) problems.push(`evidence ${ev.id}: ${p}`);
  }
  return problems;
}

export function evidenceIndex(snap) {
  return new Map(snap.evidence.map((e) => [e.id, e]));
}

export { sha256 };
