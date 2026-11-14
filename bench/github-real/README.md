# Real-World GitHub Benchmark

229 real issues from six popular public repositories. The gold label is the urgency label the repository's own maintainers applied. The repository holds **no issue text** beyond the short quoted spans of the review pass: `ids.jsonl` has one line per item with `owner/repo#number`, the gold tier and the label that set it, and `annotations.heldout.jsonl` and `annotations.dev.jsonl` hold the reviewer's raises (26 lines, 1 to 4 quotes of at most 105 characters each). `bench-fetch` downloads the text into your user cache folder, outside the repository.

## Run It

```bash
node scripts/urgent-first.mjs bench-fetch bench/github-real/ids.jsonl   # about 19 API requests, cached
node scripts/bench-real.js                                              # the tables below
node scripts/urgent-first.mjs eval github-maintainer <cache>/github-real/items.jsonl --templates <cache>/github-real/items.templates.json
```

`bench-fetch` uses `GITHUB_TOKEN` (or `GH_TOKEN`) when set. Without a token it fits in the anonymous limit of 60 requests an hour: one request per repository and label for the list pages, one per item not found on them, and one per repository for its issue templates. Responses are cached, so a second run makes no request. The cache is `%LOCALAPPDATA%\urgent-first\cache` on Windows, `~/Library/Caches/urgent-first` on macOS and `$XDG_CACHE_HOME/urgent-first` (or `~/.cache/urgent-first`) elsewhere; `URGENT_FIRST_CACHE` or `--cache DIR` overrides it.

## Labels Are Stripped

The input to the engine has every label removed, and the milestone too. The question this benchmark asks is: **from the words alone, do the rules put the issues the maintainers marked urgent on the Discuss First list, and keep the others off it?** Leaving the labels in would answer it for them: the `github-maintainer` pack's label floor reads `P0`, `security`, `regression` and `critical` directly, so a labelled issue would score without any rule reading a word. In real use the labels are kept, and an issue a maintainer has already labelled is placed by its label; the rules matter most for the issues nobody has labelled yet, which is what this measures.

## How The Gold Is Defined

| Repository | Urgent label (gold) | Not-urgent label (gold T3) | Split |
| --- | --- | --- | --- |
| vitejs/vite | `p5-urgent` (T1), `p4-important` (T2) | `enhancement` | dev |
| nodejs/node | `regression` (T2) | `feature request` | dev |
| flutter/flutter | `P0` (T1) | `c: new feature` | held out |
| rust-lang/rust | `P-critical` (T1) | `C-feature-request` | held out |
| kubernetes/kubernetes | `priority/critical-urgent` (T1) | `kind/feature` | held out |
| python/cpython | `release-blocker` (T1) | `type-feature` | held out |

Selection, fixed before any result was seen: for each repository and label, the newest issues (open or closed) on the first page of `GET /repos/{owner}/{repo}/issues?labels=...&state=all&sort=created&direction=desc&per_page=100`, pull requests and bot-filed issues skipped, up to 20 per label (7 `p5-urgent` and 13 `p4-important` for Vite). A not-urgent item is skipped if it also carries an urgency label. Kubernetes had only 10 `kind/feature` issues on that page and CPython 19 `release-blocker` issues: 229 items, 119 urgent and 110 not.

"Urgent" means gold T1 or T2; an item is "flagged" when the rules place it above T3. Precision is the share of flagged items that are urgent, recall the share of urgent items that are flagged, both with Wilson 95% intervals; the false-flag rate is the share of not-urgent items that are flagged. Precision is what a maintainer feels: of the items on the Discuss First list, how many deserved to be there.

## Procedure

