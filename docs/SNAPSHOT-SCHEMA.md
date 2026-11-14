# Snapshot Schema

`urgent-first snapshot` writes three files into its output folder. JSON Schema: [schema/snapshot.v1.schema.json](../schema/snapshot.v1.schema.json).

| File | Deterministic | Contents |
| --- | --- | --- |
| `snapshot.json` | yes | the manifest below |
| `evidence-graph.json` | yes | the evidence graph ([EVIDENCE-GRAPH.md](EVIDENCE-GRAPH.md)) |
| `collection.json` | no | when it was collected, how long it took, the rate limit left, whether a token was used (never the token), why a collection stopped |

## Determinism And Digests

- `snapshotId` is `sha256:` plus the SHA-256 of the canonical JSON of the manifest without `snapshotId`. Canonical JSON: object keys sorted at every depth, arrays in their order, no whitespace. Key order and indentation on disk do not change the id.
- Nothing in `snapshot.json` reads the clock or names a local path. The engine runs with no `now`, so wait times are not part of a snapshot.
- `pack.digest` is the digest of the canonical JSON of the pack's `pack.json`.
- `items[].contentDigest` is the digest of what the engine reads: title, text fields, labels, priority and location. Comment counts, reactions and `updatedAt` are recorded but not digested.
- Loading a snapshot (`links`, `diff`, `digest`, `review`, `calibrate`) recomputes the id, every content digest and every evidence span. Any mismatch is refused with exit code 1.
- The file is written to a temporary name and renamed, with mode 0600 where the platform supports it, inside the output folder only and never through a link. An existing snapshot is replaced only with `--force`.

## Manifest

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `kind`, `engineVersion` | `1`, `urgent-first-snapshot`, the engine version |
| `status` | `complete` or `partial` |
| `pack` | `id`, `version`, `digest`, `mode`, `tiers` |
| `source` | `kind` (`github` or `file`), `repository` or `input`, `scope` (`{state, limit}` for GitHub, `{kind: "file"}` for a file), `complete`, and when incomplete `reason` and `continuation`; `pageCount`, `templateFiles` and `linkedIssuesFetched` for GitHub |
| `release` | only when the GitHub API returned a latest release: `tag`, `publishedAt`, `source: "github-release-api"`, `url` |
| `counts` | the engine's counts: `total`, `flagged`, `unmatched`, `by_tier` |
| `items` | one per item, in the original input order |
| `evidence` | one per evidence span |
| `warnings` | diagnostics, below |

### Partial Reasons

| Reason | When |
| --- | --- |
| `rate_limit` | a page after the first answered HTTP 403 or 429 with the rate limit exhausted or a Retry-After |
| `pagination_failed` | a page after the first failed for another reason (network, HTTP error) |
| `missing_permission` | a page after the first answered HTTP 401 or 403 without a rate limit |
| `limit_reached` | `--limit` stopped the listing while the API offered another page (an addition to the brief's list) |
| `filter_applied` | reserved for a filtered collection; `--state open` is recorded as the scope instead, because the scope is what the snapshot claims to be complete for |

A failure on the first page is an error (exit code 3), as with the `github` command: there is nothing to show.

### Items

| Field | Meaning |
| --- | --- |
| `id` | stable identity: `github:<owner>/<repo>:<issue\|pull>:<number>` for GitHub, `item:<source or "local">:<id>` otherwise. The adapters require an explicit id on every item, so no identity is a guess. |
| `localId` | the id the board shows (`#812`, `T-9`) |
| `kind`, `number`, `state`, `url`, `synthetic` | from the source |
| `title`, `text`, `labels`, `priority`, `location` | the original, unmodified text |
| `createdAt`, `updatedAt` | from the source |
| `originalOrder`, `originalPriority` | input position and the item's own priority field |
| `floorTier`, `effectiveTier`, `boardPosition` | from the engine, unchanged |
| `ruleIds`, `evidenceIds` | rules that matched, and the evidence spans |
| `suppressed` | rule mentions that did not count (negated, historical), with their spans |
| `masked` | template and boilerplate ranges the rules did not read |
| `unknownPriority`, `afterLatestRelease` | when present |
| `contentDigest` | see above |

### Evidence

`{ id, itemId, ruleId, tier, category, field, start, end, text, kind, context }`. `kind` is `direct_quote` (a rule), `inherited_link` (a pull request's "Fixes #N", with `linked`), `floor_label` or `floor_priority`. Offsets are UTF-16 code units into the original field, the same as the engine and the annotation validator: `field.slice(start, end) === text` always holds, including after emoji and CRLF line ends.

### Warnings

Each warning is `{ code, severity, message, itemIds }`.

| Code | Meaning |
| --- | --- |
| `partial_source` | the collection is partial; counts cover only what was collected |
| `rate_limit_truncation` | it stopped at a GitHub rate limit |
| `unknown_release` | a GitHub source returned no latest release; no "reported after release" marker is shown |
| `unknown_priority` | an item's priority is not in the pack's floor map and set no floor |
| `ambiguous_negation` | an item mentions a top-tier rule's words negated or historical; read it by hand |
| `excessive_template_masking` | at least 60% of an item's text was masked as template or boilerplate |
| `missing_category` | a rule without a category matched |
| `input_warning` | an adapter warning while reading a file |
| `evidence_mismatch` | (review check) a quote that is not an exact substring |
| `config_changed`, `scope_mismatch` | (diff) the pack or engine changed; the scopes differ |
