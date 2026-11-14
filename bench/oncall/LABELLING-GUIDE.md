# On-Call Benchmark: Labelling Guide

This guide defines how every case in `bench/oncall/` is written and labelled. All cases are synthetic tickets for a fictional software-as-a-service company ("Northwind Cloud", a fictional hosted notes and file-sync service). They are not copied from or modelled on any real ticket.

## Item Format

One JSON object per line:

```json
{"id":"oc-001","synthetic":true,"title":"Checkout returns 500 for all EU customers","text":{"body":"...","customer_impact":"..."},"labels":["support"],"priority":"P3","location":"eu-west","created_at":"2026-08-03T14:05:00Z","source":"helpdesk","metadata":{"channel":"email","customer_tier":"enterprise"},"gold":{"tier":"T1","category":"outage","rationale":"\"500 for all EU customers\" means a regional outage."}}
```

- `priority` is the ticket priority the reporter or the helpdesk picked: `P1`, `P2`, `P3` or `P4` (P1 most urgent). Many tickets are mis-prioritised on purpose.
- `location` is the affected region (`eu-west`, `us-east`, `ap-south`, `global`) or empty.
- `text.body` is the ticket body; `text.customer_impact` is optional.

## Tiers

| Tier | Name | Meaning |
| --- | --- | --- |
| T1 | Page now | Outage, data loss, security incident, payments failing, or a status-page-level event. |
| T2 | This shift | Degraded service, a single large customer blocked, elevated errors, a certificate expiring within days. |
| T3 | In order | How-to questions, feature requests, billing questions, single-user minor bugs. |

Floor: `P1` sets T1, `P2` sets T2, `P3` and `P4` set T3. Words like "URGENT" in the ticket do not set a floor.

## Categories

T1: `outage`, `data_loss`, `security_incident`, `payments_failing`, `floor_only`.
T2: `degraded`, `customer_blocked`, `cert_or_quota_expiring`, `floor_only`.
T3: `how_to`, `feature_request`, `billing_question`, `minor_bug`, `urgent_words_only`, `negated_mention`.
