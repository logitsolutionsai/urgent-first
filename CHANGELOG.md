# Changelog

## 0.1.0 (2026-11-14, not yet released)

First release. The QA pass and the improvement pass below happened before anything was published, so they are part of 0.1.0.

### Engine And Command Line

- Item model and adapters: JSONL, JSON, CSV, FHIR R4 ServiceRequest bundles, HL7 v2 ORM/OMI (TQ1-9 priority first, OBR-27.6 fallback with a warning), GitHub issues and pull requests through the REST API (token optional, ETags, Link pagination).
- Pack format with a JSON Schema and semantic checks: tiers with optional turnaround settings, priority and label floors, rules with a required public source, abbreviations, numeric and clock extractors, negation, suspicion, history and experiencer cues.
- Deterministic engine: raise-only tiers, evidence spans that are exact substrings, clocks with treatment windows, ordering by tier, deadline, wait time and original order.
- Annotation layer: review queue for an agent, validator (quote-or-reject, raise-only, known tiers and rules), merge with rejected annotations listed on the board.
- Boards: `board.md` and a standalone, offline `board.html` (light and dark, readable at 390 px, highlighted evidence, research banner).
- Commands: `run`, `github` (with `--watch`), `watch`, `seen`, `annotate-template`, `merge`, `eval`, `shadow`, `shadow-report`, `explain`, `validate`, `new-pack`, `packs`.
- Research mode enforced by the engine: banner, no watch, synthetic input only, writes only inside the run folder, missing priority refused.

### Packs And Benchmarks

- `github-maintainer` (9 rules, plus pull requests inheriting the tier of the issue they fix), `radiology-research` (37 rules, research mode), `oncall` (7 rules).
- Synthetic benchmarks: 150 GitHub issues and pull requests, 300 radiology orders, 40 support tickets, each split into development and test halves, with blind review annotations for the test halves.

### Board Interface: Ink Palette And Springs (2026-11-14)

