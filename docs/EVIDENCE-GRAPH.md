# Evidence Graph

`evidence-graph.json` is written next to every snapshot and printed by `links --json`. It is for navigation and provenance only: no node or edge has a tier or a priority, and building it never changes the snapshot. JSON Schema: [schema/evidence-graph.v1.schema.json](../schema/evidence-graph.v1.schema.json).

## Nodes

| Type | Id | Fields |
| --- | --- | --- |
| `issue`, `pull_request`, `item` | the item's identity | `localId`, `number` |
| `evidence` | the evidence id | `itemId`, `ruleId`, `kind` |
| `release` | `release:<tag>` | `tag`, `publishedAt`, `source` |

## Edges

Every edge has `id`, `from`, `to`, `type`, `certainty` and `algorithm`. The id is `edge-` plus 16 hex digits of the digest of `(type, from, to, algorithm)`, so it is the same in every run and every input order.

| Type | From, to | Certainty | Algorithm | Support |
| --- | --- | --- | --- | --- |
| `contains_evidence` | item, evidence | direct | `engine-evidence-v1` | the quote with field and offsets |
| `fixes` | pull request, issue | direct | `github-references-v1` | the quote, such as "Fixes #713" |
| `references` | item, item | direct | `github-references-v1` | the quote, such as "#702" |
| `reported_after_release` | item, release | direct | `release-timestamp-v1` | `createdAt` and `publishedAt`, with the note that this is not a cause |
| `possible_duplicate` | item, item | candidate | `text-signals-v1` | `score` and `reasons` (shared words, shared error identifiers) |
| `same_symptom` | item, item | candidate | `text-signals-v1` | `score` and the shared error signature |

A reference to an item outside the snapshot, or to another repository, draws no edge and is listed under `unresolvedReferences`. When a pull request both fixes and mentions an issue, only the `fixes` edge is kept.

A human decision on a candidate link lives in a review file, never in the graph; a confirmed link never removes or merges an item.

## Clusters

A cluster is a star: an anchor and the items with a candidate link to that anchor. Anchors are chosen by number of links, then total score, then identity. Membership says nothing about two members' similarity to each other (A may describe the same problem as B, and B as C, without any claim about A and C). Every member keeps its own tier and its place on the board.

## Suppressed Candidates

A pair that passed the thresholds but where one report affirms what the other negates is not linked. It is listed under `suppressedCandidates` with `reason: "conflicting_evidence"` and the conflicts: the rule and both quotes, or the shared word that one report only affirms and the other only negates.

## Integrity Checks

`src/graph/validate.js` runs in `links`, `digest` and the tests:

- every edge refers to known nodes, and its id matches its digest;
- every `contains_evidence`, `fixes` and `references` quote reproduces the original text exactly;
- a `fixes` edge starts at a pull request;
- a `reported_after_release` edge has `createdAt` at or after `publishedAt`;
- candidate edges are `candidate`, of a candidate type, with a score from 0 to 1;
- no node or edge carries a tier or a priority;
- no item has more than 5 candidate links;
- every cluster member has a direct candidate link to its anchor.

Property tests (`tests/graph.test.js`) also check that the same collection in any input order gives the same edges and clusters, that repeated builds are byte-identical, and that the snapshot is unchanged by building its graph.
