# Maintainer Radar

Maintainer Radar adds snapshots, links, a Release Pulse, a digest, review files, calibration proposals and a pack linter to urgent-first. Every command is read-only towards GitHub and never changes a tier: the tier still comes only from the pack's rules, the item's own priority and labels, and validated annotations.

What you see:

- **Discuss First** is unchanged: the same tiers, in the same order, with the same quotes.
- **Related Reports** shows explicit links ("Fixes #713", "related to #702") with their quote, and groups of reports that may describe the same problem. Every member stays on the list with its own tier.
- **Since Last Snapshot** shows what actually changed between two snapshots, which reports were filed after the latest release, and what is unknown because a collection was partial or the scopes differ.

## Commands

| Command | What it does | Writes |
| --- | --- | --- |
| `snapshot github <owner/repo> [--pack P] [--state open\|closed\|all] [--limit N] --out DIR [--force]` | Fetches issues and pull requests with the existing client, runs the existing engine, writes a deterministic snapshot | `snapshot.json`, `evidence-graph.json`, `collection.json` |
| `snapshot run <pack> <file> --out DIR [--templates FILE]` | The same for a JSONL, JSON, CSV, FHIR or HL7 file | the same |
| `links <snapshot> [--json] [--include-near]` | Rebuilds and checks the evidence graph, prints links and candidate groups | nothing |
| `diff <older> <newer> [--out DIR] [--json] [--gold FILE] [--public [--allow-real-public-export]]` | The Release Pulse | `pulse.md`, `pulse.html`, `pulse.json` (only with `--out`) |
| `digest <snapshot> [--previous DIR] --out DIR [--format md,html,json]` | The three-pane digest | `digest.json` and the formats asked for |
| `review init <snapshot> --out FILE [--reviewer ALIAS]` | A review file listing every candidate link and flagged item, undecided | the review file |
| `review check <review.json> <snapshot> [--json]` | Validates decisions, ids and quotes | nothing |
| `calibrate <pack> <review.json> --snapshot DIR --out DIR [--heldout FILE]` | A proposed pack patch and development cases, evaluated before and after | `proposal.json`, `candidate-pack.json`, `dev-cases.jsonl` |
| `pack lint <pack> [--json] [--strict]` | Static and fixture checks on a pack | nothing |

`--json` output carries `schemaVersion` and a `kind`, and every new object carries `engineVersion`. Schemas: [schema/snapshot.v1.schema.json](../schema/snapshot.v1.schema.json), [schema/evidence-graph.v1.schema.json](../schema/evidence-graph.v1.schema.json), [schema/review.v1.schema.json](../schema/review.v1.schema.json), [schema/pulse.v1.schema.json](../schema/pulse.v1.schema.json).

### Exit Codes

The existing exit codes are authoritative, and the new commands use the same table. The release brief proposed a different numbering; it was not adopted, so no old command changes meaning.

| Code | Meaning | Brief's proposal for new commands |
| --- | --- | --- |
| 0 | Success, including a partial snapshot (its output says `partial`) | 0 |
| 1 | Usage or input error: an invalid pack, file, review file, or a snapshot that fails verification | 2 |
| 2 | Refused: research-mode packs, a public export of data not marked synthetic, unrelated repositories, a proposal aimed at a pack folder | 4 |
| 3 | Network or GitHub API error | 3 |
| 4 | A `--strict` check failed (`pack lint --strict` warnings, `calibrate --strict` held-out regression) | 1 |

## Quickstart

```bash
node scripts/urgent-first.mjs snapshot github owner/repo --out snapshots/before
node scripts/urgent-first.mjs snapshot github owner/repo --out snapshots/after
node scripts/urgent-first.mjs links snapshots/after
node scripts/urgent-first.mjs diff snapshots/before snapshots/after --out pulse
node scripts/urgent-first.mjs digest snapshots/after --previous snapshots/before --out digest
```

The demo in [examples/release-pulse](../examples/release-pulse) replays recorded GitHub responses: `node examples/release-pulse/build-demo.js`.

## Snapshots

A snapshot is the engine's result re-expressed with stable identities, validated evidence spans and digests. Same input, pack and engine: the same `snapshot.json`, byte for byte, on any machine at any time. Fetch time, request counts and the rate limit left go to `collection.json`, which is not part of the digest. Details: [SNAPSHOT-SCHEMA.md](SNAPSHOT-SCHEMA.md).

A collection that stops early is `partial`, with a concrete reason: `rate_limit`, `pagination_failed`, `missing_permission`, or `limit_reached` when `--limit` stopped a listing that had more pages. The items already fetched are kept and flagged as usual, the continuation URL is recorded, and every count built on the snapshot says it is partial. Resuming from the continuation is not implemented: the existing client has no resume support, so take the snapshot again.

