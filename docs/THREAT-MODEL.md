# Threat Model

urgent-first reads text that strangers write (issues, pull requests, tickets) and shows it to maintainers and their agents. This page lists what can go wrong with the Maintainer Radar commands and what stops it. Each control names the test that checks it.

## Assets

- The maintainer's GitHub repository and its labels, issues and pull requests.
- Private issue text in private repositories, and security reports.
- The maintainer's token (`GITHUB_TOKEN` or `GH_TOKEN`).
- The integrity of the board: no item lowered, hidden or merged away.
- Clinical safety: the radiology research pack must never be used on real patients.

## Threats And Controls

| Threat | Control | Test |
| --- | --- | --- |
| A bot or a misused command changes the repository | No write path exists: no `apply`, no label, comment, close or edit request anywhere in the source; every GitHub request is a GET | `tests/action-security.test.js` |
| The Actions workflow is turned against the repository | Read-only permissions, schedule and manual triggers only, default branch only, no `pull_request` or `pull_request_target`, no issue text in shell commands, `persist-credentials: false` | `tests/action-security.test.js` |
| Issue text instructs the agent ("ignore your rules", "run curl") | Item text is data. Raises need exact quotes from the same item, checked by the validator; a review `missed_raise` without an exact quote is rejected | `tests/review.test.js`, `tests/pulse.test.js` |
| Issue text injects HTML or script into the Pulse or digest | Every value escaped; links only for http(s) URLs, with `rel="noopener noreferrer"`; a CSP with `default-src 'none'`, the one inline script allowed by its hash, no `unsafe-inline` script, images only from `data:` | `tests/pulse.test.js`, `tests/e2e/pulse.e2e.js` |
| Tracking images or remote CSS in issue text | Markdown is never rendered; the page loads nothing from the network | `tests/e2e/pulse.e2e.js` aborts and records every request |
| A similar-looking report hides or lowers an urgent one | Links never change tiers; every member of a group stays on the list; a negated report is not grouped with an affirmative one | `tests/graph.test.js` |
| A release is blamed without evidence | "Reported after release" only, from API timestamps; the word "caused" never appears | `tests/pulse.test.js` |
| A partial collection is read as complete | `status: partial` with a reason, on the snapshot, the Pulse and the digest; no resolution claims | `tests/snapshot.test.js`, `tests/pulse.test.js` |
| Items from different repositories are matched by number | Identity includes the repository; `diff` refuses unrelated sources | `tests/pulse.test.js` |
| A snapshot is edited to change history | `snapshotId`, content digests and evidence spans are re-verified on every load | `tests/snapshot.test.js` |
| The token leaks | Never logged, never written; `collection.json` records only whether a token was used | `tests/snapshot.test.js`, `tests/action-security.test.js` |
| Output written outside the chosen folder, or through a link | Writes resolve inside the output folder, refuse links, use a temporary file and rename, and do not replace a snapshot without `--force` | `tests/action-security.test.js` |
| Private text shared by mistake | A Pulse has no item bodies; `--public` needs synthetic data or `--allow-real-public-export`, clips quotes and withholds flagged security reports | `tests/pulse.test.js` |
| Review feedback tunes the held-out set | `calibrate` excludes reviewed items that appear in a held-out set; `pack lint` never reads a held-out split; proposals are never applied | `tests/review.test.js` |
| The research pack drifts into clinical use | Every Maintainer Radar command refuses research packs (exit 2); watch stays refused | `tests/action-security.test.js` |

## Why There Is No Apply Command

The release brief allowed an `apply --plan --approve <digest>` command that adds allowlisted, raise-only labels, but only if review and authorization were fully implemented. That needs, each with tests: a plan file bound to one snapshot and one repository; an approval that names the plan's digest; an owner opt-in stored in the repository; an allowlist of labels that can only raise; rate limiting and an audit log; and a token with `issues: write` used by nothing else. None of that exists yet. A partial version (labels without a bound approval, or approval without an audit log) would be a write path that a prompt-injected agent or a copied command line could trigger. Until the whole set is built and tested, the safe release is one with no write capability at all.

## Residual Risks

- A security report that no rule or label flags is not withheld from a `--public` export. Review a public export before sharing it.
- An agent that reads a digest sends the item text to its provider.
- The Actions artifact and job summary contain issue titles and quotes; anyone with read access to the repository's Actions can read them.
- Similarity is lexical and can miss real duplicates; the Pulse never hides an item because of it, but a reader may assume a group is complete when it is not.
