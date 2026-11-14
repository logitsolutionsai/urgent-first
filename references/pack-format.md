# Pack Format

A pack is one folder: `packs/<name>/pack.json` (the rules), `README.md` (for people) and `review.md` (guidance for the annotation step). `pack.json` is checked against `schema/pack.schema.json` plus semantic checks; run `urgent-first validate <pack>`.

## Items

Every adapter produces the same item shape. JSONL files use it directly (one object per line):

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string, required | Unique within the input. |
| `title` | string | Searched like a text field. |
| `text` | string or object | A string becomes the field `text`; an object gives named fields (`{"body": "...", "history": "..."}`), names in lowercase letters, digits and `_`. |
| `priority` | string or null | The source system's own priority (FHIR `stat`, a ticket's `P1`). Sets the floor. |
| `labels` | string array | Maintainer labels. Can set the floor. |
| `created_at` | ISO 8601 | Item time: anchors clocks, SLA deadlines and wait time. |
| `location` | string | Ward, region, queue. Usable in field conditions. |
| `source`, `url` | string | Where the item came from; `url` becomes the title link. |
| `synthetic` | boolean | Must be `true` for research-mode packs. |
| `metadata` | object | Anything else. `latest_release` adds `latest_release_aliases` (`v3.2.0`, `3.2.0`, `3.2`, `v3.2`). |
| `gold` | object | Labelled files only: `tier`, `category`, `rationale`, optional `rank`. |

CSV: columns `id,title,priority,labels,created_at,location,source,url,synthetic`, `text` or `text.<name>`, `metadata.<name>` (numbers parsed), `gold.<field>`. Labels are separated by `;`.

FHIR R4: a Bundle (or one ServiceRequest, or NDJSON). `code.text` becomes the title, `priority` the priority, `reasonCode[].text` the field `reason`, `note[].text` the field `note`, `orderDetail[].text` the field `detail`, the linked Encounter's `class` the location (`EMER` to `ED`, `IMP`/`ACUTE` to `inpatient`, `AMB` to `outpatient`). `meta.security` or `meta.tag` code `HTEST` (v3 ActReason "test health data") on the bundle or the request marks synthetic data. Requests with status `completed`, `revoked` or `entered-in-error` are skipped.

HL7 v2 ORM^O01 and OMI^O23: ORC-2 (else OBR-2, OBR-3) is the id, OBR-4 text the title, OBR-31 the `reason`, OBR-13 the `history`, NTE-3 after the OBR the `note`, PV1-2 the location. Priority comes from **TQ1-9 first**, then OBR-27 component 6 (older messages), then ORC-7.6, and `metadata.priority_source` records which. From v2.5 the priority lives in TQ1-9 and OBR-27 is kept only for backward compatibility; a reader that looks only at OBR-27.6 turns a STAT order into a routine one. A v2.5+ message without TQ1 produces a warning. MSH-11 `T` (training) or `D` (debugging) marks synthetic data.

GitHub: `urgent-first github owner/repo` calls the public REST API. Each issue or pull request becomes an item with id `#<number>`, `title`, `text.body` (the whole body), labels, `metadata.type` (`issue` or `pull_request`), `comments`, `reactions`, and the latest release (`latest_release`, `after_latest_release`).

## Pack Fields

