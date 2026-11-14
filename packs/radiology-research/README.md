# radiology-research

A research and education pack that reads the text of imaging orders (the reason for the study, the clinical history and the order note) and shows the lines that match rules written from public guidelines. It runs on synthetic orders only.

> Research and education software. Not a medical device; not cleared, approved or CE-marked. Not for patient care, including choosing which studies to read first. It reads only text, quotes the exact words that matched a rule, and never changes the ordered priority. Accuracy figures come from synthetic cases. Clinical use may be regulated as a medical device.

## Why It Is Research-Only

Software that reads patient-specific information to point at a possibly life-threatening condition and puts it ahead of others is, in the examples regulators give, very likely regulated as a medical device: in the US under the FDA's clinical decision support guidance (revised January 2026), and in the EU under MDR Rule 11, where MDCG 2019-11 names automatic reprioritisation of orders based on patient data as medical device software. This pack has not been through any of that. It exists to study a question in the open: how much of the urgency in an order can be read from its text, and how often does a rule-based reader miss it?

The engine enforces the research mode: the banner above on every output, `watch` disabled, no notifications, input refused unless every order is marked synthetic, nothing written outside the run folder, and an order without a priority refused rather than guessed.

## What It Does And Does Not Do

- It reads only text. It does not look at images, waveforms or lab series.
- It never changes the ordered priority. A `stat` order is always shown in T1; a rule can move a `routine` order up, never an order down.
- Every flag quotes the exact words that matched and names the rule and its public source.
- Orders no rule matched are listed in their original order, under "No rule matched". That does not mean they are not urgent.

## Tiers And Floors

| Tier | Name | Pack turnaround setting | Floor from the ordered priority |
| --- | --- | --- | --- |
| T1 | Discuss now | 60 minutes | `stat` |
| T2 | Today | 8 hours | `urgent`, `asap` |
| T3 | In order | none | `routine` |

The turnaround values are settings of this pack for ordering, not national standards; no national imaging turnaround standard exists. Change them in `pack.json`.

## Rules

Rules are written in this project's own words from the cited public sources; no guideline text, table or licensed code list is copied, and no SNOMED CT, WHO ICD-10 or CPT content is used. The facts behind each rule (for example the 4.5-hour thrombolysis window, emergency MRI within 4 hours of the request for suspected cauda equina syndrome, CT head within 1 hour for high-risk head injury) are paraphrased from the source.

