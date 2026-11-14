# Radiology Research Benchmark: Labelling Guide

This guide defines how every case in `bench/radiology-research/` is written and labelled. It is the shared policy for case writers and for rule authors. Rule authors read this guide and the `dev` split only.

All cases are synthetic. They are invented order texts written for research and education. They are not taken from, adapted from or modelled on any real patient record. They have not been adjudicated by clinicians. Clinicians are invited to review and relabel them (see `CONTRIBUTING.md`).

## Item Format

One JSON object per line (JSONL), UTF-8, no trailing commas:

```json
{"id":"rad-a-001","synthetic":true,"title":"CT head without contrast","priority":"routine","location":"ED","created_at":"2026-04-07T09:12:00Z","text":{"reason":"...","history":"...","note":"..."},"metadata":{"modality":"CT","encounter_class":"EMER"},"gold":{"tier":"T1","category":"stroke","rationale":"Acute right arm weakness with last known well 07:40, inside the treatment window."}}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique, lowercase, prefix given to the writer (for example `rad-a-001`). |
| `synthetic` | Always `true`. |
| `title` | The procedure as ordered, in plain words ("CT pulmonary angiogram", "MRI lumbar spine", "US pelvis transvaginal"). No billing or terminology codes. |
| `priority` | The ordered priority: `routine`, `urgent`, `asap` or `stat` (FHIR R4 request priority codes). Always present. |
| `location` | `ED`, `inpatient`, `ICU` or `outpatient`. |
| `created_at` | Order time, ISO 8601 with `Z`. Any wall-clock times written in the text ("LKW 07:40") are in the same clock as `created_at`. |
| `text.reason` | The reason for exam or indication as a busy clinician would type it. Always present. |
| `text.history` | Optional clinical history. Sometimes long (300 to 900 characters) with the important cue buried in the middle or at the end. |
| `text.note` | Optional free-text order note ("pt claustrophobic", "please call ext 4410 with result"). |
| `metadata.modality` | `CT`, `MR`, `US`, `XR`, `NM` or `FL`. |
| `metadata.encounter_class` | `EMER`, `IMP`, `ACUTE` or `AMB` (consistent with `location`). |
| `gold.tier` | `T1`, `T2` or `T3` (see below). |
| `gold.category` | One category from the lists below. |
| `gold.rationale` | One line, written as a reason, naming the words in the text that drive the label. |

Never include: real names, real dates of birth, record numbers, real hospital names, SNOMED CT codes, ICD codes of any kind, CPT codes, or text copied from any guideline or published list. Follow the wording rules in CONTRIBUTING.md: never describe the software or a case in words that claim it finds or decides a condition.

## Tiers

| Tier | Name | Meaning for this benchmark |
| --- | --- | --- |
| T1 | Discuss now | The text suggests a condition where imaging within minutes to about an hour can change what happens next. |
| T2 | Today | The text suggests a condition that should be imaged and read within hours, the same day, but not within minutes. |
| T3 | In order | No time-critical cue in the text. Read in the normal order. |

### Floor Rule

The ordered priority sets a floor. The gold tier must be at least as urgent as the floor:

- `stat` sets a floor of T1.
- `asap` and `urgent` set a floor of T2.
- `routine` sets a floor of T3.

So a `stat` order is always gold T1, even when the text is unremarkable (use category `floor_only` for those, and keep them rare: at most 3 per 100 cases). The interesting cases are urgent texts ordered as `routine` or `urgent`.

## Categories

### T1 Categories

- `stroke`: new focal neurological deficit (face, arm or leg weakness, speech disturbance, vision loss on one side, sudden imbalance with other signs), "code stroke", thrombolysis or thrombectomy question, last known well within roughly the last 24 hours. Treatment windows: intravenous thrombolysis within 4.5 hours of last known well; thrombectomy up to 24 hours for selected patients (AHA/ASA acute ischaemic stroke guideline, 2026).
- `intracranial_haemorrhage`: thunderclap or "worst ever" sudden headache, suspected subarachnoid or intracerebral bleed, sudden headache with collapse, neck stiffness and photophobia after sudden onset, deterioration on anticoagulation with neurological change.
- `head_injury_high_risk`: head injury with GCS below 13, GCS below 15 two hours after injury, suspected open, depressed or basal skull fracture, post-traumatic seizure, focal deficit, or more than one episode of vomiting (NICE NG232, CT within 1 hour).
- `pulmonary_embolism`: suspected acute pulmonary embolism (r/o PE, ?PE, CTPA for pleuritic pain with tachycardia, hypoxia or syncope, post-operative sudden breathlessness).
- `aortic_emergency`: suspected aortic dissection (tearing pain to the back, pulse or blood pressure difference between arms), suspected ruptured or leaking abdominal aortic aneurysm.
- `cauda_equina`: back pain or sciatica with new saddle numbness, new bladder or bowel disturbance, bilateral leg symptoms or new weakness (GIRFT national pathway: emergency MRI within 4 hours of the request reaching radiology).
- `spinal_cord_compression`: known or suspected cancer with new back pain plus neurological signs (leg weakness, sensory level, sphincter change), or other suspected acute cord compression.
- `spinal_epidural_abscess`: back pain with fever plus injection drug use, recent spinal procedure or bacteraemia, especially with any neurological change.
- `pneumothorax`: suspected pneumothorax, especially after a procedure (line insertion, biopsy, ventilation), with breathlessness, or suspected tension.
- `perforation`: suspected free air, perforated viscus, sudden severe abdominal pain with rigidity, post-endoscopy pain suggesting perforation.
- `mesenteric_ischaemia`: abdominal pain out of proportion to examination, especially with atrial fibrillation or vascular disease, raised lactate.
- `torsion`: suspected testicular torsion (sudden testicular pain) or ovarian/adnexal torsion (sudden one-sided pelvic pain, often with vomiting, often with a known cyst).
- `ectopic_pregnancy`: positive pregnancy test (or hCG) with abdominal or pelvic pain, bleeding, shoulder-tip pain or collapse, no confirmed intrauterine pregnancy.
- `paediatric_surgical_emergency`: bilious (green) vomiting in a baby (malrotation with volvulus), suspected intussusception (episodic screaming, drawing up legs, redcurrant jelly stool), suspected non-accidental head injury in an infant with neurological change.
- `foreign_body_critical`: ingested button battery or multiple magnets, airway foreign body with respiratory compromise.
- `necrotising_soft_tissue_infection`: pain out of proportion with rapidly spreading redness, crepitus, suspected gas in soft tissue, suspected necrotising fasciitis or Fournier gangrene.
- `obstructed_infected_kidney`: kidney stone or hydronephrosis with fever, sepsis or a single kidney.
- `other_t1`: another clearly time-critical situation in the text (use sparingly and explain in the rationale).
- `floor_only`: ordered `stat` with no time-critical cue in the text.

### T2 Categories

- `tia_resolved`: transient neurological symptoms that have fully resolved.
- `head_injury_anticoagulated`: head injury in a patient on anticoagulants with no high-risk feature (NICE NG232 advises considering CT within 8 hours of the injury).
- `appendicitis`: right lower quadrant pain, suspected appendicitis.
- `bowel_obstruction`: suspected small or large bowel obstruction.
- `biliary`: suspected cholecystitis, cholangitis or obstructive jaundice.
- `dvt`: suspected deep vein thrombosis (leg or arm swelling) without features of pulmonary embolism.
- `renal_colic`: suspected kidney stone without fever or other danger features.
- `infection_collection`: suspected abscess, post-operative collection, septic arthritis, osteomyelitis, diverticulitis, pyelonephritis.
- `fracture_same_day`: suspected hip fracture or other fracture where same-day imaging changes management.
- `other_t2`: another same-day situation (explain in the rationale).
- `floor_only`: ordered `urgent` or `asap` with no same-day cue in the text.

### T3 Categories

- `routine_follow_up`: follow-up of a known, stable finding.
- `staging`: cancer staging or treatment response with no new acute symptoms.
- `chronic_symptoms`: long-standing symptoms with no new red flag.
- `screening_surveillance`: screening or surveillance (aneurysm surveillance, nodule follow-up).
- `negated_or_historical`: an urgent-sounding term appears but is negated, historical or about someone else ("no history of stroke", "PE ruled out last month", "family history of aneurysm", "denies saddle anaesthesia").
- `look_alike`: an urgent-sounding word with a different, non-urgent meaning ("neck dissection" surgery follow-up, "tibial torsion" in a toddler's gait, "ectopic kidney" incidental, "PE tube" in the ear, "heat stroke" years ago, "stroke volume" on echo, a known and stable aneurysm on surveillance).

## Hard Cases Writers Must Include

Each block of 100 cases must contain, spread across tiers:

- Priority mix for T1 cases: about 30% `stat`, about 30% `urgent` or `asap`, about 40% `routine` (the under-prioritised orders are the point of the benchmark).
- At least 12 cases with suspicion phrasing that must count as urgent: "r/o", "rule out", "?SAH", "query", "concern for", "cannot exclude", "eval for", "possible", "suspected".
- At least 10 cases with negation or historical mentions that must not count: "no", "denies", "without", "negative for", "ruled out", "no history of", "h/o", "prior", "family history of".
- At least 10 cases using abbreviations: SOB, LKW, POD2, s/p, r/o, PE, SAH, CVA, AAA, CES, PTX, SBO, RLQ, hCG, NIHSS, GCS, LOC, N/V, HR, BP, SpO2, AF, DOAC.
- At least 6 cases with a plausible typing error in the key word ("pnuemothorax", "disection", "embolsim", "cauda equinna", "torsoin").
- At least 8 cases where the urgent cue is buried in a long `text.history` (over 400 characters, cue in the second half).
- At least 8 cases where the urgent condition is described in plain words without the condition's name ("can't feel the toilet paper and hasn't passed urine since this morning", "green vomit in a 3 day old").
- At least 8 look-alike cases (T3).
- At least 6 cases with numbers that matter: SpO2 values, GCS values, heart rate, age in days or weeks.
- At least 6 cases with a clock: "LKW 07:40", "last known well 0740", "onset 45 min ago", "symptoms started 2 hours ago", "woke with symptoms, last seen normal 23:00".
- Mixed spelling (British and American: haemorrhage and hemorrhage, anaesthesia and anesthesia, ischaemia and ischemia, oesophagus and esophagus).

Keep each case medically coherent: the procedure in `title` should fit the question, and the rationale should make sense to a radiologist.
