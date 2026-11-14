# Rule Matching

Matching is deterministic and runs on words, not on a model. Try any sentence with `urgent-first explain <pack> "<text>"`: it prints the cues it found, each word's context, the rules that matched and the mentions that did not count.

## Tokens

Text is split into words (letters and digits, with internal apostrophes), question marks, hard boundaries (`.`, `!`, `;` before a space, and line breaks) and soft boundaries (`,`, `:`, brackets). Words are lower-cased and folded: British and American spellings meet (`haemorrhage`/`hemorrhage`, `anaesthesia`/`anesthesia`, `ischaemia`/`ischemia`, `oesophagus`/`esophagus`, `-ising`/`-izing`), and a trailing `'s` is dropped.

Issue-template text in text fields is not searched: HTML comments (`<!-- ... -->`, hidden guidance on GitHub) and an issue-form field the reporter left empty (its `### Label` heading followed by GitHub's `_No response_`). Neither is the reporter's words: an empty "Crash log" field is not a crash, and an empty "Known workarounds" field is not a workaround. The text is blanked with spaces, so every offset and quote still points at the original text. Titles are plain text and are searched as written.

On packs with `masking` (`pack-format.md`), whole lines are blanked the same way before rules read them: lines of the repository's issue and pull request templates, and lines repeated across many items of a run (a pasted system-information table, a pull request checklist). A line starting with a template prompt is blanked up to the end of the prompt, so the answer after it is read. Lines are compared on their words: lower case, digits generalised (`1.95.3` and `1.96.0` compare equal), markdown markers and checkbox state ignored. The board shows masked text dimmed as "template text, not read by rules"; `urgent-first explain <run> --item ID` lists it.

A trailing `'s` is dropped on both sides, so a pattern written as "anyone's" also matches "anyone" (as in "Can anyone help me..."). To mean a possessive, name what is owned: "anyone's data", "someone else's account".

Abbreviations from the pack (plus built-ins `r/o`, `h/o`, `w/o`, `c/o`, `y/o` and contractions such as `doesn't`) expand into several words that all keep the abbreviation's own offsets. A rule written as "pulmonary embolism" therefore matches "PE", and the quote shown is "PE".

## Conditions

| Condition | Matches when | Quote |
| --- | --- | --- |
| `{"terms": [...]}` | any phrase occurs as consecutive words. `*` alone is any one word ("worst headache of * life"); a trailing `*` is a prefix ("dissect*"); plurals (`-s`, `-es`, `-ies`) match; a comma inside a phrase is skipped. Optional `fields`, `include`, `typos`, `except`. | the words matched |
| `{"near": [[A...], [B...]], "within": 6}` | a word from each group within N words, same sentence, no comma between | from the first to the last word |
| `{"regex": "...", "flags": "i"}` | the pattern matches (JavaScript syntax; in JSON write `\\b`) | the match |
| `{"number": "spo2", "op": "<", "value": 92}` | a value from the named extractor satisfies the comparison | the whole extractor match |
| `{"clock": "onset", "within_minutes": 1440}` | a clock was found (and, if given, elapsed at item time is within the limit) | the clock text |
| `{"field": "location", "in": ["ED"]}` | a field equals one of the values (case-insensitive); also `equals`, `matches` (word-boundary, for labels), or `op`/`value` for numbers | the field value, for `title`, `location`, `priority` and labels only; `metadata.*` and `source` are filters and are never quoted |
| `{"mentions": "metadata.latest_release_aliases"}` | one of the strings in that metadata field occurs, with version boundaries (`3.2` does not match `3.2.1` or `13.2`) | the version text |
| `{"any": [...]}`, `{"all": [...]}`, `{"none": [...]}` | combinators | union of the parts that matched |

`except` lists look-alike phrases: a hit that lies inside one does not count ("stroke volume", "neck dissection"). `typos` turns on spelling-tolerant matching for words of `typo_min_length` letters or more: one wrong, missing, extra or swapped letter, same first letter. Such quotes are marked "spelling-tolerant" on the board.

## Negation, Suspicion And History

Every mention gets a context: `affirmed`, `suspected`, `negated` or `historical`. By default a condition counts `affirmed` and `suspected` mentions; set `"include"` to change that (risk factors such as "known cancer" or "on apixaban" usually include `historical`).

| Cue kind | Examples | Effect |
| --- | --- | --- |
| Negation before | no, denies, without, negative for, free of, no evidence of, no history of, not a, not (next word only), non (next word only), nothing (next two words) | following words are negated |
| Negation after | ruled out, excluded, resolved, negative, unremarkable, not seen, intact, normal, false positive (whole sentence) | preceding words (up to 4, not past a comma) are negated |
| Suspicion before | r/o, rule out, ?, query, concern for, suspected, possible, likely, cannot exclude, cannot rule out, evaluate for, low suspicion for | following words are **suspected: they count as positive** |
| Suspicion after | ?, suspected, not excluded, cannot be excluded, unlikely | preceding words are suspected |
| History before / after | history of, h/o, prior, previous, old, chronic, longstanding; years ago, last year, a year before the item's year | words are historical |
| Experiencer | family history of, mother had, father had | historical to the end of the sentence |
| Pseudo | no longer, not improving, not only, gram negative, 3 weeks old, not passing, not moving | contain a cue word but are not cues |
| Terminators | but, however, although, now, presents, currently, today; for history also new, acute, sudden, worsening | end a scope |

Scopes run up to `window` words (default 6), stop at sentence ends, question marks, soft boundaries for most cues, terminators and the next cue. Suspicion always wins: "No pneumothorax but cannot rule out tension pneumothorax" counts. A mention is negated only when every word in it is in a negation scope; a partial scope leaves it affirmed, which errs towards flagging.

Words that describe lost function are **not** cues: "cannot pass urine", "has not passed urine", "unable to walk", "no movement of the left arm" are symptoms. Write them into rules as phrases; a phrase that starts with a cue word is not negated by that cue.

A suspected mention quotes its cue too: the board shows "r/o PE", not "PE".

## Numbers

Each named extractor is a list of regular expressions with one capture group (or a group named `value`). Example from the radiology pack: `spo2` reads "SpO2 88%", "sats 92%", "SpO2 down from 95% to 87%" (87). Numbers are not negation-checked.

## Clocks

A clock pattern captures `(?<time>...)` (a wall time: `07:40`, `0740`, `7.40pm`) or `(?<ago>...)` (a duration: `45 min`, `2 hours`). Wall times are read in the same clock as the item's `created_at` (its UTC offset, or UTC for `Z`); a time later than the item time is taken as the previous day. Each window gives a deadline (`event + minutes`) and the time left at the item time; the board also shows the time left at the run's `--now`.

## Ordering

Flagged items: tier, then the earliest deadline (the SLA deadline of the tier, or a clock window that had not passed at the item time), then the longest wait (`created_at`), then original order. Items in the baseline tier: original order only. The order does not depend on `--now`, so the same input always gives the same board.