1. The repositories were split before any run: Vite and Node.js for development, the other four held out.
2. The labels and the selection rule above were chosen from label counts only (the search API's `total_count`), not from issue text.
3. The masking defaults (a line in at least 20% of the items of one kind, and in at least 5 of them) were set before any real-world data was run. The pull request link reading was corrected after looking at the three live repositories in `CHANGELOG.md` (not part of this benchmark): "Fixes #101" and "Fixes #202" normalise to the same line, so boilerplate masking hid every link, and links now read the text with only HTML comments removed.
4. The development repositories were run, before and after. Nothing changed: no rule and no setting was tuned on them.
5. The held-out repositories were run once, and are reported as they came out.
6. After that run, two changes were made that were found on a live repository's board, not on this benchmark: a "Fixes #N" line is never masked, and the review queue lists masked lines. Every number was recomputed; none changed.
7. On 2026-11-14 the review step was run once on each split, with the rules and `review.md` unchanged (see "Rules + Claude Review" below). The synthetic benchmarks discount their review rows because the reviewer's model family also wrote the cases; that objection does not apply here, because the gold labels are the maintainers' own.

## Results

"Before" is `before-pack/` (the github-maintainer rules frozen before template masking and pull request inheritance, without templates); "after" is the bundled pack with each repository's issue templates; "after + Claude review" is the after rules followed by one blind Claude review pass, merged with `urgent-first merge`. All numbers are generated by `node scripts/bench-real.js --write`; `results.json` also lists the predicted tier of every item before, after and after review, and the review's validation counts.

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

How to read it:

- **Masking changed nothing here.** The rules flag the same 81 of 229 issues before and after. The repositories' issue forms were masked (hundreds of template lines), but on these issues no flag came from template text: the false flags come from the reporters' own technical vocabulary (the quoted words include "corrupted", "0 Bytes", "malicious", "frozen", "panic", "hash mismatch", "not possible"). Masking does change boards with pull request checklists and pasted system information (the three live repositories in `CHANGELOG.md`), which this sample of labelled issues does not contain.
- **Pull request inheritance is not measured here**: the benchmark has issues only, because maintainers label issues, not the pull requests that fix them.
- **Recall is low on held-out repositories** (about 4 in 10 urgent issues flagged). Most of Flutter's `P0` issues in this sample track flaky tests in its own CI, which the pack has no rule for and which are not the user-facing urgency it was written for; Flutter alone recalls 2 of 20.
- About 3 in 10 flagged items were not labelled urgent, a false-flag rate near 1 in 5 on feature requests.
- **The review pass raised recall without costing precision**: held out, 33 → 44 of 79 urgent issues flagged (41.8% → 55.7%), precision 68.8% → 74.6%, false flags unchanged at 15 of 70; development, 25 → 35 of 40, precision 75.8% → 81.4%, false flags unchanged at 8 of 40. Every one of the 26 raises landed on an issue the maintainers labelled urgent. The false-flag rate cannot fall: annotations only raise, so the rules' 15 false flags stay.

## Rules + Claude Review

Run once on 2026-11-14 by `claude-opus-5-5` (Claude Opus 5.5), one fresh subagent per split, after the rules-only results above were published. The procedure is the `SKILL.md` flow 1, steps 3 and 4:

1. **Rules.** Per repository, the after rules ran on that repository's 30 to 40 issues as `urgent-first github` runs them: the bundled `github-maintainer` pack, the repository's issue templates, every label and the milestone stripped. (The run folders came from the same `executeRun` call `urgent-first github` makes, fed the fetched items instead of a live listing; linked-issue fetching does not apply, as the benchmark has no pull requests. Every item's tier equals the published "after" row.)
2. **Queue.** `urgent-first annotate-template <run>` wrote the default review queue, not `--only-unmatched`: every item below T1, plus T1 items with a negated, historical or spelling-tolerant-only mention. Held out: 134 of 149 issues (Flutter 40, Rust 38, Kubernetes 26, CPython 30). Development: 67 of 80 (Vite 33, Node.js 34).
3. **Blind review.** For each split, one fresh subagent, with no conversation history, got a folder outside the repository holding only the queue files (`review.md` and `review.jsonl` per repository), copies of `packs/github-maintainer/review.md` and `references/annotation-contract.md`, and empty `annotations.jsonl` files to write. It was told to open nothing else, to fetch nothing from GitHub or the web, and to follow `review.md` exactly. It never saw a gold label, `ids.jsonl`, `splits.json`, `results.json` or this README; it reported opening nothing outside its folder and making no network request. As a real session would after a rejected merge, it could check that each quote is an exact substring of the queue text.
4. **Merge.** `urgent-first merge <run> annotations.jsonl` per repository. Held out: 15 lines, 15 accepted, 0 rejected, all 15 raised a tier (9 to T1, 6 to T2). Development: 11 lines, 11 accepted, 0 rejected, all raised a tier (2 to T1, 9 to T2).
5. **Score.** Against the maintainers' labels, by `scripts/bench-real.js`. Nothing was tuned: `review.md`, the rules and the annotations are as they came out. Both splits were reviewed at the same time, so the development result was not used to adjust anything before the held-out review.

What it did, held out:

- **All 15 raises were on gold-urgent issues.** 11 issues the rules had not flagged were added (a Flutter tool that no longer compiles on master, two Rust miscompilations, a Rust tier 1 target whose CI was turned off before a release, a rustdoc search regression, a failing required verify job, two regressions and a kubelet that will not start after a restart in Kubernetes, two CPython regressions in bugfix releases). 4 issues the rules had at T2 went to T1 (three Rust miscompilations, the expired Kubernetes package-repository certificate). Gold T1 placed at T1 went from 17 to 26 of 79.
- **No feature request was raised**: all 66 below T1 were in the queue (55 unflagged, 11 at T2), and the reviewer raised none of them. This is the easy side of the benchmark (see Limits), so it is weak evidence about the review's precision on a real queue of non-urgent bug reports.
- **It placed 6 of the 15 at T2**, below the gold T1: they count as flagged (recall) but not as T1 caught. It counted a compiler emitting wrong code as data corruption (T1, rule `LLM`), and raised two CI failures only because their text says they block a release or merges.
- **Recall is still 55.7%.** Flutter went from 2 to 3 of 20: its `P0` issues here are mostly flaky tests and broken benchmarks in its own CI, which `review.md`'s tier table does not cover either, so the reviewer left them (it named one broken-benchmark issue it chose not to raise). 35 urgent held-out issues are still unflagged.

Development, for comparison: all 11 raises were on gold-urgent issues; Vite 13 → 18 and Node.js 12 → 17 of 20 urgent. Two gold T1 Vite issues were raised only to T2, and two gold T2 Node.js issues went to T1.

**Possible memory of the issues.** The reviewing model's training data ends in June 2026. 24 of the 149 held-out issues (all of them urgent) were filed before July 2026, and their labels may have been public then; 6 of the 15 held-out raises are on those issues. On the 125 held-out issues filed from July 2026 on, which no training data can contain, recall went from 21 to 28 of 55 urgent issues (38.2% → 50.9%) and precision from 58.3% to 65.1%, with false flags unchanged at 15 of 70: a gain of 12.7 points of recall, against 13.9 on the whole split and 16.7 (12 → 16 of 24) on the older issues.

## Limits

- Maintainers label inconsistently, within one repository and across them: `P0` in Flutter and `release-blocker` in CPython mean different things, and an unlabelled urgent issue cannot be told apart from a not-urgent one, so only explicitly labelled issues are used.
- Closed issues may have been edited after they were labelled, including by maintainers, and the text fetched today is not the text at triage time.
- A label is not the same as urgency at the time of filing: `release-blocker` can be added weeks later when a release approaches, and `regression` is often added after investigation, from facts not in the first report.
- The not-urgent side uses feature-request labels, which are easier to tell apart than the real mix of an open-issue queue. Precision on a real board is lower than here (the live repositories in `CHANGELOG.md` show it).
- Six repositories and 229 items: the intervals are wide.
- The review pass is one session of one model per split. Another run, or another model, would raise a somewhat different set; the review rows measure that session, not a fixed property of the pack.
