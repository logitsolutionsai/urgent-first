# github-maintainer

The flagship pack: point it at any public GitHub repository and the issues and pull requests a maintainer should discuss first come to the top, each with the exact words that put it there.

```bash
node scripts/urgent-first.mjs github owner/repo
```

## What Comes First

| Tier | Name | What lands here |
| --- | --- | --- |
| T1 | Discuss now | Security reports, data loss, a regression in the latest release with no workaround, the app or CLI not starting, a broken build or install. |
| T2 | Today | Crashes and hangs in one situation, regressions with a workaround or in older releases, important features broken with no workaround, severe slowdowns, pull requests that fix a T1 problem. |
| T3 | In order | Everything else, under "No rule matched", in the order GitHub returned it (newest first). That does not mean not urgent. |

Floors from maintainer labels: a label containing `security`, `P0`, `critical`, `sev1`, `data-loss` or `data loss` keeps an item in T1; `P1`, `regression`, `high-priority` or `priority: high` keep it at least in T2. Words in the title or body such as "URGENT", "ASAP" or "blocker" set nothing: they are the reporter's words, not facts.

The pack sets no turnaround targets; inside a tier, items are ordered by how long they have been open. Add `sla_minutes` to a tier in `pack.json` if your project has targets.

## Rules

| Rule | Tier | What it looks for | Source |
| --- | --- | --- | --- |
| SECURITY | T1 | Vulnerability words, one user reading or changing another's data, code execution, exposed tokens or passwords, a checksum mismatch | [GitHub Docs: privately reporting a vulnerability](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability); [OWASP Top 10:2025](https://owasp.org/Top10/2025/) |
| DATA-LOSS | T1 | Lost, deleted, wiped, overwritten or corrupted files, projects, history or data | This pack's policy |
| REGRESSION-LATEST | T1 | A mention of the latest release with "after updating", "worked in", "since 3.2.0" or "since it updated" and a blocking failure, and no workaround (a bare "since", which usually means "because", does not count) | [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) |
| STARTUP-CRASH | T1 | Will not start, crashes on launch, segfault on every command | This pack's policy |
| BUILD-OR-INSTALL-BROKEN | T1 | Main does not build, CI red, package cannot be installed, release artefact missing or empty | This pack's policy |
| PR-FIXES-URGENT | T1 or T2 (inherited) | A pull request that says "Fixes #N", "Closes #N" or "Resolves #N" takes the tier issue #N has from its own rules and labels. The quote is the "Fixes #N" span and the board names the linked issue and its rule. Issue #N must be in the run, or is fetched (at most 10 a run, never the last 10 API requests of the hour). Links do not chain | This pack's policy |
| CRASH-OR-HANG | T2 | Crash, hang, freeze, panic, "not responding", "unresponsive" (not "crash reporter", which VS Code-style issue reporters print in every system-information table) | This pack's policy |
| REGRESSION | T2 | "Used to work", "stopped working", "regression" in any release (not "regression test") | [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) |
| BROKEN-NO-WORKAROUND | T2 | "Only option", "is ignored", "no workaround", "cannot use it at all", "fails:" with its colon | This pack's policy |
| PERFORMANCE-SEVERE | T2 | Memory leak, out of memory, 100% CPU, minutes to open | This pack's policy |

"This pack's policy" rules link to this section: they encode common maintainer practice, not an external standard. The content rules read issues only: a pull request describes the bug it fixes, so its tier comes from its labels and from the issue it fixes (`inherit` in `pack.json`). The latest release comes from the repository's `/releases/latest`.

Negated mentions do not count: "no data was lost", "this is not a security issue", "confirmed false positive", "no crash".

## Masking

On GitHub input the pack masks text the reporter did not write for this item (`masking` in `pack.json`):