| Field | Meaning |
| --- | --- |
| `name`, `version`, `title`, `description` | Identity. `name` is lowercase with hyphens. |
| `mode` | `standard` or `research` (see below). |
| `banner` | Required, exact text, in research mode. |
| `tiers` | Most urgent first, at least two. `id`, `name`, `description`, optional `sla_minutes` (a local turnaround target; never presented as a national standard). The **last tier is the baseline**: its items are listed under "No rule matched" in their original order. |
| `floor.priority` | Map of priority values (case-insensitive) to tiers. |
| `floor.labels` | `[{ "match": "security", "tier": "T1" }]`: word-boundary match inside a label, so `type: security` matches. |
| `floor.missing_priority`, `floor.unknown_priority` | `baseline` or `error`. Research packs use `error`: they refuse to guess a priority. With `baseline`, an unknown value sets no floor, and the board and review queue say so ("not in the pack floor map"). |
| `fields` | Default fields searched by text conditions (default: `title` and every text field). |
| `matching` | `typos` (spelling-tolerant matching on or off), `typo_min_length` (default 7), `window` (negation scope in words, default 6). |
| `context` | Extra cue phrases per list (`negation_pre`, `negation_post`, `suspicion_pre`, `suspicion_post`, `historical_pre`, `historical_post`, `experiencer_pre`, `pseudo`, `terminate`, `terminate_historical`), `remove` to drop a default cue, `windows` to set a cue's scope length. |
| `abbreviations` | `{ "SOB": "shortness of breath" }`. Keys with an upper-case letter match case-sensitively; use `{ "expand": "...", "case": "insensitive" }` to override. Longer keys win (`"PE tube"` before `"PE"`). |
| `numbers` | Named numeric extractors: `{ "spo2": { "label": "SpO2", "patterns": ["...(?<value>\\d{2,3})\\s*%"] } }`. |
| `clocks` | Named time extractors with windows (see `rule-matching.md`). |
| `masking` | Template and boilerplate masking (`src/mask.js`): `false` (default) or `{ "templates": true, "boilerplate": { "min_share": 0.2, "min_items": 5 } }`. Template lines come from the repository's issue and pull request templates (GitHub runs); boilerplate lines are lines found in at least `min_share` of the items of the same `source` and `metadata.type` in a run and in at least `min_items` of them. Never applied in research mode, never to titles, and a boilerplate line that a top-tier rule matches on its own is kept. See `rule-matching.md`. |
| `inherit` | An item that links to another ("Fixes #N") takes that item's tier: `{ "id", "title", "why", "source", "when": <condition>, "regex": "...#(\\d+)..." }`. The first capture group is the linked number, matched against `metadata.number` (or an id `#N`) of items in the run or fetched to resolve the link. The linked tier comes from the item's own rules and floor, so links do not chain. The quote is the matched link text. |
| `rules` | See below. |

## Rules

```json
{
  "id": "DATA-LOSS",
  "tier": "T1",
  "category": "data_loss",
  "title": "Data lost, overwritten or corrupted",
  "why": "Plain-language reason an expert would give a new colleague.",
  "source": { "citation": "Guideline or policy name", "url": "https://...", "year": 2025 },
  "clocks": ["onset"],
  "match": { "any": [ ... ] }
}
```

- `tier` must be above the baseline; a rule can only raise.
- `source` is required: a public citation and URL per rule. Write rules in your own words; facts are not copyrightable, but guideline wording, tables and licensed code lists are. Never bundle SNOMED CT, WHO ICD-10, CPT or copied guideline text.
- A rule fires only when its match tree is true **and** produces at least one quotable span. Numeric metadata alone cannot fire a rule.
- `clocks` lists clocks to show when the rule fires (clocks used inside `match` are shown automatically).

## Research Mode

`"mode": "research"` is enforced by the engine, not by convention:

- The banner (exact text, checked at load) appears at the top of `board.md`, `board.html`, `review.md` and the terminal output, and again in the footer.
- `watch` and `github --watch` refuse with exit code 2. There are no notifications.
- Every item must be marked synthetic (`"synthetic": true`, FHIR `HTEST`, HL7 MSH-11 `T`/`D`); otherwise the run refuses with exit code 2. This is a speed bump, not a guarantee: it relies on the marker.
- A run writes only inside its own run folder (new, empty, or an earlier run folder); every write goes through one path check.
- A missing or unknown priority is a validation error.
- A pack that carries a `banner` must be in research mode, and a pack named like a bundled research pack must keep `"mode": "research"`: a copy with only `mode` deleted is refused with exit code 2. A renamed and edited copy is ordinary code that someone changed; these checks catch accidents, not intent.
- `explain`, `validate`, `eval` (also `--json`), `shadow`, `shadow-report` and `results.json` carry the banner too.

Research mode exists because live flagging of possible stroke or pulmonary embolism from patient data is very likely a medical device function in the US and the EU. The radiology pack is for research and education on synthetic cases.
