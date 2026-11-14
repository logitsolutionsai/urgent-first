# Discuss First: Radiology order text (research pack)

> **Research mode.** Research and education software. Not a medical device; not cleared, approved or CE-marked. Not for patient care, including choosing which studies to read first. It reads only text, quotes the exact words that matched a rule, and never changes the ordered priority. Accuracy figures come from synthetic cases. Clinical use may be regulated as a medical device.

Pack `radiology-research` 0.1.0 · Input: `radiology-worklist.jsonl` · Items: 12 · As of: 2026-11-14 09:30 UTC · Engine: urgent-first 0.1.0

**Discuss First: 7** (T1 Discuss now: 5 · T2 Today: 2) · **No rule matched: 5**

## Discuss First (7)

### T1 · Discuss now (5)

1. **demo-04** · CT pulmonary angiogram · priority urgent · raised from T2 to T1 · inpatient · waiting 1 h 15 min
   - PULMONARY-EMBOLISM (T1) Possible pulmonary embolism ([source](https://academic.oup.com/eurheartj/article/41/4/543/5556136)): "r/o PE" (suspected) [reason], "POD2" [reason], "SOB" [reason], "HR 118" [reason], "SpO2 89%" [reason]
   - Also matched: HYPOXIA (T2) "SpO2 89%" [reason]
   - Turnaround: target 1 h (pack setting), overdue by 15 min
   - Floor: priority "urgent" sets T2
2. **demo-12** · US abdomen · priority routine · raised from T3 to T1 · inpatient · waiting 1 h 10 min
   - PAEDIATRIC-SURGICAL (T1) Possible malrotation, volvulus or intussusception ([source](https://acsearch.acr.org/docs/69445/Narrative/)): "vomited bright green" [history]
   - Also matched: BOWEL-OBSTRUCTION (T2) "distended" [history], "vomited" [history]
   - Turnaround: target 1 h (pack setting), overdue by 10 min
3. **demo-06** · MRI lumbar spine · priority routine · raised from T3 to T1 · ED · waiting 1 h
   - CAUDA-EQUINA (T1) Possible cauda equina syndrome ([source](https://gettingitrightfirsttime.co.uk/pathway-supports-clinicians-to-diagnose-and-treat-cauda-equina-syndrome-without-delay/)): "has not passed urine" [history], "Back" [reason], "bilateral sciatica" [reason]
   - Turnaround: target 1 h (pack setting), 0 min left
4. **demo-02** · CT head without contrast · priority routine · raised from T3 to T1 · ED · waiting 40 min
   - STROKE (T1) Possible acute stroke ([source](https://www.ahajournals.org/doi/10.1161/STR.0000000000000513)): "Sudden R arm weakness" [reason], "slurred speech" [reason], "LKW" [reason]
   - Clock: Symptom onset or last known well 07:40 (quoted: "LKW 07:40"): IV thrombolysis window (4 h 30 min) closes 12:10: 3 h 20 min left at item time, 2 h 40 min left now; Thrombectomy window for selected patients (1 d) closes 07:40 on 2026-11-15: 22 h 50 min left at item time, 22 h 10 min left now
   - Turnaround: target 1 h (pack setting), 20 min left
5. **demo-11** · CT head without contrast · priority stat · ED · waiting 25 min
   - HEAD-INJURY-HIGH-RISK (T1) Head injury with a high-risk feature ([source](https://www.nice.org.uk/guidance/ng232)): "fluid from L ear" [reason], "Fall" [reason], "GCS 12" [reason], "clear fluid" [reason]
   - REDUCED-CONSCIOUSNESS (T1) GCS 12 or less ([source](https://www.nice.org.uk/guidance/ng232)): "GCS 12" [reason]
   - Turnaround: target 1 h (pack setting), 35 min left
   - Floor: priority "stat" sets T1

### T2 · Today (2)

6. **demo-08** · US venous duplex left leg · priority urgent · ED · waiting 1 h 35 min
   - DVT (T2) Possible deep vein thrombosis ([source](https://www.nice.org.uk/guidance/ng158)): "?DVT" (suspected) [reason], "Swollen and tender" [reason]
   - Turnaround: target 8 h (pack setting), 6 h 25 min left
   - Floor: priority "urgent" sets T2
7. **demo-09** · CT abdomen and pelvis with contrast · priority routine · raised from T3 to T2 · ED · waiting 45 min
   - APPENDICITIS (T2) Possible appendicitis ([source](https://doi.org/10.1186/s13017-020-00306-3)): "Query appendicitis" (suspected) [reason], "RLQ" [reason]
   - Turnaround: target 8 h (pack setting), 7 h 15 min left

## No rule matched (5)

This does not mean not urgent. Items are listed in their original order.

8. demo-01 · MRI knee · priority routine · outpatient · waiting 2 h 25 min
9. demo-03 · MRI brain without contrast · priority routine · outpatient · waiting 2 h 10 min · did not count: "stroke" (negated)
10. demo-05 · US pelvis · priority routine · outpatient · waiting 1 h 50 min · did not count: "ectopic" (historical), "ectopic pregnancy" (historical)
11. demo-07 · XR chest · priority routine · inpatient · waiting 1 h 25 min · did not count: "Pneumothorax" (negated)
12. demo-10 · MRI heart with contrast · priority routine · outpatient · waiting 2 h 40 min

---

Every flag quotes the exact words that matched. No item is placed below the tier its own priority field implies; rules and annotations can only raise.

> Research and education software. Not a medical device; not cleared, approved or CE-marked. Not for patient care, including choosing which studies to read first. It reads only text, quotes the exact words that matched a rule, and never changes the ordered priority. Accuracy figures come from synthetic cases. Clinical use may be regulated as a medical device.