## Evidence Graph And Links

`evidence-graph.json` links items to their evidence spans, pull requests to the issues they fix, items to the issues they mention, and items to the latest release when they were filed after it. Candidate links join reports that may describe the same problem. No node or edge has a tier. Details: [EVIDENCE-GRAPH.md](EVIDENCE-GRAPH.md).

Explicit links follow GitHub's own rules: a closing keyword (close, closes, closed, fix, fixes, fixed, resolve, resolves, resolved) followed by a reference, in a pull request, is `fixes`. Anything else, including "related to #812" and the same keywords inside an issue, is `references`. Text inside HTML comments and code is not read. Tier inheritance is unchanged: only the pack's `inherit` rule passes a tier, and only through "Fixes #N".

Candidate links (`text-signals-v1`):

1. Features from the title (weight 3), error identifiers such as `EACCES`, `TypeError` or `HTTP 409` (weight 4), version numbers (weight 2) and body prose (weight 1). Template and boilerplate lines masked by the engine are left out, and so are lines of five or more words repeated in three or more items. Code blocks, logs and stack frames are left out of the words but searched for error identifiers. Words are NFKC-normalised, case-folded, filtered by a frozen stopword list and folded by a light suffix rule (fails, failed, failing).
2. Each weight is multiplied by idf, and the 40 strongest features of each item are kept.
3. An inverted index over rare features retrieves at most 50 candidates per item. There is no all-pairs comparison.
4. Score: weighted Jaccard over the kept features. `possible_duplicate` at 0.45 or more with two shared distinctive features; `same_symptom` at 0.25 or more with a shared distinctive error identifier.
5. Contradiction guard: when one report affirms what the other negates, by a rule ("data loss" against "no data loss") or by a shared word read with the engine's negation cues ("I lost all my notes" against "nothing was lost"), the link is not drawn and is listed under `suppressedCandidates` for review.
6. At most 5 candidate links per item, at most 30,000 items per run (beyond that the graph says `limit`).

### Thresholds And Measured Quality

The release brief proposed 0.72 and 0.50. They were changed on the development pair set only, to the lowest values on a 0.05 grid at which no labelled negative pair is linked, and the held-out set was never used to choose them. Results, from `node scripts/bench-links.js` ([bench/maintainer-radar](../bench/maintainer-radar/README.md)):

| Pair set | Thresholds | Precision | Recall |
| --- | --- | --- | --- |
| Development, 15 same-problem pairs, 18 negative pairs | shipped 0.45 / 0.25 | 6 of 6 | 6 of 15 |
| Held-out, 8 same-problem pairs, 12 negative pairs | shipped 0.45 / 0.25 | 5 of 5 | 5 of 8 |
| Development | brief 0.72 / 0.50 | 3 of 3 | 3 of 15 |
| Held-out | brief 0.72 / 0.50 | 3 of 3 | 3 of 8 |

