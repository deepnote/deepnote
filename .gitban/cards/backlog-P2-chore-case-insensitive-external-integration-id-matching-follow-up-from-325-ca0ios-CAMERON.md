# case-insensitive external integration ID matching (follow-up from #325)

> Backlog tracking card. Non-blocking follow-up surfaced by the code review of card 234rnd (#325). Out of scope for #325, which covers built-in ID filtering only. Whether to act on this is ultimately an upstream product decision.

## Task Overview

* **Task Description:** Normalize *external* integration ID matching to be case-insensitive, mirroring the lowercase convention already used for built-in IDs (`isBuiltinIntegration`) and for local-vs-required IDs in `packages/cli/src/integrations/fetch-and-merge-integrations.ts:23-24`.
* **Motivation:** After #325, built-in ID filtering is case-insensitive, but external IDs are still keyed on raw casing. Two SQL blocks referencing the same external integration with different casing (`my-warehouse` vs `My-Warehouse`) collapse to one env var (`SQL_MY_WAREHOUSE`) yet surface as two distinct entries in the missing-integration / required-IDs sets. This is a pre-existing inconsistency, not introduced by #325.
* **Scope:** `packages/cli/src/integrations/collect-integrations.ts` (`collectRequiredIntegrationIds`) and `packages/cli/src/utils/analysis.ts` (`checkMissingIntegrations`) — key the required/missing sets on a normalized ID while preserving a single original-casing representative for display.
* **Related Work:** Follow-up from card 234rnd / upstream issue #325; consistency with `fetch-and-merge-integrations.ts`.
* **Estimated Effort:** Half day (logic + tests), pending upstream interest.

**Required Checks:**
* [ ] **Task description** clearly states what needs to be done.
* [ ] **Motivation** explains why this work is necessary.
* [ ] **Scope** defines what will be changed.

---

## Work Log

| Step | Status/Details | Universal Check |
| :---: | :--- | :---: |
| **1. Review Current State** | Not started — backlog | - [ ] Current state is understood and documented. |
| **2. Plan Changes** | Not started — backlog | - [ ] Change plan is documented. |
| **3. Make Changes** | Not started — backlog | - [ ] Changes are implemented. |
| **4. Test/Verify** | Not started — backlog | - [ ] Changes are tested/verified. |
| **5. Update Documentation** | Not started — backlog | - [ ] Documentation is updated [if applicable]. |
| **6. Review/Merge** | Not started — backlog | - [ ] Changes are reviewed and merged. |

#### Work Notes

> Captured from the gitban-reviewer findings on card 234rnd (tag: external-id-casing-followup).

**Commands/Scripts Used:**
```bash
# none yet — backlog item
```

**Decisions Made:**
* Deliberately excluded from #325 to keep that fix tightly scoped to built-in filtering.

**Issues Encountered:**
* None — not yet started.

---

## Completion & Follow-up

| Task | Detail/Link |
| :--- | :--- |
| **Changes Made** | Pending |
| **Files Modified** | Pending |
| **Pull Request** | Pending |
| **Testing Performed** | Pending |

### Follow-up & Lessons Learned

| Topic | Status / Action Required |
| :--- | :--- |
| **Related Chores Identified?** | Sourced from 234rnd review |
| **Documentation Updates Needed?** | TBD |
| **Follow-up Work Required?** | This card is the follow-up |
| **Process Improvements?** | N/A |
| **Automation Opportunities?** | N/A |

### Completion Checklist

* [ ] All planned changes are implemented.
* [ ] Changes are tested/verified (tests pass, configs work, etc.).
* [ ] Documentation is updated (CHANGELOG, README, etc.) if applicable.
* [ ] Changes are reviewed (self-review or peer review as appropriate).
* [ ] Pull request is merged or changes are committed.
* [ ] Follow-up tickets created for related work identified during execution.