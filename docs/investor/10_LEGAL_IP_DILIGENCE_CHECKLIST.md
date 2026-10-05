# AICIS Legal, IP and Regulatory Diligence Checklist

> **Operational checklist only — not legal advice.** Final company formation, contracts, data-protection analysis, AI Act classification, critical-infrastructure obligations, procurement and IP documents should be reviewed by qualified German/EU counsel.

## 1. Entity and corporate records

Before institutional fundraising or contracting, assemble:

- incorporation documents;
- commercial-register extract when incorporated;
- articles/shareholder agreement;
- current cap table;
- beneficial-owner records where applicable;
- board/shareholder resolutions;
- bank/accounting setup;
- tax registrations;
- grant restrictions and state-aid documentation where relevant.

Until these exist, investor materials must state that AICIS is not yet incorporated rather than implying a company already exists.

## 2. Founder and IP chain of title

Create a clean evidence trail showing who owns the technology.

Checklist:

- [ ] identify every contributor to source code, models, data pipelines, designs and documentation;
- [ ] identify work created before incorporation;
- [ ] identify code generated or materially assisted by third-party AI tools where terms may matter;
- [ ] prepare founder IP assignment to the future company;
- [ ] obtain contributor/contractor assignments where needed;
- [ ] confirm employment/university agreements do not create competing ownership claims;
- [ ] record trademarks/domains/project names;
- [ ] record patentable inventions only after specialist review and before public disclosure where relevant.

Do not tell investors that the company owns all IP until assignments and contributor records support that statement.

## 3. Open-source and third-party software

Maintain a software bill of materials and license review.

For each dependency record:

- package/project;
- version;
- license;
- direct/transitive status;
- commercial-use restrictions;
- attribution obligations;
- copyleft/network-copyleft implications;
- security status;
- replacement path for unacceptable dependencies.

Treat model providers, APIs, map services and external data feeds as separate third-party dependencies; software licensing alone does not settle data or model-use rights.

## 4. Data rights and provenance

For every source that can influence a user-facing assessment, record:

- source owner/provider;
- collection mechanism;
- public/private status;
- terms/license;
- redistribution restrictions;
- commercial-use rights;
- attribution requirements;
- geography restrictions;
- personal-data presence;
- retention limits;
- timestamp/freshness;
- provenance identifier;
- withdrawal/deletion mechanism.

No dataset should become a commercial dependency merely because it is technically accessible.

## 5. GDPR / data protection

Before processing partner or user data, determine with counsel:

- controller/processor roles;
- lawful basis;
- data minimization;
- purpose limitation;
- privacy notices;
- records of processing;
- retention/deletion;
- access and data-subject rights;
- international transfers;
- subprocessors;
- security controls;
- breach response;
- whether a DPIA is required;
- whether special-category or sensitive operational data is involved.

For design-partner pilots, prefer the minimum data necessary. Historical, synthetic or appropriately de-identified data should be considered where it can answer the evaluation question.

## 6. EU AI Act readiness

As of October 2026, the EU AI Act is already in progressive application and enforcement has started for applicable rules. AICIS must not wait until enterprise scale to determine its role and system classification.

For every commercial use case document:

- intended purpose;
- provider/deployer/importer/distributor roles as applicable;
- users and affected persons;
- whether Article 50 transparency duties apply;
- whether a prohibited practice could be implicated;
- whether current or future high-risk classification could apply;
- human oversight;
- technical documentation/evidence retention;
- logging and traceability;
- model/provider dependencies;
- risk-management and post-market obligations if applicable.

Do not infer that "decision support" automatically places AICIS outside regulated categories. Classification depends on intended purpose and actual deployment context.

Current official reference points should be rechecked before each regulated deployment because implementation guidance and timelines continue to evolve.

## 7. Critical-infrastructure / resilience context

AICIS may be evaluated with utilities or other critical-infrastructure operators. As of October 2026, Germany's KRITIS-Dachgesetz is in force and implementation details continue to develop.

