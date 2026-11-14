# oncall

A small starter pack for a software-as-a-service support or on-call queue: outages, payments, security incidents and data loss first, whatever priority the ticket form defaulted to.

## Tiers And Floors

| Tier | Name | Pack turnaround setting | Floor |
| --- | --- | --- | --- |
| T1 | Page now | 15 minutes | ticket priority `P0` or `P1`, label `sev1` |
| T2 | This shift | 4 hours | ticket priority `P2`, label `incident` |
| T3 | In order | none | `P3`, `P4` |

The turnaround values are examples; set your own in `pack.json`. A priority the pack does not know (`Sev1`, `Critical`) sets no floor, so the board marks it "not in the pack floor map" and the review queue lists the ticket: add your system's values to `floor.priority`.

## Rules

| Rule | Tier | What it looks for | Source |
| --- | --- | --- | --- |
| OUTAGE | T1 | Many customers, every client, a whole region, "status page is green", dozens of chats at once | [Google SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/) |
| PAYMENTS-FAILING | T1 | Charges, checkout or renewals failing | [Google SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/) |
| SECURITY-INCIDENT | T1 | Another customer's data, leaked or exposed credentials, takeover | [CISA National Cyber Incident Scoring System](https://www.cisa.gov/topics/cyber-threats-and-response/incident-response/cisa-national-cyber-incident-scoring-system-nciss) |
| DATA-LOSS | T1 | Notes, files or workspaces lost, wiped or overwritten | [Google SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/) |
| CUSTOMER-BLOCKED | T2 | One customer cannot sign in, edit or onboard | [Google SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/) |
| DEGRADED | T2 | Elevated errors, latency, timeouts | [Google SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/) |
| EXPIRING | T2 | A certificate, domain or quota about to expire | [Google SRE book, Managing Incidents](https://sre.google/sre-book/managing-incidents/) |

## Results

40 synthetic tickets (`bench/oncall/`): 15 development, 25 test. The test split has only 8 T1 tickets, so the interval is wide; this pack is a starting point, not a measured product.

<!-- bench:oncall:start -->
| Split | Mode | Items | Gold T1 | T1 caught | T1 sensitivity | Wilson 95% CI | Missed T1 | Over-triage | False flags | Kendall tau-b |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| dev | rules only | 15 | 5 | 5 | 100.0% | 56.5% to 100.0% | 0 | 0.0% | 0.0% | 0.840 |
| test | rules only | 25 | 8 | 6 | 75.0% | 40.9% to 92.8% | 2 | 23.5% | 20.0% | 0.539 |
| test | rules + annotations | 25 | 8 | 8 | 100.0% | 67.6% to 100.0% | 0 | 23.5% | 20.0% | 0.676 |

Reproduce:

```bash
node scripts/urgent-first.mjs eval oncall bench/oncall/dev.jsonl
node scripts/urgent-first.mjs eval oncall bench/oncall/test.jsonl --annotations bench/oncall/annotations.test.jsonl
```
<!-- bench:oncall:end -->
