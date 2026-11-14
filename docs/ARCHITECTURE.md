# Architecture

urgent-first is a small, deterministic pipeline with one optional step performed by an agent.

```text
input (JSONL, CSV, FHIR, HL7 v2, GitHub API)
  -> adapters        src/adapters/*      one item shape for everything
  -> pack            src/pack.js         schema + semantic checks, compile cues, abbreviations, extractors
  -> engine          src/engine.js       floor, rules, clocks, deadline, order
  -> run folder      src/run.js          results.rules.json, board.md, board.html
  -> review queue    src/annotate.js     review.md for the agent
  -> merge           src/annotate.js     quote-or-reject, raise-only, results.json, boards
  -> eval            src/eval.js         metrics on labelled files
```

## Modules

| Path | Role |
| --- | --- |
| `scripts/urgent-first.mjs` | Entry point. |
| `src/cli.js` | Commands, argument parsing, exit codes, watch loops. |
| `src/items.js` | Item model, validation, quotable fields. |
| `src/adapters/` | `csv.js`, `fhir.js`, `hl7v2.js`, `github.js` (REST API, ETags, Link pagination), `github-fixture.js` (recorded responses for tests), `github-extra.js` (repository templates, linked issues, the user cache folder), `index.js` (format detection). |
| `src/benchfetch.js` | `bench-fetch`: fetches a real-world benchmark's text from references, strips labels. |
| `src/pack.js` | Loads and validates packs (`schema/pack.schema.json` through `src/jsonschema.js`, a small validator), research banner, compiled pack. |
| `src/match/text.js` | Tokenizer with exact offsets, abbreviation expansion, spelling folding, term compilation, spelling-tolerant matching. |
| `src/match/context.js` | Negation, suspicion, history and experiencer cues and scopes. |
| `src/match/extract.js` | Numeric and clock extractors. |
| `src/match/conditions.js` | Evaluates a rule's match tree and returns evidence spans. |
| `src/mask.js` | Template and boilerplate masking: which lines rules do not read. |
| `src/engine.js` | Masks, floor, tier, clocks, SLA, deadline, pull request inheritance (`inherit`), explanation, ordering, counts. |
| `src/annotate.js` | Review queue, annotation validator, merge. |
| `src/eval.js`, `src/stats.js` | Metrics, Wilson interval, Kendall tau-b. |
| `src/render/` | `markdown.js` and `html.js` boards; `common.js` shared text. |
| `src/shadow.js` | Shadow-mode log and report. |
| `src/run.js` | Run folders. |

## Invariants

1. **Raise-only.** `tier = most urgent of (floor, matched rule tiers, accepted annotation tiers)`. The floor comes only from the item's own priority field and labels. Nothing subtracts. Tested by a seeded property test (`tests/engine.test.js`).
2. **Quote-or-reject.** A rule fires only if its match tree yields at least one span; spans come from token offsets into the original text, so `text.slice(start, end) === quote` always holds. Annotation quotes are located with an exact `indexOf`; anything else is rejected.
3. **Determinism.** No randomness, no clock reads inside the engine; `now` is recorded and used only to display wait times. Ordering keys: tier, deadline, created time, original index.
4. **Research mode** is checked in the engine (`triage` refuses non-synthetic input), the CLI (watch refuses) and the pack loader (exact banner; a pack with a banner, or named like a bundled research pack, must be in research mode). All writes go through `writeInside(runDir, ...)`, which also refuses to write through a link.
5. **Offline board.** `board.html` is one file with inline CSS, a restrictive Content-Security-Policy and no scripts beyond an inert JSON data block.

## Run Folder

| File | Written by |
| --- | --- |
| `run.json` | run: pack, version, input, `now` |
| `items.json` | run: the normalised items, gold labels removed |
| `results.rules.json` | run: rules-only result (merge always starts from this) |
| `results.json` | run, then merge: the current result |
| `board.md`, `board.html`, `board.rules.md` | run, merge, watch, seen |
| `review.md`, `review.jsonl`, `annotations.jsonl` | annotate-template |
| `annotations.report.json` | merge |
| `watch-state.json` | watch, seen |
| `shadow.jsonl` | shadow |

## Tests

`npm test` runs the unit and integration tests with `node --test`: matcher table of tricky sentences, numbers and clocks, the property test, the validator, research mode, determinism, adapters on fixtures (including a recorded-format GitHub response), statistics on hand-computed cases, pack schema validity, the wording guard, regression tests for the QA pass (`tests/qa-regressions.test.js`), and an eval run on every benchmark whose numbers must equal `bench/results.json` and the README tables. `npm run test:e2e` opens the boards in the installed Chrome through `playwright-core`, aborts every network request, and checks counts, highlights, layout at 1280×800 and 390×844, and the research banner.