- **Template lines**: lines of the repository's issue and pull request templates (`.github/ISSUE_TEMPLATE/*.md|*.yml`, `pull_request_template.md` in `.github`, the root or `docs/`): prompts, headings, checklist lines, issue-form labels, descriptions and default values. A line that starts with a template prompt keeps the reporter's answer after it. Dropdown options are never masked: the option a reporter picked is their answer. One API request per repository, cached for a day.
- **Boilerplate lines**: a line that appears, after normalisation (case, spacing, markdown markers, digits and hashes), in at least 20% of the items of the same kind (issues, pull requests) in a run and in at least 5 of them, such as a pasted system-information table or a bot footer. A boilerplate line that a T1 rule matches on its own is never masked.

Titles and "Fixes #N" lines are never masked, and masked text stays on the board, dimmed and marked "template text, not read by rules"; `urgent-first explain <run> --item ID` lists it. `--no-templates` turns template masking off for one run; `"masking": false` in a copy of the pack turns all of it off.

## Results

**Real-world benchmark** (`bench/github-real/`): 229 issues from six public repositories, gold from the maintainers' own urgency labels, labels stripped from the input. Rules only, then the after rules followed by one blind Claude review pass per split (`claude-opus-5-5`, 2026-11-14; it saw only the review queue, `review.md` and the annotation contract). Procedure: `bench/github-real/README.md`.

<!-- bench:github-real:start -->
| Split | Repositories | Rules | Items (urgent / not) | Flagged | Precision (Wilson 95% CI) | Recall of urgent (Wilson 95% CI) | False flags on not urgent | Gold T1 caught at T1 |
| --- | --- | --- | ---: | ---: | --- | --- | --- | ---: |
| dev | vitejs/vite, nodejs/node | before | 80 (40 / 40) | 33 | 75.8% (59.0% to 87.2%) | 25/40 = 62.5% (47.0% to 75.8%) | 8/40 = 20.0% (10.5% to 34.8%) | 3/7 |
| dev | vitejs/vite, nodejs/node | after | 80 (40 / 40) | 33 | 75.8% (59.0% to 87.2%) | 25/40 = 62.5% (47.0% to 75.8%) | 8/40 = 20.0% (10.5% to 34.8%) | 3/7 |
| dev | vitejs/vite, nodejs/node | after + Claude review | 80 (40 / 40) | 43 | 81.4% (67.4% to 90.3%) | 35/40 = 87.5% (73.9% to 94.5%) | 8/40 = 20.0% (10.5% to 34.8%) | 3/7 |
| heldout | flutter/flutter, rust-lang/rust, kubernetes/kubernetes, python/cpython | before | 149 (79 / 70) | 48 | 68.8% (54.7% to 80.0%) | 33/79 = 41.8% (31.5% to 52.8%) | 15/70 = 21.4% (13.4% to 32.4%) | 17/79 |
| heldout | flutter/flutter, rust-lang/rust, kubernetes/kubernetes, python/cpython | after | 149 (79 / 70) | 48 | 68.8% (54.7% to 80.0%) | 33/79 = 41.8% (31.5% to 52.8%) | 15/70 = 21.4% (13.4% to 32.4%) | 17/79 |
| heldout | flutter/flutter, rust-lang/rust, kubernetes/kubernetes, python/cpython | after + Claude review | 149 (79 / 70) | 59 | 74.6% (62.2% to 83.9%) | 44/79 = 55.7% (44.7% to 66.1%) | 15/70 = 21.4% (13.4% to 32.4%) | 26/79 |

