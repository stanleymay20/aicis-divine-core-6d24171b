# AICIS Design-Partner Discovery Call — 30-Minute Agenda

## Objective

Understand one real workflow deeply enough to determine whether AICIS should proceed to a bounded historical-replay or shadow-mode evaluation.

The goal is **not** to convince the participant that AICIS is useful. The goal is to discover whether a real, owned, measurable problem exists.

---

## 0–3 min — Context and permission

Suggested opening:

> Thank you for making the time. I am developing AICIS as an evidence-governed decision-support research/product project. It is still pre-commercial validation, so I am not here to claim that it already solves your problem. I would first like to understand one real information or decision workflow in your team. If there is no meaningful fit, that is also a useful outcome for me.

Confirm:

- permission to take notes;
- whether notes may be retained for product research;
- whether any information must remain confidential;
- whether recording is prohibited unless separately consented to.

Do not record by default.

---

## 3–10 min — Reconstruct the current workflow

Ask for a recent concrete example rather than opinions.

1. Think of the last time this type of event/problem occurred. What happened from the first signal to the final decision?
2. Who first noticed it?
3. Which systems, dashboards, emails, calls, feeds, spreadsheets or external sources were checked?
4. Which information had to be reconciled manually?
5. Who decided what was relevant?
6. Who was responsible for the final action or escalation?
7. What was documented afterward?

Capture the workflow as:

`signal → collection → validation → interpretation → escalation → decision → action → audit`

---

## 10–17 min — Quantify pain and failure modes

Avoid leading questions.

Ask:

- What is the slowest part?
- What is the most repetitive part?
- Where is information most likely to be missing, duplicated, stale or contradictory?
- How often does this workflow occur?
- Roughly how many people touch it?
- How much elapsed time typically passes from first signal to confident triage?
- What happens when an important signal is missed?
- What happens when too many false alarms appear?
- Which mistakes are merely inconvenient and which are unacceptable?
- What evidence must be preserved for later review?

Try to obtain ranges, not false precision.

Examples:

- events/month;
- minutes/hours per event;
- number of sources consulted;
- number of handoffs;
- false alarms/week;
- delayed detections/month;
- analyst hours/month.

Record "unknown" when the participant does not know.

---

## 17–22 min — Existing alternatives and ownership

Ask:

1. How do you solve this today?
2. Which existing tools already work well?
3. What have you tried that did not work?
4. Is this important enough that someone owns improving it?
5. Who owns the budget or procurement path if a pilot later proved valuable?
6. What security, privacy, procurement, hosting, regulatory or works-council constraints would matter?
7. Which data could realistically be used in a test, and which data could not?

AICIS should not proceed merely because the participant likes the idea.

---

## 22–27 min — Test a bounded pilot hypothesis

Only after the workflow is understood, reflect back one narrow hypothesis:

> What I heard is that [specific workflow] currently requires [specific reconciliation/triage], with [specific consequence]. Would it be useful to test whether a read-only system can reduce [specific measurable burden] while preserving source provenance and human control?

If yes, ask:

- Which historical period/event would make a fair replay dataset?
- What current baseline should AICIS be compared against?
- Which 1–3 metrics would determine whether the test is worthwhile?
- What would count as failure?
- Who should review false positives and false negatives?
- Could the first test remain fully read-only/shadow-mode?

Do not negotiate a broad deployment during this call.

---

## 27–30 min — Close with evidence-based next step

Possible outcomes:

### Outcome A — no fit

Thank them and record why. Do not force a follow-up.

### Outcome B — problem is real but not ready

Agree on one information request, referral or later checkpoint.

### Outcome C — strong design-partner signal

Propose a second 45–60 minute scoping session with the operational owner and, where appropriate, IT/data/security representation.

The next meeting should freeze:

- one workflow;
- baseline;
- dataset/source boundary;
- evaluation period;
- user roles;
- safety boundary;
- metrics;
- acceptance criteria;
- legal/data constraints.

---

# Discovery evidence record

After every call, complete the following within 24 hours.

## Metadata

- Organization:
- Participant:
- Role:
- Date:
- Source of introduction:
- Notes confidentiality level:

## Problem evidence

- Workflow described:
- Recent concrete example:
- Frequency:
- Current tools/sources:
- Number of handoffs:
- Current elapsed time:
- Manual effort:
- Failure modes:
- Consequence of missed signal:
- Consequence of false alarm:
- Evidence/audit requirement:

## Commercial evidence

- Named problem owner:
- Named economic/procurement owner:
- Existing budget category:
- Procurement constraints:
- Willingness to run test: yes / maybe / no / unknown
- Willingness to pay discussed: yes / no
- Any price quoted by AICIS: yes / no
- Any willingness-to-pay evidence: quote exactly or mark unknown

## Pilot feasibility

- Historical data available:
- Shadow-mode feasible:
- Sensitive data involved:
- Security review needed:
- Baseline measurable:
- Ground truth available:
- Candidate metrics:
- Partner reviewer available:

## Evidence quality

Classify every important statement:

- **Observed** — directly demonstrated/documented.
- **Reported** — participant stated it.
- **Inferred** — analyst interpretation.
- **Hypothesis** — still to be tested.
- **Unknown** — no evidence.

## Decision

- Advance to scoping / nurture / reject
- Why:
- Next action:
- Owner:
- Due date:

---

# Founder discipline

Do not convert one positive interview into a market claim.

Minimum evidence thresholds before stronger language:

- **Problem validated:** repeated, materially similar pain across multiple relevant organizations.
- **Design-partner validated:** written scope and named operational owner.
- **Pilot validated:** pre-agreed baseline + completed evaluation + failure analysis.
- **Willingness-to-pay validated:** documented budget/price discussion or paid engagement.
- **Repeatability validated:** second independent organization buys or commits for materially similar value.

Until those thresholds are reached, AICIS remains a hypothesis-driven pre-commercial product with strong engineering evidence, not a proven market solution.
