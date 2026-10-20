# Frontend design and setup review

Reviewed against Milestone 2 - Design and Setup (October 3, 2026).

## Design assessment

The layered Next.js/Fastify architecture and shared Zod API schemas are a good
fit for the four-person team. Keeping analysis and untrusted Foundry execution
outside request handling is essential. The frontend should display the backend's
verdicts, never infer verification from an AI explanation or a successful upload.
The implementation preserves that separation.

The document describes a mock-based prototype and a future integrated MVP. These
are distinct deliverables: this change completes and polishes the frontend demo,
while wallet authentication, private source delivery, real analysis, sandboxing,
and on-chain settlement still need the corresponding backend services.

Before live integration the team should specify the following API behavior:

- Authentication and authorization for each role, including arbiter privileges.
- A durable claim record independent of findings, so claims made during analysis
  retain their ownership and expiry.
- Server timestamps for analysis, submission, verification, and challenge windows.
- First verified finding wins, and one payout per bounty, including competing
  verified findings and disputed findings on the same contract.
- Refund grace period for PoCs submitted before the deadline but still running.
- Authenticated source, raw Slither output, and PoC retrieval endpoints. Existing
  reference strings do not provide the actual file contents.
- Explicit stake currency/units, token decimals, and transaction status/errors.

## Implemented frontend

- Responsive charcoal/emerald dashboard, workspace navigation, role switching,
  active navigation state, keyboard focus indicators, and a skip link.
- API-backed workspace counts and recent contracts; searchable contract portfolio
  with status filters and loading, empty, disconnected, and error states.
- Solidity upload, positive bounty and future-deadline validation, explanatory
  submission panel, and downloadable demo inputs.
- Auditor queue search/sort, claim action, profile, staking, upload validation,
  claim countdown, status history, false-positive action, and live verification
  and payment updates.
- Developer finding review, advisory AI label, status history, challenge-window
  dispute form, cancellation confirmation, and refund eligibility feedback.
- Arbiter evidence view, periodic updates, ruling confirmation, and result filters.
- Getting started page explains all three roles and explicitly labels simulation.

## Setup corrections

Browser startup now initializes the seed database before displaying the app.
The checked-in MSW worker was version 2.15.0 while the installed package was 2.6.5;
regenerating it fixed a browser runtime error. Worker initialization failures now
show an actionable error rather than silently sending requests to missing routes.
The frontend defaults to demo mode, so `pnpm dev` works without Unix-only
inline environment assignment. Data is session-local and resets on reload.

The Windows Turbopack production CSS worker failed to start in this environment.
Development and production use Next.js's Webpack option. The server bundle excludes
MSW's browser-only entry; it is loaded by the client provider. The optimized
production build was verified with this configuration.

## Integration boundary

No real funds move. The fixed demo identities are not authentication or access
control. Do not deploy the mock environment as a real financial marketplace.
Disabling mocking requires implementing the documented `/api/*` contract and
replacing the mock wallet adapter. The PDF's claim that this needs no UI changes
is too broad for real transaction confirmations, rejected signatures, network
switching, permissions, and retriable worker failures.

## Run and verify

From the repository root, run `pnpm install`, then `pnpm dev`, and open
http://localhost:3000. Use Getting started for sample files and the demo walkthrough.
Frontend checks are `pnpm --filter @bbm/web typecheck`, `lint`, `test`, and `build`.

Validation completed: 23 Vitest tests pass, ESLint passes, TypeScript passes,
and the optimized production build succeeds. Browser checks covered desktop and
narrow mobile layouts, contract upload through generated findings, stake unlock,
claiming, PoC submission through verification, and a confirmed arbiter ruling.