| Repository | Items (urgent / not) | Review queue | Flagged before → after → after + review | Precision before → after → after + review | Recall before → after → after + review |
| --- | ---: | ---: | ---: | --- | --- |
| vitejs/vite | 40 (20 / 20) | 33 | 15 → 15 → 20 | 86.7% → 86.7% → 90.0% | 65.0% → 65.0% → 90.0% |
| nodejs/node | 40 (20 / 20) | 34 | 18 → 18 → 23 | 66.7% → 66.7% → 73.9% | 60.0% → 60.0% → 85.0% |
| flutter/flutter | 40 (20 / 20) | 40 | 4 → 4 → 5 | 50.0% → 50.0% → 60.0% | 10.0% → 10.0% → 15.0% |
| rust-lang/rust | 40 (20 / 20) | 38 | 20 → 20 → 24 | 75.0% → 75.0% → 79.2% | 75.0% → 75.0% → 95.0% |
| kubernetes/kubernetes | 30 (20 / 10) | 26 | 7 → 7 → 11 | 71.4% → 71.4% → 81.8% | 25.0% → 25.0% → 45.0% |
| python/cpython | 39 (19 / 20) | 30 | 17 → 17 → 19 | 64.7% → 64.7% → 68.4% | 57.9% → 57.9% → 68.4% |

| Split | Rules | Gold T1 placed T1 / T2 / T3 | Gold T2 placed T1 / T2 / T3 | Gold T3 placed T1 / T2 / T3 |
| --- | --- | --- | --- | --- |
| dev | after | 3 / 0 / 4 | 9 / 13 / 11 | 4 / 4 / 32 |
| dev | after + Claude review | 3 / 2 / 2 | 11 / 19 / 3 | 4 / 4 / 32 |
| heldout | after | 17 / 16 / 46 | none | 4 / 11 / 55 |
| heldout | after + Claude review | 26 / 18 / 35 | none | 4 / 11 / 55 |
<!-- bench:github-real:end -->

**Synthetic benchmark**, 150 issues and pull requests for a fictional project (`bench/github-maintainer/`): 60 development cases used to write the rules, 90 test cases run once afterwards. "Rules + annotations" adds a blind review pass by an AI agent that saw only the review queue, never the gold labels.

<!-- bench:github-maintainer:start -->
| Split | Mode | Items | Gold T1 | T1 caught | T1 sensitivity | Wilson 95% CI | Missed T1 | Over-triage | False flags | Kendall tau-b |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| dev | rules only | 60 | 18 | 18 | 100.0% | 82.4% to 100.0% | 0 | 7.1% | 7.4% | 0.715 |
| test | rules only | 90 | 27 | 18 | 66.7% | 47.8% to 81.4% | 9 | 15.9% | 17.1% | 0.347 |
| test | rules + annotations | 90 | 27 | 26 | 96.3% | 81.7% to 99.3% | 1 | 15.9% | 17.1% | 0.568 |

Reproduce:

```bash
node scripts/urgent-first.mjs eval github-maintainer bench/github-maintainer/dev.jsonl
node scripts/urgent-first.mjs eval github-maintainer bench/github-maintainer/test.jsonl --annotations bench/github-maintainer/annotations.test.jsonl
```
<!-- bench:github-maintainer:end -->

On the test split the rules alone missed 9 of 27 T1 issues: mostly security problems described in plain words or hidden in a pasted log (a removed teammate who can still edit, a token printed in a verbose log, a dependency that uploads environment variables), data loss under a misleading title, and a regression in the latest release described without a version-anchored "since". The blind review pass caught the first 8; it ran once against the first rules' queue, before the ninth fell out of T1, so that one is counted as missed. The reviewing model family also wrote the cases, so treat the combined number as an upper bound.

The rules were changed after the first test run to remove false positives seen on live repositories (bare "since", "session logs", "Can anyone help me change...", issue-template text such as `--crash-reporter-id`, pull-request validation boilerplate). The first run gave 19 of 27 rules-only. See `CHANGELOG.md`.

Issue-template text is never read by the rules: HTML comments (`<!-- ... -->`), which templates use for hidden instructions, and issue-form fields left empty (a `### Label` heading followed by `_No response_`).

## Rate Limits And Privacy

Without a token the GitHub API allows 60 requests an hour; one run of up to 100 issues costs 2 requests. Set `GITHUB_TOKEN` or `GH_TOKEN` for 5,000. `--watch` uses ETags, so a poll that finds nothing new is answered with 304 and does not count against the limit. Issue text stays on your machine; the agent you run reads it when you ask it to annotate.
