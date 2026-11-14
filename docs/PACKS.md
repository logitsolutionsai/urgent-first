# Packs

A pack is a folder: `pack.json` (rules), `README.md` (for people) and `review.md` (guidance for the agent's review step). The format is in [references/pack-format.md](../references/pack-format.md).

## Write Your Own Pack

Ask the skill to "build a triage pack for my field". It interviews you (or the expert you are building it for): what makes an item urgent, the words people actually type, the look-alikes, five urgent and five not-urgent examples. It drafts rules with a public source for each, labels twenty examples with you, keeps half of them aside as a test set, runs `eval`, and iterates on the other half. The result is a folder: `pack.json` (rules), `README.md` (for people) and `review.md` (guidance for the agent's review step).

```bash
node scripts/urgent-first.mjs new-pack my-pack --name my-pack
node scripts/urgent-first.mjs explain my-pack "no data was lost, but the export overwrote my originals"
node scripts/urgent-first.mjs eval my-pack my-pack/labelled.jsonl
```

Shadow mode compares the board with the expert's own first picks over time: `urgent-first shadow <run> --picks "#812" "#799" "#805"`. See [SKILL.md](../SKILL.md) for the full flows and [references/](../references/) for the pack format, rule matching, the annotation contract and the evaluation maths.

## Radiology Research Pack

`radiology-research` was the original idea: a radiologist's 100 pending studies, triaged from the order text only. It ships strictly as research and education software on synthetic data.

> Research and education software. Not a medical device; not cleared, approved or CE-marked. Not for patient care, including choosing which studies to read first. It reads only text, quotes the exact words that matched a rule, and never changes the ordered priority. Accuracy figures come from synthetic cases. Clinical use may be regulated as a medical device.

Why research-only: software that reads patient-specific information to point at a possibly life-threatening condition and moves it ahead of others is, in the examples regulators give, very likely a medical device function (the FDA's clinical decision support guidance, revised in January 2026; EU MDR Rule 11 and MDCG 2019-11). This pack has not been through any of that, and a disclaimer does not change what software is used for. So the engine enforces a research mode: the banner on every output, `watch` disabled, no notifications, input refused unless marked synthetic, nothing written outside its own run folder, and an order without a priority refused rather than guessed. A copy of the pack with `mode` deleted, or any pack that reuses its name or banner without research mode, is refused. A renamed and edited copy is ordinary code you changed: these safeguards are speed bumps in the shipped files, not a lock.

The pack reads FHIR R4 ServiceRequest bundles, HL7 v2 order messages (priority from TQ1-9 first, not only the older OBR-27.6) and JSONL. Try it on 100 synthetic pending studies:

```bash
node scripts/urgent-first.mjs run radiology-research examples/radiology-100-pending.fhir.json
```

Its 37 rules are written in this project's own words, each with a public guideline citation; no guideline text, SNOMED CT, WHO ICD-10 or CPT content is included. Details: [packs/radiology-research/README.md](../packs/radiology-research/README.md).
