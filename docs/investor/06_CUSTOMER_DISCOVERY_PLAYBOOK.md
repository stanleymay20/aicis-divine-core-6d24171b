# AICIS Customer Discovery Playbook

## Purpose

This playbook converts market conversations into evidence. It is not a sales script and it must not be used to manufacture traction.

The objective is to determine whether a specific resilience/continuity workflow is painful enough, frequent enough and measurable enough to justify an AICIS pilot.

## Target interview roles

Prioritize people who directly own or perform the workflow:

- resilience / continuity leads;
- climate-adaptation or civil-protection staff;
- utility/network operations leads;
- infrastructure monitoring or control-room roles;
- public-sector digital/innovation leads;
- analysts who manually combine fragmented operational information;
- procurement or budget owners after user pain is confirmed.

Do not count generic networking conversations as customer discovery unless the person can describe the current workflow from direct experience.

## 30-minute interview structure

### 1. Context — 5 minutes

Ask the interviewee to describe their role and responsibilities without introducing AICIS features first.

Core questions:

1. What events or disruptions are you expected to notice early?
2. What information do you monitor today?
3. Which decisions depend on that information?
4. Who is accountable when the information is late, incomplete or contradictory?

### 2. Current workflow — 10 minutes

Ask for a recent concrete example rather than opinions.

1. Tell me about the last time you had to assess a developing operational risk.
2. Which systems, feeds, emails, dashboards, spreadsheets, calls or reports did you use?
3. How did you decide which source to trust?
4. How were duplicates, conflicts or missing data handled?
5. How long did the initial triage take?
6. How many people became involved?
7. What was the slowest or most error-prone step?
8. What happens outside office hours?
9. What information could not be shared or centralized?
10. How was the final assessment documented and audited?

### 3. Pain and consequence — 5 minutes

1. How often does this workflow occur?
2. What happens when an important signal is missed?
3. What happens when too many low-quality alerts are escalated?
4. Is the primary cost staff time, response delay, service interruption, regulatory exposure, public impact, reputational risk or something else?
5. Which part would you most want to improve if you could change only one thing?

Never translate qualitative statements into monetary savings unless the organization supplies defensible numbers.

### 4. Existing alternatives — 5 minutes

1. Which commercial tools or internal systems are already used?
2. What do they do well?
3. Where do they fail?
4. Why has the problem not already been solved internally?
5. Would another dashboard help, or is the real problem evidence integration, prioritization and traceability?

### 5. Pilot feasibility — 5 minutes

Only after the pain is understood:

1. Could a historical replay or shadow-mode evaluation be run without changing live operations?
2. Which data sources could legally and technically be used?
3. What baseline process should AICIS be compared against?
4. Which metric would make a pilot meaningful to you?
5. Who would need to approve a pilot?
6. Who owns budget for this category?
7. What procurement, security, privacy or works-council constraints apply?

## Evidence log

Create one record per interview.

| Field | Required evidence |
| --- | --- |
| Organization | Exact organization name |
| Interview date | Date |
| Role | Role/function; do not expose personal data publicly without permission |
| Workflow | Concrete workflow described |
| Recent example | Specific event/use case |
| Sources used | Systems/feeds/channels actually used |
| Frequency | Reported frequency, with wording preserved |
| Pain | Interviewee's description |
| Consequence | Operational consequence described |
| Current alternative | Existing tool/process |
| Baseline metric | What can be measured today |
| Data feasibility | Available / restricted / unknown |
| Pilot owner | Role that could sponsor pilot |
| Procurement path | Known / partially known / unknown |
| Willingness to pilot | Yes / Maybe / No — with evidence |
| Willingness to pay | Only record if explicitly discussed |
| Follow-up | Specific next step |

## Opportunity scoring rubric

Score each dimension 0–3 after the interview.

| Dimension | 0 | 1 | 2 | 3 |
| --- | --- | --- | --- | --- |
| Pain severity | none | mild | material | mission-critical |
| Frequency | rare | occasional | recurring | continuous/daily |
| Signal fragmentation | minimal | several sources | many disconnected sources | severe fragmentation + conflicts |
| Measurability | no baseline | weak proxy | usable baseline | clear quantitative baseline |
| Data access | blocked | uncertain | partial | feasible for controlled pilot |
| Sponsor strength | none | interested user | internal champion | budget/decision owner |
| Pilot safety | unacceptable risk | difficult | shadow mode possible | historical/shadow evaluation straightforward |
| Procurement clarity | unknown | complex/unclear | identifiable path | sponsor knows route/budget |

**Maximum: 24.**

Interpretation:

- **18–24:** strong design-partner candidate;
- **13–17:** continue discovery before proposing pilot;
- **8–12:** weak fit unless new evidence changes the case;
- **0–7:** do not force the opportunity.

A high score is not traction. It is prioritization evidence.

## First-use-case selection gate

Do not choose the commercial beachhead solely because it sounds strategic. Select the first use case only after comparing at least several discovery records.

The chosen use case should have:

1. repeated pain;
2. a concrete current workflow;
3. a measurable baseline;
4. feasible data access;
5. a low-risk historical or shadow-mode pilot path;
6. an identifiable sponsor/procurement route;
7. a problem AICIS can address without requiring unvalidated autonomous decision-making.

## Claim discipline

Allowed:

- "We interviewed X qualified practitioners" when records exist.
- "Y of X described source fragmentation as a recurring problem" when supported by logs.
- "A design partner agreed to a shadow-mode pilot" only when written evidence exists.

Not allowed:

- converting interest into a customer claim;
- treating a meeting as an LOI;
- inferring willingness to pay from enthusiasm;
- claiming quantified savings without a defensible baseline;
- publishing identifiable interview details without permission.

## Output for investors

Customer discovery becomes investor evidence only when it can be summarized transparently:

- number and type of qualified interviews;
- repeated problem patterns;
- contradictions and negative evidence;
- selected first workflow and why;
- pilot conversion funnel;
- what remains unproven.