Before a KRITIS-related pilot determine:

- whether the partner/facility is in scope of relevant KRITIS rules;
- sector-specific requirements;
- physical-resilience and cyber obligations;
- reporting/registration requirements;
- supplier/security assessment requirements;
- whether AICIS would become a material operational dependency;
- whether additional BSI, NIS2/BSIG or sector rules apply;
- required contractual allocation of responsibility.

AICIS should begin as non-authoritative historical replay or shadow-mode decision support unless a properly reviewed agreement and evidence base justify a more consequential role.

## 8. Public-sector procurement

Before treating a public body as commercial pipeline, identify:

- contracting entity;
- budget owner;
- procurement threshold/process;
- framework agreements or procurement vehicles;
- tender requirements;
- security/data-residency requirements;
- accessibility/interoperability/open-standards requirements;
- conflict-of-interest rules;
- grant-funded procurement restrictions;
- whether an innovation/proof-of-concept route exists.

An enthusiastic public-sector user is not the same as an authorized buyer.

## 9. Customer and pilot contracts

Before a pilot starts, determine whether the following are needed:

- NDA;
- pilot/SOW agreement;
- DPA;
- information-security schedule;
- subprocessor list;
- acceptable-use terms;
- SLA/support terms;
- IP/background-IP terms;
- liability/indemnity allocation;
- confidentiality/publicity permission;
- data return/deletion terms;
- audit rights;
- termination rights;
- governing law/jurisdiction.

The non-binding template in `08_PILOT_LOI_TEMPLATE.md` is a scoping aid, not a substitute for these documents.

## 10. Insurance

Before material enterprise/public deployments, obtain advice/quotes for relevant coverage such as:

- professional indemnity / errors and omissions;
- cyber insurance;
- general commercial liability;
- D&O after incorporation/fundraising;
- employer coverage when hiring.

Record quotes separately from active policies.

## 11. Security diligence

Maintain investor/customer evidence for:

- access control and RLS;
- secret management;
- privileged server-side boundaries;
- dependency scanning;
- CodeQL/static analysis;
- CI verification;
- vulnerability and incident process;
- backup/recovery;
- data retention/deletion;
- audit logging;
- disaster recovery/business continuity;
- penetration testing when justified by deployment stage.

Do not equate passing CI/security tests with an external certification.

## 12. Regulatory evidence register

Maintain a table in the data room:

| Topic | Applicability | Owner | Evidence | Last reviewed | Next action |
| --- | --- | --- | --- | --- | --- |
| Company/entity | TBD | Founder | incorporation docs | — | form entity when required |
| IP chain | TBD | Founder/counsel | assignments | — | complete chain-of-title review |
| GDPR | use-case specific | Founder/DPO/counsel | data maps/DPA/DPIA | — | assess per pilot |
| EU AI Act | use-case specific | Founder/counsel | classification memo | — | assess intended purpose |
| KRITIS/NIS2/BSI | partner/use-case specific | Partner + counsel | applicability memo | — | assess before infrastructure pilot |
| Procurement | buyer specific | Customer sponsor | procurement route | — | validate per target |

## 13. Diligence red flags to eliminate

Before a serious institutional round, avoid:

- unclear founder/company ownership of code;
- undocumented contributors;
- unreviewed restrictive licenses;
- commercially important scraped/data sources with unclear rights;
- customer claims unsupported by agreements;
- undisclosed grants or IP restrictions;
- missing privacy/security documentation;
- regulatory classification by assumption rather than analysis;
- public claims that exceed validation evidence.

## 14. Current regulatory sources to monitor

At minimum, regularly recheck official European Commission AI Act guidance and official German BBK/BSI information for resilience/critical-infrastructure obligations before commercial deployments.

This checklist is complete only when supporting documents exist in the controlled data room; ticking a box without evidence is not diligence readiness.
