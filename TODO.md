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
