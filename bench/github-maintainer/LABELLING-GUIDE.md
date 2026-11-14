# GitHub Maintainer Benchmark: Labelling Guide

This guide defines how every case in `bench/github-maintainer/` is written and labelled. It is the shared policy for case writers and for rule authors. Rule authors read this guide and the `dev` split only.

All cases are synthetic. They are invented issues and pull requests for a fictional open-source project, `acme/widget`, a desktop and command-line tool for editing and syncing "projects" (files stored locally and optionally synced to a cloud account). They are not copied from, adapted from or modelled on any real person's issue.

## Item Format

One JSON object per line (JSONL), UTF-8:

```json
{"id":"gh-a-001","synthetic":true,"title":"Data loss after upgrade to 3.2","text":{"body":"..."},"labels":["bug"],"priority":null,"created_at":"2026-09-14T10:02:00Z","source":"github","url":"https://github.com/acme/widget/issues/812","metadata":{"type":"issue","number":812,"comments":4,"reactions":11,"latest_release":"3.2.0"},"gold":{"tier":"T1","category":"data_loss","rationale":"User reports \"lost all my saved projects\" after upgrading."}}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique, lowercase, prefix given to the writer (for example `gh-a-001`). |
| `synthetic` | Always `true`. |
| `title` | The issue or pull request title, written the way real users write them (sometimes vague, sometimes shouting). |
| `text.body` | The body in GitHub Markdown: steps, logs, stack traces, version lines, templates left half-filled. 100 to 1,500 characters. |
| `labels` | Labels a maintainer or an issue template applied: usually `[]`, `["bug"]`, `["enhancement"]`, `["question"]`, `["needs-triage"]`, `["documentation"]`. Use `security`, `P0`, `critical` or `regression` labels only occasionally (they set a floor, see below). |
| `priority` | Always `null` (GitHub has no priority field). |
| `created_at` | ISO 8601 with `Z`, between 2026-06-01 and 2026-10-31. |
| `url` | `https://github.com/acme/widget/issues/<number>` or `/pull/<number>`. |
| `metadata.type` | `issue` or `pull_request`. |
| `metadata.number` | Unique number between 500 and 999. |
| `metadata.comments`, `metadata.reactions` | Small integers. |
| `metadata.latest_release` | Always `"3.2.0"` (the latest release of the fictional project; 3.1.x is the previous line). |
| `gold.tier`, `gold.category`, `gold.rationale` | See below. The rationale is one line that quotes or names the words that drive the label. |

Never use real people's names or handles, real company names, real repository names (other than the fictional `acme/widget`) or real vulnerability identifiers. Fictional `CVE-2026-0xxxx` style placeholders are fine only if clearly invented. Follow the wording rules in CONTRIBUTING.md.

## Tiers

| Tier | Name | Meaning |
| --- | --- | --- |
| T1 | Discuss now | A maintainer should look at this before anything else today. |
| T2 | Today | Real harm or a broken workflow for some users; handle soon. |
| T3 | In order | Everything else, in the normal order. |

### Floor Rule

Labels applied by maintainers set a floor. The gold tier must be at least as urgent as the floor:

- A label containing `security`, `P0`, `critical` or `sev1` sets a floor of T1.
- A label containing `P1`, `regression` or `high-priority` sets a floor of T2.

Words in the title or body ("URGENT", "critical!!!", "ASAP", "blocker") do not set a floor. They are user words, not maintainer labels.

## Categories

### T1 Categories

- `security`: a vulnerability report (one user can read or change another user's data, token or secret exposure, injection, path traversal, remote code execution, authentication bypass, unsafe deserialisation, a malicious or compromised dependency or release artefact).
- `data_loss`: user data deleted, overwritten, corrupted or made unrecoverable by the software (lost projects, sync wiped files, database corrupted after migration, backups empty).
- `regression_latest_release`: something that worked in 3.1.x is broken in 3.2.0 and blocks normal use for many users.
- `startup_crash`: the app or CLI crashes or refuses to start for everyone or for a whole platform.
- `build_or_install_broken`: the main branch build is broken, the published package cannot be installed, or the release is missing files.
- `floor_only`: a T1 label with no T1 content (rare).

### T2 Categories

- `crash_specific`: a crash, hang or freeze in a specific scenario with no data loss.
- `regression_older`: a regression in an older release line, or a minor regression in 3.2.0 with a workaround.
- `broken_feature`: an important feature broken for some users with no workaround.
- `performance_severe`: a severe slowdown or memory blow-up that makes the tool unusable for some users.
- `pr_fix_for_t1`: a pull request that fixes a T1 problem (security fix, data-loss fix, build fix).
- `floor_only`: a T2 label with no T2 content.

### T3 Categories

- `feature_request`
- `question`
- `documentation`: typos, docs improvements.
- `duplicate`: says or implies it duplicates another issue and adds nothing urgent.
- `minor_bug`: cosmetic or minor bugs with a workaround.
- `urgent_words_only`: shouts "URGENT", "critical", "ASAP", "blocker", "production down!!!" but the content is a feature request, a question or a minor issue.
- `negated_mention`: urgent-sounding words that are negated or ruled out ("no data was lost", "not a security issue", "this does not crash", "the CVE scanner false positive was confirmed").
- `look_alike`: urgent words with a different meaning ("crash course" in docs, "lost connection" retry message wording, "security policy" page typo, "deleted a branch" in a PR description, "token" in a tokenizer feature).
- `routine_pr`: a pull request for a feature, refactor, docs or dependency bump.

## Hard Cases Writers Must Include

Per 100 cases:

- About 30 T1, 25 T2 and 45 T3.
- At least 8 `urgent_words_only` cases.
- At least 8 `negated_mention` or `look_alike` cases.
- At least 6 T1 cases where the urgent fact is buried in a long body or a log, not in the title.
- At least 6 T1 cases described in plain words without the obvious keyword ("after updating, my whole notes folder is empty and the trash is empty too").
- At least 6 cases mentioning versions (3.2.0, v3.2, 3.1.4) in different forms.
- At least 5 cases with typing errors or non-native English.
- At least 6 pull requests.
- A few duplicates of urgent issues ("same as #812") which are still T1 if they add a new urgent fact, and T3 if they add nothing.
