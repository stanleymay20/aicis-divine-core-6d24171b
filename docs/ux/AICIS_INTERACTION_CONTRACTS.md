# AICIS Interaction Contracts

## Entity selection

Any workspace may select an intelligence entity by calling the Intelligence OS context or dispatching the browser event:

aicis:select-entity

The event detail must satisfy the AICISEntity contract.

Selection writes a stable query parameter in the form:

entity=TYPE:ID

This allows bookmarking, sharing and refresh-safe context.

## Intelligence Inspector

The inspector is contextual, not a new route.

Tabs:

- Overview
- Evidence
- Signals
- Forecasts
- Relations
- History
- Ask

Desktop uses a collapsible right-side inspector.
Mobile uses a bottom drawer.

Closing the inspector does not erase the selected URL context.
Clearing the entity removes the entity query parameter.

## Command palette

Ctrl+K or Command+K opens the AICIS command palette.

Initial scope:

- Navigate among the eight workspaces
- Open contextual Ask AICIS
- Respect operator/admin visibility for System

Later milestones may add entity search, saved investigations and natural-language commands.

## Ask AICIS

The shell-level Ask surface carries selected entity context into the existing intelligence-engine route.

This foundation does not fabricate an answer or bypass existing intelligence execution paths.

## Trust indicators

Confidence, evidence coverage and freshness components must accept missing values.

Missing data must render as UNKNOWN or unavailable rather than a default score.

## Responsive rule

Desktop: workspace canvas plus collapsible inspector.
Mobile: primary workspace plus bottom-drawer inspector.

Desktop layouts must never simply be scaled down onto mobile.
