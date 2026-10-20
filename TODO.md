# TODO

## CI / repo settings

- [ ] **Apply the `main` branch ruleset (repo admin).** `.github/rulesets/main.json`
      adds `CI OK` as a required status check, but the live ruleset (id 24287837)
      doesn't have it yet, so a red CI run does not block merges into `main`.
      A repo admin needs to run:

      ```sh
      gh api -X PUT repos/LoistCloist/bug-bounty-marketplace/rulesets/24287837 --input .github/rulesets/main.json
      ```

      Then verify:
      - `gh api repos/LoistCloist/bug-bounty-marketplace/rulesets/24287837 --jq '.rules[].type'`
        includes `required_status_checks`.
      - A PR with a failing check shows "Required statuses must pass" and can't be merged.
      - A docs-only PR still gets `CI OK` and stays mergeable.

## MVP decisions to revisit

- [ ] **Disputes: developer only for MVP.** `DisputeResolution.openDispute` only
      accepts the developer, which matches US7 and the current contract. M1 R21
      says developers *and* auditors can open disputes. Before post-MVP, ask the
      team what an auditor-opened dispute means and against whom, then decide
      whether to change the contract (needs a redeploy).
- [ ] **Amounts: wei as decimal strings.** Money goes over the API as wei strings,
      not JS numbers. The shared `BountySchema.amount` and the web mocks still use
      numbers and must be migrated (plan Phase 1).
