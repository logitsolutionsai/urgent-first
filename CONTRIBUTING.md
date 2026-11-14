# Contributing

Thank you for helping. The most valuable contributions are packs for new kinds of queue, labelled cases, and expert review of the labels that already exist.

## Ground Rules

- **No real people's data.** Never contribute real patient text (including "de-identified" text), real support tickets, or real people's issues. Write synthetic cases, or paraphrase so thoroughly that nothing can be traced back.
- **No licensed content.** No SNOMED CT, no WHO ICD-10, no CPT, no copied guideline wording or tables. Write rules in your own words and cite a public source per rule.
- **Wording.** Describe what the software does: it reads text and shows lines that match rules. Never describe it, or a case, in words that claim it finds, decides or confirms a condition, or that claim a regulatory status. `tests/wording.test.js` checks the repository for the specific words.
- **Raise-only stays.** Changes that would let a rule or annotation lower an item, or that would add a "safe" or "can wait" list, will not be accepted.

## Contribute A Pack

1. `node scripts/urgent-first.mjs new-pack packs/<name> --name <name>`.
2. Write rules in `pack.json`: every rule needs `why` and a `source` with a public URL. Check sentences with `urgent-first explain packs/<name> "<text>"` and validate with `urgent-first validate packs/<name>`.
3. Write `README.md` (tiers, rules table, results, limitations) and `review.md` (guidance for the annotation step).
4. Add a benchmark in `bench/<name>/`: a `LABELLING-GUIDE.md` written before the cases, cases in `raw/`, then `node scripts/split-bench.js bench/<name>`. Tune on `dev.jsonl` only; run `test.jsonl` when the rules are frozen and publish the result as it is.
5. Add `<name>` to `BENCHES` in `scripts/update-bench-results.js`, add the result markers to the READMEs, run `npm run bench`, then `npm test` and `npm run test:e2e`.

## Contribute Labelled Cases

Add cases to `raw/` following the benchmark's labelling guide: `synthetic: true`, a gold `tier`, a `category` from the guide and a one-line `rationale` naming the words that drive the label. New cases go to the development split unless a maintainer creates a new test split; do not add cases to an existing `test.jsonl`.

## Three Good First Contributions

Each of these is small, reviewable and useful to every maintainer who runs the tool.

1. **A rule for your language or ecosystem.** Many reports say "fails to build" or "cannot install" in words specific to one toolchain (a Cargo, Gradle or pip error line). Add a rule or a term to a copy of `packs/github-maintainer`, with a public source, at least one positive case, one negated case ("the build does not fail anymore") and one counterexample to its development set. Run `urgent-first pack lint` and `urgent-first eval` and include both outputs in the pull request.
2. **A counterexample fixture for negation or template masking.** Find a sentence the rules misread: a negation they miss, or template text they read as the reporter's words. Add it as a synthetic case to a development split (never a test split), or as a labelled pair to `bench/maintainer-radar/candidates.dev.*` if it is about candidate links, and say what the tool did and what it should do.
3. **A read-only report improvement.** Improve how `board.html`, `pulse.html` or `digest.html` presents something, within `brand-kit` rules: the Ink palette with one accent, tiers by weight and shape, no network, the inline script allowed only by its hash. Include a screenshot at 1280 and 390 pixels wide, and keep `npm run test:e2e` passing.

Never add a command that writes to GitHub (labels, comments, closing) without the plan, approval and audit design in `docs/THREAT-MODEL.md`.

## Clinicians: Review The Radiology Labels

The radiology cases have not been adjudicated by clinicians. If you are a radiologist or another clinician, you can help without writing code:

- Open an issue titled "Label review: rad-x-NNN" for any case where you would choose a different tier or category, with your reasoning. Disagreements are useful data.
- Or review a whole file and send a list of `id, your tier, comment`.
- Contributed reviews will be published as a second, attributed label set alongside the current one (with your permission), so agreement between readers can be reported.

## Code

- Node 20 or later, ES modules, no runtime dependencies. `playwright-core` is the only development dependency, for the board test; it never downloads a browser (set `URGENT_FIRST_CHROME` if Chrome is not found).
- `npm test` must pass. Tests use recorded fixtures, never the live GitHub API (`URGENT_FIRST_LIVE=1` runs one optional live smoke test).
- Keep the engine deterministic: no randomness, no clock reads, stable ordering.
- Headings in Title Case, no contractions, no exclamation marks in documentation.