| Rule | Tier | What it looks for | Source |
| --- | --- | --- | --- |
| STROKE | T1 | New one-sided weakness, facial droop, speech loss or half-field vision loss; shows the last-known-well clock with the 4.5 h and 24 h windows | [AHA/ASA 2026 acute ischaemic stroke guideline](https://www.ahajournals.org/doi/10.1161/STR.0000000000000513) |
| INTRACRANIAL-BLEED | T1 | Thunderclap or worst-ever headache, suspected bleed, or new confusion on anticoagulants | [NICE NG228](https://www.nice.org.uk/guidance/ng228) |
| HEAD-INJURY-HIGH-RISK | T1 | Head injury with GCS below 15, signs of skull fracture, seizure, focal deficit or repeated vomiting | [NICE NG232](https://www.nice.org.uk/guidance/ng232) |
| REDUCED-CONSCIOUSNESS | T1 | A stated GCS of 12 or less | [NICE NG232](https://www.nice.org.uk/guidance/ng232) |
| CAUDA-EQUINA | T1 | Back pain or sciatica with saddle numbness, retention, incontinence or symptoms in both legs | [GIRFT national suspected cauda equina pathway](https://gettingitrightfirsttime.co.uk/pathway-supports-clinicians-to-diagnose-and-treat-cauda-equina-syndrome-without-delay/) |
| CORD-COMPRESSION | T1 | Cancer with new leg weakness, a sensory level or sphincter change | [NICE NG234](https://www.nice.org.uk/guidance/ng234) |
| EPIDURAL-ABSCESS | T1 | Back pain, fever and a risk factor | [StatPearls, NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK441890/) |
| PULMONARY-EMBOLISM | T1 | Suspected PE, or pleuritic pain or breathlessness with tachycardia, low saturation or a clot risk factor | [ESC 2019 acute PE guideline](https://academic.oup.com/eurheartj/article/41/4/543/5556136) |
| AORTIC-DISSECTION | T1 | Suspected dissection, tearing pain, arm blood pressure difference | [ESC 2024 aortic guideline](https://academic.oup.com/eurheartj/article/45/36/3538/7738955) |
| AAA-RUPTURE | T1 | Known or palpable aneurysm with collapse, low blood pressure or new pain | [ESVS 2024 AAA guideline](https://esvs.org/wp-content/uploads/2024/02/ESVS-2024-AAA-Guidelines.pdf) |
| PNEUMOTHORAX | T1 | Suspected pneumothorax, or a procedure or chest injury with new breathlessness | [BTS 2023 pleural guideline](https://www.brit-thoracic.org.uk/document-library/guidelines/pleural-disease/bts-guideline-for-pleural-disease/) |
| PERFORATION | T1 | Free air, perforation, anastomotic leak, peritonism | [WSES 2020 perforated ulcer guideline](https://doi.org/10.1186/s13017-019-0283-9) |
| MESENTERIC-ISCHAEMIA | T1 | Pain out of proportion to a soft abdomen with AF, vascular disease or lactate | [WSES 2022 mesenteric ischaemia guideline](https://doi.org/10.1186/s13017-022-00443-x) |
| TORSION | T1 | Sudden testicular pain, or sudden one-sided pelvic pain with a cyst or enlarged ovary | [EAU paediatric urology 2026](https://uroweb.org/guidelines/paediatric-urology/chapter/acute-scrotum) |
| ECTOPIC-PREGNANCY | T1 | Suspected ectopic, or a positive pregnancy test with pain, bleeding or collapse | [NICE NG126](https://www.nice.org.uk/guidance/ng126) |
| PAEDIATRIC-SURGICAL | T1 | Bilious vomiting in a baby, malrotation, volvulus, intussusception | [ACR Appropriateness Criteria, Vomiting in Infants](https://acsearch.acr.org/docs/69445/Narrative/) |
| NAI-HEAD | T1 | Suspected inflicted injury with neurological change | [RCR and RCPCH 2018](https://www.rcr.ac.uk/media/nznl1mv4/rcr-publications_the-radiological-investigation-of-suspected-physical-abuse-in-children-revised-first-edition_november-2018.pdf) |
| FOREIGN-BODY | T1 | Swallowed button battery or magnets, inhaled foreign body | [National Capital Poison Center guideline](https://www.poison.org/battery/guideline) |
| NECROTISING-INFECTION | T1 | Crepitus, pain out of proportion, rapidly spreading redness, bullae | [IDSA 2014 skin and soft tissue guideline](https://academic.oup.com/cid/article/59/2/e10/2895845) |
| INFECTED-OBSTRUCTED-KIDNEY | T1 | Stone or hydronephrosis with fever, or obstruction of a single kidney | [EAU urolithiasis 2026](https://uroweb.org/guidelines/urolithiasis/chapter/guidelines) |
| SHOCK | T1 | Systolic blood pressure 90 or less, heart rate above 130, stated instability | [NICE NG253](https://www.nice.org.uk/guidance/ng253) |
| ACTIVE-BLEEDING | T1 | Massive haemoptysis, haematemesis, active bleeding | [NICE CG141](https://www.nice.org.uk/guidance/cg141) |
| LIMB-ISCHAEMIA | T1 | Pulseless, cold or white limb | [ESVS 2020 acute limb ischaemia guideline](https://doi.org/10.1016/j.ejvs.2019.09.006) |
| TIA | T2 | Neurological symptoms that have fully resolved | [NICE NG128](https://www.nice.org.uk/guidance/ng128) |
| HEAD-INJURY-ANTICOAGULATED | T2 | Head injury on anticoagulants | [NICE NG232](https://www.nice.org.uk/guidance/ng232) |
| HYPOXIA | T2 | Stated saturation below 92% (the threshold is this pack's choice) | [BTS 2017 oxygen guideline](https://www.brit-thoracic.org.uk/clinical-resources/guidelines/emergency-oxygen/) |
| APPENDICITIS | T2 | Suspected appendicitis, right lower quadrant pain | [WSES 2020 Jerusalem guidelines](https://doi.org/10.1186/s13017-020-00306-3) |
| BOWEL-OBSTRUCTION | T2 | Suspected obstruction, absolute constipation, distension with vomiting | [Bologna guidelines 2017 update](https://doi.org/10.1186/s13017-018-0185-2) |
| BILIARY | T2 | Cholecystitis, cholangitis, Murphy's sign | [Tokyo Guidelines 2018](https://doi.org/10.1002/jhbp.515) |
| DVT | T2 | Suspected deep vein thrombosis, a swollen calf or leg | [NICE NG158](https://www.nice.org.uk/guidance/ng158) |
| RENAL-COLIC | T2 | Renal colic without fever | [EAU urolithiasis 2026](https://uroweb.org/guidelines/urolithiasis/chapter/guidelines) |
| INFECTION-COLLECTION | T2 | Abscess, collection, septic arthritis, osteomyelitis, discitis | [IDSA 2014](https://academic.oup.com/cid/article/59/2/e10/2895845) |
| FRACTURE | T2 | Suspected fracture, inability to bear weight, deformity | [NICE CG124](https://www.nice.org.uk/guidance/cg124) |
| NAI-SURVEY | T2 | Suspected inflicted injury | [RCR and RCPCH 2018](https://www.rcr.ac.uk/media/nznl1mv4/rcr-publications_the-radiological-investigation-of-suspected-physical-abuse-in-children-revised-first-edition_november-2018.pdf) |
| SEIZURE-OR-RAISED-PRESSURE | T2 | First seizure, or worsening headache with vomiting (same-day is this pack's choice) | [NICE NG217](https://www.nice.org.uk/guidance/ng217) |
| TUBE-OR-LINE-POSITION | T2 | Nasogastric tube position check before feeding | [NHS Improvement 2016](https://www.england.nhs.uk/2016/07/nasogastric-tube-misplacement-continuing-risk-of-death-severe-harm/) |
| PAEDIATRIC-SAME-DAY | T2 | Possible pyloric stenosis | [ACR Appropriateness Criteria, Vomiting in Infants](https://acsearch.acr.org/docs/69445/Narrative/) |

Negation, suspicion and history handling are part of every rule: "no history of stroke" and "PE ruled out last month" do not count, "r/o PE", "?SAH" and "cannot exclude perforation" do. The pack adds a radiology abbreviation table (SOB, LKW, POD, s/p, r/o, PE, SAH, CVA, AAA, CES, PTX, SBO, RLQ, GCS and more) and numeric readers for SpO2, heart rate, systolic blood pressure, GCS and temperature.

## Results

Synthetic benchmark, 300 cases (`bench/radiology-research/`), split before any rule was written: 120 development cases used to write the rules, 180 test cases run once afterwards. "Rules + annotations" adds a blind review pass by an AI agent that saw only the review queue, never the gold labels.

<!-- bench:radiology-research:start -->
| Split | Mode | Items | Gold T1 | T1 caught | T1 sensitivity | Wilson 95% CI | Missed T1 | Over-triage | False flags | Kendall tau-b |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| dev | rules only | 120 | 54 | 54 | 100.0% | 93.4% to 100.0% | 0 | 0.0% | 0.0% | 0.804 |
| test | rules only | 180 | 81 | 68 | 84.0% | 74.5% to 90.4% | 13 | 9.1% | 11.1% | 0.627 |
| test | rules + annotations | 180 | 81 | 81 | 100.0% | 95.5% to 100.0% | 0 | 9.1% | 11.1% | 0.736 |

Reproduce:

```bash
node scripts/urgent-first.mjs eval radiology-research bench/radiology-research/dev.jsonl
node scripts/urgent-first.mjs eval radiology-research bench/radiology-research/test.jsonl --annotations bench/radiology-research/annotations.test.jsonl
```
<!-- bench:radiology-research:end -->

What the numbers mean and do not mean:

- On the test split the rules alone missed 13 of 81 T1 cases. Every miss is listed by `eval` with its rationale. Most describe the condition in plain words the rules do not contain ("numb when wiping", "red jelly-like stool", "cold and white" leg) or spread the cue across sentences.
- The development split scores higher because the rules were written against it; the test split is the honest number.
- The blind review pass caught all 13 test misses and did not raise any test case above its gold tier. The same model family that reviewed the queue also wrote the cases, so its phrasing may match the cases better than real orders would. Treat this as an upper bound for the method, not a measured accuracy.
- All cases are synthetic and none has been adjudicated by a clinician.

## Limitations

- Synthetic cases written by AI agents from a labelling guide; real orders are terser, noisier and local in their abbreviations.
- No clinician has reviewed the rules or the labels. Clinicians are invited to (see `CONTRIBUTING.md`).
- The rules read English text only.
- A rule-based reader misses urgency described in words it does not know; the annotation step narrows that gap but depends on whoever performs it.
