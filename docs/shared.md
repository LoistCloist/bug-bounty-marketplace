# @bbm/shared

The Zod schemas (and inferred TypeScript types) that form the data contract
between `apps/web`, `apps/api`, `tests/` and the `workers/` services. Import
from `@bbm/shared`; everything is re-exported from `src/index.ts`.

## Schemas

| Module                   | Exports                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/common.ts`          | `TimestampSchema` (ISO datetime), `AddressSchema` (`0x` + 40 hex), `IdSchema`                                                                         |
| `src/contract.ts`        | `ContractSchema`, `ContractStatusSchema`, `ContractSubmissionFieldsSchema`, source filename/size checks, `CONTRACT_SOURCE_MAX_BYTES` (100 KB)         |
| `src/bounty.ts`          | `BountySchema`                                                                                                                                        |
| `src/finding.ts`         | `FindingSchema`, `FindingStatusSchema` (`Flagged → Submitted → Verified → Disputed/Rejected → Paid`), `FindingSeveritySchema`, status history entries |
| `src/poc-submission.ts`  | `PoCSubmissionSchema`, `SandboxStatusSchema`                                                                                                          |
| `src/dispute.ts`         | `DisputeSchema`, `DisputeRulingSchema`                                                                                                                |
| `src/auditor-profile.ts` | `AuditorProfileSchema`                                                                                                                                |

## Generated JSON Schema

Non-TypeScript services consume `packages/shared/schema/*.json`, one file per
top-level entity (`Contract`, `Bounty`, `Finding`, `FindingStatus`,
`PoCSubmission`, `Dispute`, `AuditorProfile`). They are generated with
`z.toJSONSchema` and committed:

```sh
pnpm --filter @bbm/shared gen:schema    # rewrite schema/*.json
```

Never edit them by hand. CI (`shared` job) regenerates them and fails on any
diff, and the `analysis` job checks that `workers/analysis`'s pydantic models
(generated from these files) are up to date too. After a schema change, run
`gen:schema`, then `uv run scripts/gen-types.sh` in `workers/analysis`, and
commit both.

## Scripts

- `pnpm --filter @bbm/shared lint`
- `pnpm --filter @bbm/shared typecheck`
- `pnpm --filter @bbm/shared test`: schema unit tests, plus a check that the
  committed JSON matches the generator output.
- `pnpm --filter @bbm/shared gen:schema`