No negative pair (hard negatives with the same vocabulary, negation conflicts, template-only overlap) was linked on either set. Recall is low: paraphrased reports with few shared words are missed, and so is a short report whose duplicate is buried in a long one (weighted Jaccard penalises the long report's extra words). The benchmark lists every missed pair. The sets are small and synthetic, so the Wilson 95% intervals are wide; these are not production numbers, and the scores are ranking signals, not probabilities.

## Release Pulse

`diff` matches items by identity only (repository, kind and number; or an explicit id), and refuses snapshots of different repositories. It reports:

1. **Newly flagged T1 and T2**: flagged now, and new or unflagged before.
2. **Changed tier**, with the cause: the item text, its labels, its priority, its linked issue, or the pack. A lower tier in a later snapshot is a cross-run downgrade with its cause, never a lowering within a run.
3. **Still open from before**: flagged before and still open. Items flagged before and missing now are listed as "not in the newer snapshot", never as resolved.
4. **Related reports with new members**: candidate groups that gained a new report.
5. **Misses against labels**, only when `--gold FILE` is given. Without labels, no miss count is shown.

An item is called resolved only when both snapshots are complete, have the same scope, and the newer one has the item closed by the API. A changed pack or engine is reported as `config_changed` at the top. The latest release comes only from the GitHub API, and a report filed after it is "reported after release", which is an order of timestamps and not a cause.

`--public` writes a projection for sharing: titles and quotes clipped to 80 characters, no item bodies (a Pulse never has them), security reports withheld. It is refused unless every item of both snapshots is marked synthetic; real data needs `--allow-real-public-export` and gets a second banner.

## Digest

`digest` writes three panes: Discuss First (flagged items in board order, with their quotes), Related Reports (direct links with quotes, and candidate groups), and Since Last Snapshot (the Pulse against `--previous`, or a note that there is none). The Markdown carries everything; the HTML is a view of the same data. The graph is rebuilt from `snapshot.json`, so an edited `evidence-graph.json` cannot add links.

## Review, Calibrate And Pack Lint

`review init` writes a review file. Maintainers fill in decisions: `confirmed`, `rejected` or `needs_context` for candidate links; `correct`, `missed_raise`, `false_raise` or `unclear` for triage. A `missed_raise` needs a suggested tier and exact quotes, checked with the same locator as annotation merge. The reviewer is a local alias, not a verified identity. A review is an annotation: it never changes the snapshot, the board or a pack.

`calibrate` turns a checked review into a proposal: a rule per suggested tier whose patterns are the reviewer's quotes, with evidence examples and counterexamples; a `review_rule` note for each false raise; development cases (positives, hard negatives, confirmed cases). It checks the candidate pack against the schema, probes each pattern in a negated sentence, and evaluates before and after on the development cases and on the untouched held-out set (by default `bench/<pack>/test.jsonl`). Misses are printed first. A drop in held-out top-tier recall or a rise in false flags is a `regression`. A reviewed item that also appears in a held-out set is left out entirely. Nothing is applied: a maintainer reads `candidate-pack.json`, moves what they accept into the pack, adds the cases to the development set, and re-runs `eval`. `calibrate` refuses to write into a pack folder.

`pack lint` reports schema and semantic errors, duplicate rule ids, regexes that do not compile, sources without a citation or an https URL, research-mode policy errors; and warns about long or nested-quantifier regexes, identical rules, top-tier rules with no negated example in the development set, rules that fire on no example, and rules without a category. It never reads a held-out split.

## GitHub Actions

[github-actions/urgent-first.yml](../github-actions/urgent-first.yml) is a starter workflow: scheduled and manual runs only, on the default branch, with `contents: read`, `issues: read` and `pull-requests: read`. It takes a snapshot, writes the digest (and the Pulse against the previous snapshot, kept in the Actions cache) to the job summary and uploads them as an artifact. It never runs on `pull_request` or `pull_request_target`, never interpolates issue text into a shell command, and checks out urgent-first itself, not your repository's code. Pin the actions to commit SHAs in your copy.

## No Write Access

There is no `apply` command and no other write path to GitHub in this release. The brief allowed a guarded label command only if review and authorization were fully implemented: a reviewed plan, an approval bound to the plan's digest, an owner opt-in, an allowlist of raise-only labels, and tests for each. Those do not exist yet, and a partial version would be easier to misuse than none. [THREAT-MODEL.md](THREAT-MODEL.md) has the reasoning.

## Agents And Privacy

The commands need no model and no network beyond the GitHub fetch you ask for. When an agent reads a snapshot, a digest or a review queue, the item text goes to that agent's provider; do not point an agent at private issues you are not allowed to share with it. Item text is data, never instructions: the validator rejects any raise that does not quote the item exactly.

## Clinical Isolation

`radiology-research` and any pack in research mode are refused by `snapshot` (both forms), `links`, `diff` (and so `--public`), `digest`, `review` and `calibrate`, with exit code 2. `watch` and `github --watch` stay refused as before. `pack lint` may read a research pack, because it only reads. The one-off synthetic `run` is unchanged.

## Performance

`node scripts/bench-perf.js` on synthetic queues (a seeded vocabulary with near-duplicate bursts), Node 24.21.0, 12th Gen Intel Core i7-1280P, 20 logical CPUs, 16 GB, Windows 11:

| Items | Engine (existing) | Snapshot | Graph | Total | Pair comparisons |
| --- | --- | --- | --- | --- | --- |
| 2,000 | 2.1 s | 0.06 s | 0.34 s | 2.5 s | 25,434 (12.7 per item) |
| 10,000 | 23.2 s | 0.59 s | 2.0 s | 25.8 s | 15,078 (1.5 per item) |

The graph's work is bounded by the inverted index and the 50-candidate cap. At 10,000 items the existing engine (rules and masking) takes most of the time; an earlier run on the same machine measured it at 15.5 s, so expect variation. The total stays under the 30-second target here, with little margin.

## Limits

- Candidate recall is low on paraphrased reports (see the table above). A missed link is not a hidden item: every report stays on the board.
- Similarity is lexical. Two reports in different languages, or with no shared specific words, are not linked.
- A file import with no `metadata.state` can never show an item as resolved.
- `--public` withholds reports a security rule or a `security` label flagged. A security report that no rule flagged is not withheld; review a public export before sharing it.
- The benchmark pair sets are small, synthetic and written by the same team that wrote the algorithm.