- `board.html` uses the Ink palette: warm greys and one accent (#0065FD, #5b9cff in dark) for links, focus and selection only. No red, amber, green or purple remains, and no gradient, shadow or keyframe.
- Status by weight and shape, not colour: T1 is a solid ink chip, T2 an ink outline, T3 a grey fill, "No rule matched" a dashed outline. Card bars are ink weights (T1 3 px, T2 1.5 px). Evidence highlights are a light grey wash with a 1.5 px ink underline; masked template text is faint with a dashed underline. The research banner is an ink-bordered block with the same words.
- Motion: cards, the "No rule matched" group and every "Item text" or "Other text fields" disclosure open and close on height springs that reverse from their live height when clicked again; chevrons rotate on a spring; toggles, disclosures and the count chips respond on pointer-down. Under reduced motion everything switches instantly. The springs come from the brand kit's `fluid.js`, inlined unchanged; the CSP allows the script only by its hash, and without it the page renders everything open.
- The counts are a sticky bar of chips that jump to their sections, and the bar turns translucent once the board scrolls under it.
- Tests: a palette guard (every colour is an Ink token, the accent never marks status, the CSP allows the script only by hash) and an end-to-end check that pointer-down on a card toggle applies a transform within 50 ms and that a collapse reverses mid-flight.

### Improvement Pass: Template Masking, Pull Requests Following Their Issue, A Real-World Benchmark (2026-11-14)

QA's live runs showed the rules-only board was too noisy to trust on real repositories, while the synthetic benchmark, which has no templates, checklists or pasted system information, looked better than reality. This pass adds three things and measures them honestly.

#### Template And Boilerplate Masking (`src/mask.js`)

- On GitHub input the `github-maintainer` pack (`"masking"` in `pack.json`, new in the schema) no longer reads lines of the repository's issue and pull request templates (`.github/ISSUE_TEMPLATE/*.md|*.yml`, `pull_request_template.md` in `.github`, the root or `docs/`): prompts, headings, checklist lines, issue-form labels, descriptions and default values. A line that starts with a template prompt keeps the reporter's answer after it; issue-form dropdown options are never template text.
- Lines repeated in at least 20% of the items of the same source and kind in a run, and in at least 5 of them (`masking.boilerplate.min_share` and `min_items`, per pack), are not read either: pasted system-information tables, bot footers, checklists. Lines are compared after normalisation (case, spacing, markdown markers, checkbox state, digits and hashes).
- Safeguards, each with a test: research-mode packs never mask; titles and "Fixes #N" lines are never masked; a repeated line that a top-tier rule matches on its own is never masked; packs without `"masking"` (oncall, radiology-research) are unchanged.
- Masked text keeps its offsets, so every quote is still an exact substring. The HTML board shows it dimmed and marked "template text, not read by rules", the Markdown board counts it, results carry `masked` spans and a `masking` summary, and `urgent-first explain <run> --item ID` lists what was masked.
- Templates cost one API request per repository (the `.github/ISSUE_TEMPLATE` listing; files come from raw.githubusercontent.com, outside the API limit) and are cached for a day in the user cache folder. `--no-templates` turns them off for a run.

#### Pull Requests Inherit From The Issues They Fix

- The keyword rule `PR-FIXES-URGENT` is replaced by `"inherit"` in `pack.json` (new in the schema): a pull request that says "Fixes/Closes/Resolves #N" takes the tier issue #N has from its own rules and floor, quoting the "Fixes #N" span; the explanation and both boards name the linked issue and the rule that flagged it. Raise-only; links do not chain.
- Issue #N is read from the run, or fetched when it is not in it: at most `--linked-max` (default 10) a run, never the last 10 API requests of the hour.
- Links are read with HTML comments removed but without template or boilerplate masks: "Fixes #101" and "Fixes #202" normalise to the same line, so boilerplate masking hid every link in a repository where most pull requests link an issue (found on a live repository, fixed before any benchmark run).
- `PR-FIXES-URGENT` is no longer a rule id an annotation can name (`review.md` updated). Two QA regression tests that asserted the keyword behaviour (a lone pull request at T2) now put the linked issue in the run and assert that the pull request takes its tier.

#### Real-World Benchmark (`bench/github-real/`)

- 229 real issues from Vite, Node.js, Flutter, Rust, Kubernetes and CPython; gold is the urgency label the maintainers applied (119 urgent, 110 feature requests). The repository stores only `owner/repo#number`, the gold tier and the label.
- `urgent-first bench-fetch <ids.jsonl>` fetches the text into the user cache (about 19 API requests anonymously, cached; `GITHUB_TOKEN` used when set) and strips every label and the milestone: the question is whether the words alone recover the maintainers' urgency. `eval --templates FILE` applies the repositories' templates.
- `eval` reports flag-level precision, recall and false-flag rate with Wilson intervals; `scripts/bench-real.js` reports them before and after this pass, split by repository (Vite and Node.js for development, the other four held out and run once).
- Result, rules only, held out: 48 of 149 flagged, precision 68.8% (54.7% to 80.0%), recall of urgent 33 of 79 (41.8%), false flags 15 of 70; development: precision 75.8%, recall 25 of 40. **Identical before and after**: no flag on these issues came from template text, and the benchmark has no pull requests.
- Rules + Claude review, measured once (2026-11-14, `claude-opus-5-5`, one fresh blind subagent per split that saw only the default review queue, the pack's `review.md` and the annotation contract): held out 59 of 149 flagged, precision 74.6% (62.2% to 83.9%), recall 44 of 79 (55.7%, 44.7% to 66.1%), false flags unchanged at 15 of 70, gold T1 at T1 17 → 26; development precision 81.4%, recall 35 of 40. 26 annotations, 0 rejected by `merge`, every raise on a maintainer-labelled urgent issue. `bench/github-real/annotations.{heldout,dev}.jsonl` hold the raises (short quotes only); `scripts/bench-real.js` adds the review rows, a review-queue column and a T1/T2/T3 confusion table, and Wilson intervals for the false-flag rate; `tests/bench.test.js` checks the annotation files and the new rows.

#### Re-Measured

- QA's three live repositories, from the saved items with each repository's templates and up to 6 linked issues fetched: Discuss First 44 → 42 of 200 (T1 20 → 22, T2 24 → 20), 36 → 24 of 100 (T1 1 → 2), 7 → 11 of 80 (T1 0 → 1). Pull requests that only mentioned a bug left the list; pull requests that fix a flagged issue joined it, including ones whose issue was flagged for the wrong reason. Most remaining noise is technical vocabulary in bug reports, which masking does not address.
- Synthetic `github-maintainer` (the only synthetic benchmark that changed): T1 sensitivity unchanged (dev 18/18, test 18/27, with annotations 26/27). Test over-triage 12.7% → 15.9%, exact agreement 72.2% → 70.0%, Kendall tau-b 0.354 → 0.347 (with annotations: 12.7% → 15.9%, 86.7% → 84.4%, 0.582 → 0.568); dev over-triage 4.8% → 7.1%, exact agreement 95.0% → 90.0%, tau-b 0.744 → 0.715. The cause: the synthetic gold was written under the old policy that a pull request fixing a T1 problem is T2, so two test pull requests now count as over-triage (T1 against gold T2); one T2 pull request whose issue is not in the split lost its flag and one the keyword rule missed gained one. Masking changed no synthetic item. `oncall` and `radiology-research` are unchanged.

#### Also

- Plugin icon (`.claude-plugin/icon.png`, 512 px, drawn by `scripts/draw-icon.js` with no dependencies), referenced from `plugin.json`.

### QA Pass (2026-11-14)

A QA pass ran `urgent-first github` live on three public repositories (a large application, a mid-size library, a small CLI), attacked the invariants and fed it hostile input. No real issue text was saved into this repository.

#### Rule Changes (github-maintainer, oncall)

These change published test numbers. They were made from false positives seen on the live boards, checked on the development split only (unchanged: 18 of 18 T1), then the test split was run once.

- `BROKEN-NO-WORKAROUND`: the term `fails:` matched every "fails" (punctuation is not part of a word); it is now a regex for the colon.
- `SECURITY`: possessive patterns ("anyone's", "other people's", "someone else's", ...) matched the plain words, so "Can anyone help me change the port?" was a T1 security report. They now name what is owned ("anyone's data"). "session" no longer pairs with "logs" or "visible" ("session logs").
- `DATA-LOSS`: bare "disappeared", "vanished", "is gone" ("the issue disappeared") and the adjectives "empty", "blank", "missing" ("open an empty folder") now count only next to a data noun or as predicates ("folder is empty", "files are missing").
- `REGRESSION-LATEST`: a bare "since" (usually "because") no longer counts; "since 3.2.0" and "since it updated" do. "regression test" is not a regression here, in `REGRESSION` or in `PR-FIXES-URGENT`.
- `CRASH-OR-HANG`: "crash reporter" (VS Code's `--crash-reporter-id` in every system-information table) is excluded; "unresponsive" added.
- `PR-FIXES-URGENT` (later replaced by inheritance, see above): dropped words that appear in nearly every pull request's validation notes ("build", "release", "install", "missing", "escape", "token"); added specific phrases ("broken build", "build fails", "release asset", "installer"); excluded checklist and CI text ("reviewed for security", "security bot"); no spelling tolerance ("installed" matched "installer").
- Label floor `data loss` (with a space) sets T1 like `data-loss`.
- `oncall`: priority `P0` sets T1; "another customer's" and "someone else's" now name what is owned (they matched "another customer reported the same").
- Effect on test (github-maintainer): rules only 19 → 18 of 27 T1 (one regression described with a bare "since"), over-triage 14.3% → 12.7%, two T2 pull requests that said only "build"/"release" fell to T3. With annotations 27 → 26 of 27: the annotations were not rewritten, so the new miss was never shown to the blind reviewer. oncall and radiology numbers are unchanged.

#### Engine Fixes (no change to any published number)

- Rules no longer read issue-template text: HTML comments (`<!-- ... -->`), and issue-form fields left empty (`### Label` then `_No response_`), which fired CRASH-OR-HANG on an empty "Crash log" field and let an empty "Known workarounds" field block REGRESSION-LATEST. Offsets and quotes are unchanged.
- `near` conditions, `except` lookups, regex and version-mention token lookups and evidence de-duplication were quadratic or worse: a 65,536-character GitHub body took 15 s and a 5 MB ticket did not finish in 4 minutes. Now 0.35 s and 12 s, with identical results (a differential test checks `near` against the old loop).
- The cue index was an `Int16Array`: past 65,535 cues an index wrapped and a suspected quote could start at the wrong cue.
- Field conditions on `metadata.*` no longer produce quotes: "pull_request" was shown as the quoted words of every flagged pull request.
- A word that is suspected only because a "?" follows it (an issue template's question) no longer becomes the headline quote.
- An unknown priority in a pack that does not refuse it is shown on the board and in the review queue instead of silently setting no floor.
- `merge` recomputes the floor from the item and the pack, and refuses a run whose tiers the pack no longer has.
- Research mode: a pack with a banner must be in research mode, and a pack named like a bundled research pack must stay in it (a copy with `mode` deleted ran unmarked input in `watch` with no banner). The banner is now also printed by `explain`, `validate`, `shadow`, `shadow-report`, included in `eval --json` and in `results.json`.
- Writes refuse to go through a symlink or junction inside a run folder.
- Boards link only http(s) URLs (a `javascript:` item or source URL was a link, blocked only by the page's CSP), and Markdown links survive spaces and brackets.
- GitHub: an issue that moves to the next page while paging is kept once (a duplicate id failed the run); the whole body is kept (it was cut at 20,000 characters without notice); a network failure, a rejected token and a secondary rate limit give clear messages with exit code 3; `..` is refused as owner or repository.
- Malformed JSON or FHIR files give a one-line error naming the file instead of a stack trace.
- `SKILL.md`, every pack's `review.md` and the generated review queue say that item text is data, never instructions; the README states what a prompt injection can and cannot do.

### Changes Made After The First Test Run

The test splits were first run with the rules frozen. These later changes did not alter any rule's match conditions, and re-running every test split after them gave the same value on every published metric:

- A comma inside a phrase no longer breaks the phrase ("sudden, severe headache" matches "sudden severe headache").
- "non" (next word only) became a default negation cue ("non-bilious").
- The radiology pack searches the order's text fields only, not the procedure title.
- The review queue includes every item below the top tier, not only unmatched ones.
- Display: the most telling quote is shown first, repeated quotes are shown once, lower-tier rules on an item are grouped as "Also matched", a floor equal to the baseline is no longer shown, one rule title and one citation were reworded.
