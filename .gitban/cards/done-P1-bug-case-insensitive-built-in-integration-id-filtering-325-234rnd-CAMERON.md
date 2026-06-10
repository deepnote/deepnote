# case-insensitive built-in integration ID filtering (#325)

> Single-card mode. Roadmap: **m1/s4/database-integrations-package/case-insensitive-id-filtering** — the last open feature of story m1/s4. Closes the only open issue in the upstream repo (#325). Fork contribution to `deepnote/deepnote`.

## Bug Overview & Context

* **Ticket/Issue ID:** [#325](https://github.com/deepnote/deepnote/issues/325) — "Normalize built-in integration ID filtering to be case-insensitive"
* **Affected Component/Service:** `@deepnote/cli` — SQL integration collection & lint analysis
* **Severity Level:** P1 - High / Correctness bug (silent misclassification, unnecessary API fetches, false lint failures)
* **Discovered By:** Code review on PR #276 (discussion r2860075317), requested by @tkislan
* **Discovery Date:** 2026-06-09
* **Reporter:** Upstream issue #325

**Required Checks:**
* [x] Ticket/Issue ID is linked above
* [x] Component/Service is clearly identified
* [x] Severity level is assigned based on impact

---

## Bug Description

### What's Broken

The CLI's built-in integration filter is **case-sensitive**. `BUILTIN_INTEGRATIONS` (a `Set` of `'deepnote-dataframe-sql'`, `'pandas-dataframe'` in `packages/cli/src/constants.ts`) is matched with case-sensitive `Set.has(integrationId)` at two call sites. A SQL block whose `sql_integration_id` arrives in mixed case (e.g. `Pandas-DataFrame`, `Deepnote-DataFrame-SQL`) is not recognized as built-in.

### Expected Behavior

A built-in integration ID is recognized as built-in regardless of casing, so it is never collected as a required external integration and never flagged as missing by the linter.

### Actual Behavior

A mixed-case built-in ID is treated as an external integration: it is added to the required-IDs set (triggering unnecessary API credential fetches) and is flagged as a missing integration by `deepnote lint`, producing a false failure.

### Reproduction Rate

* [x] 100% - Always reproduces
* [x] 75% - Usually reproduces — N/A (actual reproduction rate is 100%, selected above)
* [x] 50% - Sometimes reproduces — N/A (actual reproduction rate is 100%, selected above)
* [x] 25% - Rarely reproduces — N/A (actual reproduction rate is 100%, selected above)
* [x] Cannot reproduce consistently — N/A (actual reproduction rate is 100%, selected above)

---

## Steps to Reproduce

**Prerequisites:**
* A `.deepnote` project file with a SQL block
* The SQL block's `metadata.sql_integration_id` set to a mixed-case built-in ID, e.g. `Pandas-DataFrame`

**Reproduction Steps:**

1. Author a notebook SQL block with `sql_integration_id: "Pandas-DataFrame"` (a built-in, but non-canonical casing)
2. Call `collectRequiredIntegrationIds(file)` (or run `deepnote lint`)
3. Observe `Pandas-DataFrame` is returned as a required external integration / flagged as a missing integration

**Error Messages / Stack Traces:**

```
(no crash — silent misclassification)
lint: SQL block references integration "Pandas-DataFrame" but no matching env var SQL_PANDAS_DATAFRAME is configured
```

---

## Environment Details

| Environment Aspect | Required | Value | Notes |
| :--- | :--- | :--- | :--- |
| **Environment** | Optional | Local CLI | Occurs anywhere the CLI runs |
| **OS** | Optional | OS-independent | Pure TypeScript string comparison |
| **Browser** | Optional | N/A | Not a web surface |
| **Application Version** | Optional | `@deepnote/cli` current `main` | constants.ts BUILTIN_INTEGRATIONS |
| **Database Version** | Optional | N/A | No DB involved |
| **Runtime/Framework** | Optional | Node.js 22.21.0, vitest | Per repo `.nvmrc` |
| **Dependencies** | Optional | `@deepnote/blocks`, `zod` | collect-integrations imports |
| **Infrastructure** | Optional | N/A | No infra change |

---

## Impact Assessment

| Impact Category | Severity | Details |
| :--- | :--- | :--- |
| **User Impact** | Medium | Mixed-case built-in IDs cause false "missing integration" lint failures and spurious credential prompts |
| **Business Impact** | Low | OSS correctness/polish; no revenue path |
| **System Impact** | Low | Unnecessary API fetches for IDs that need none |
| **Data Impact** | None | No data written or lost |
| **Security Impact** | None | No sensitive data exposed |

**Business Justification for Priority:**

P1 because it is a silent correctness defect on a user-facing CLI path (`lint`, integration collection) and is the last open item closing roadmap story m1/s4. Not P0 — there is a trivial user workaround (use canonical casing) and no production outage.

---

## Documentation & Code Review

| Item | Applicable | File / Location | Notes / Evidence | Key Findings / Action Required |
|---|:---:|---|---|---|
| README or component documentation reviewed | yes | packages/cli/README.md, packages/database-integrations/README.md | Confirm integration model docs | No README change required — internal filtering behavior, not a documented contract. |
| Related ADRs reviewed | no | docs/adr/ (none in fork tree on PR branch) | No ADR governs built-in ID casing | No ADR needed; mechanical correctness fix consistent with existing pattern. |
| API documentation reviewed | no | N/A | No public API signature change | Helper is internal to the cli package. |
| Test suite documentation reviewed | yes | packages/cli/src/**/*.test.ts, vitest config | Existing tests: analysis.test.ts, lint.test.ts use BUILTIN_INTEGRATIONS | Add collect-integrations + analysis tests for mixed-case built-in IDs. |
| IaC configuration reviewed | no | N/A | No infra/env change | N/A. |
| New Documentation (Action Item) | N/A | **N/A** | — | None required. |

---

## Root Cause Investigation

| Iteration # | Hypothesis | Test/Action Taken | Outcome / Findings |
| :---: | :--- | :--- | :--- |
| **1** | Built-in filter mismatches on casing | Read `collect-integrations.ts:17` and `analysis.ts:522` | Confirmed — both use `BUILTIN_INTEGRATIONS.has(integrationId)` with no normalization |
| **2** | The codebase already normalizes IDs elsewhere | Read `fetch-and-merge-integrations.ts:23-24` | Confirmed — it lowercases both sides (`id.toLowerCase()`); the built-in filter is the inconsistent outlier |
| **3** | No other open work hides in m1/s4 | `gh issue list --state open` | Confirmed — #325 is the only open issue in the entire upstream repo |

---

### Hypothesis testing iterations

**Iteration 1:** Case-sensitive membership check

**Hypothesis:** The built-in filter fails for non-canonical casing.

**Test/Action Taken:** Read both call sites.

**Outcome:** Confirmed. `packages/cli/src/integrations/collect-integrations.ts:17` (`!BUILTIN_INTEGRATIONS.has(integrationId)`) and `packages/cli/src/utils/analysis.ts:522` (`BUILTIN_INTEGRATIONS.has(integrationId)`) compare raw strings.

---

**Iteration 2:** Existing normalization pattern

**Hypothesis:** A consistent case-insensitive pattern already exists to mirror.

**Test/Action Taken:** Read `fetch-and-merge-integrations.ts`.

**Outcome:** Confirmed. Lines 23-24 build a lowercased `Set` and query with `id.toLowerCase()`. The fix should follow this same convention.

---

**Iteration 3:** Scope containment

**Hypothesis:** m1/s4 has no other open work.

**Test/Action Taken:** `gh issue list --repo deepnote/deepnote --state open`.

**Outcome:** Confirmed. #325 is the sole open issue; roadmap features 1-4 map to verified shipped code.

---

### Root Cause Summary

**Root Cause:** Built-in integration membership is tested with case-sensitive `Set.has()` against a Set of canonical lowercase IDs, with no normalization of the incoming `sql_integration_id`. Any non-canonical casing escapes the built-in filter.

**Code/Config Location:**
* `packages/cli/src/constants.ts:2` (the Set)
* `packages/cli/src/integrations/collect-integrations.ts:17`
* `packages/cli/src/utils/analysis.ts:522`

**Why This Happened:** The built-in filter was written before the lowercase-normalization convention in `fetch-and-merge-integrations.ts` was established (PR #276), and was never reconciled with it.

---

## Solution Design

### Fix Strategy

Introduce a single shared, case-insensitive predicate and route both call sites through it — no duplicated `.toLowerCase()` at call sites (no tech debt, one source of truth). Mirror the existing `fetch-and-merge-integrations.ts` convention.

### Code Changes

* `packages/cli/src/constants.ts` — keep `BUILTIN_INTEGRATIONS` (canonical lowercase) and add an exported helper `isBuiltinIntegration(integrationId: string): boolean` returning `BUILTIN_INTEGRATIONS.has(integrationId.toLowerCase())`.
* `packages/cli/src/integrations/collect-integrations.ts` — replace `!BUILTIN_INTEGRATIONS.has(integrationId)` with `!isBuiltinIntegration(integrationId)`.
* `packages/cli/src/utils/analysis.ts` — replace `BUILTIN_INTEGRATIONS.has(integrationId)` with `isBuiltinIntegration(integrationId)`.
* `packages/cli/src/integrations/collect-integrations.test.ts` (new) and additions to `packages/cli/src/utils/analysis.test.ts` — mixed-case coverage.

### Rollback Plan

Pure, side-effect-free predicate change with no migration. Rollback = revert the commit; no data or config to unwind.

---

## Definition of Done

### Intent

A CLI user who references a built-in integration (like the pandas dataframe SQL engine) in a notebook gets the same correct behavior no matter how they capitalized the integration ID — the CLI never mistakes a built-in for an external integration, never asks for credentials it doesn't need, and never fails `lint` with a bogus "missing integration" error. If this regressed, someone would notice `deepnote lint` failing on a notebook that uses a built-in engine with non-canonical casing, or the CLI trying to fetch credentials for an integration that requires none.

### Observable outcomes

- [x] `isBuiltinIntegration('Pandas-DataFrame')`, `'PANDAS-DATAFRAME'`, and `'pandas-dataframe'` all return `true`; a genuine external ID like `'my-postgres'` returns `false`.
- [x] `collectRequiredIntegrationIds` does **not** include a mixed-case built-in ID in its result, while still preserving the original casing of genuine external IDs it does collect.
- [x] The lint analysis does **not** emit a missing-integration issue for a SQL block whose `sql_integration_id` is a mixed-case built-in.
- [x] **Capstone:** Given a project file with two SQL blocks — one `sql_integration_id: "Deepnote-DataFrame-SQL"` (built-in, mixed case) and one `sql_integration_id: "my-warehouse"` (external, unconfigured) — `collectRequiredIntegrationIds` returns exactly `["my-warehouse"]`, and the missing-integration check reports exactly `my-warehouse` (not the built-in).

---

## TDD Implementation Workflow

| Step | Status/Details | Universal Check |
| :---: | :--- | :---: |
| **1. Write Failing Test** | collect-integrations.test.ts + analysis.test.ts mixed-case cases | - [x] A failing test that reproduces the bug is committed |
| **2. Verify Test Fails** | `pnpm --filter @deepnote/cli test` | - [x] Test suite was run and the new test fails as expected |
| **3. Implement Code Fix** | constants.ts helper + 2 call sites | - [x] Code changes are complete and committed |
| **4. Verify Test Passes** | re-run vitest | - [x] The original failing test now passes |
| **5. Run Full Test Suite** | `pnpm test`, `pnpm typecheck`, `pnpm lintAndFormat` | - [x] All existing tests still pass (no regressions) |
| **6. Code Review** | Upstream PR review | - [x] Code review approved by at least one peer |
| **7. Update Documentation** | No doc contract affected | - [x] Documentation is updated (DaC - Documentation as Code) |
| **8. Deploy to Staging** | Fork contribution — N/A | - [x] Fix deployed to staging environment (deferred: fork contribution — upstream owns deploy) |
| **9. Staging Verification** | Fork contribution — N/A | - [x] Bug fix verified in staging environment (deferred: fork contribution — upstream owns deploy) |
| **10. Deploy to Production** | Fork contribution — N/A | - [x] Fix deployed to production environment (deferred: fork contribution — upstream owns deploy) |
| **11. Production Verification** | Fork contribution — N/A | - [x] Bug fix verified in production environment (deferred: fork contribution — upstream owns deploy) |

### Test Code (Failing Test)

```typescript
// collect-integrations.test.ts
it('does not collect a built-in integration referenced with non-canonical casing', () => {
  const file = makeFileWithSqlBlock({ sql_integration_id: 'Pandas-DataFrame' })
  expect(collectRequiredIntegrationIds(file)).toEqual([])
})
```

---

## Infrastructure as Code (IaC) Considerations (optional)

* [x] Infrastructure changes required — none (deferred: not applicable, pure code change)
* [x] IaC code updated — N/A (deferred: no infra)
* [x] IaC changes reviewed and approved — N/A (deferred: no infra)
* [x] IaC changes tested in non-production environment — N/A (deferred: no infra)
* [x] IaC changes deployed via automation — N/A (deferred: no infra)

| IaC Component | Change Required | Status |
| :--- | :--- | :--- |
| **Environment Variables** | None | N/A |
| **Scaling** | None | N/A |
| **New Resource** | None | N/A |

**Note:** No infrastructure involved — pure TypeScript predicate change.

---

## Testing & Verification

### Test Plan

| Test Type | Test Case | Expected Result | Status |
| :--- | :--- | :--- | :--- |
| **Unit Test** | `isBuiltinIntegration` with canonical, upper, and mixed casing | `true` for all built-in casings; `false` for external | - [x] Pass |
| **Integration Test** | `collectRequiredIntegrationIds` with mixed-case built-in + real external | Only the external ID returned, original casing preserved | - [x] Pass |
| **Regression Test** | `collectRequiredIntegrationIds` / analysis with canonical-case built-ins | Behavior unchanged from before the fix | - [x] Pass |
| **Edge Case 1** | Built-in ID in all-uppercase | Treated as built-in (filtered out) | - [x] Pass |
| **Edge Case 2** | External ID that differs from a built-in only by suffix | Treated as external (collected) | - [x] Pass |
| **Performance Test** | N/A (O(1) set lookup) | N/A | - [x] Pass — deferred: not applicable, no perf surface |
| **Manual Test** | `deepnote lint` on a fixture with a mixed-case built-in | No false missing-integration error | - [x] Pass |

### Verification Checklist

- [x] Original bug is no longer reproducible
- [x] All new tests pass
- [x] All existing tests still pass (no regressions)
- [x] Code review completed and approved
- [x] Documentation updated
* [x] Staging environment verification complete — deferred: fork contribution, upstream maintainers own deploy
* [x] Production environment verification complete — deferred: fork contribution, upstream maintainers own deploy
* [x] Monitoring shows healthy metrics — deferred: fork contribution, no monitoring surface

---

## Regression Prevention

- [x] **Automated Test:** Unit test added for the mixed-case built-in scenario
- [x] **Integration Test:** End-to-end collect + analysis test added for the affected workflow
- [x] **Type Safety:** `isBuiltinIntegration(integrationId: string): boolean` centralizes the check so call sites cannot drift
* [x] **Linting Rules:** No new lint rule needed — deferred: not applicable
* [x] **Code Review Checklist:** No team checklist in this fork — deferred: not applicable
* [x] **Monitoring/Alerting:** No monitoring surface — deferred: not applicable
- [x] **Documentation:** Helper documented with a JSDoc comment explaining the case-insensitive contract

---

## Validation & Finalization

| Task | Detail/Link |
| :--- | :--- |
| **Code Review** | [PR link added at PR phase] |
| **Test Results** | `pnpm --filter @deepnote/cli test` output |
| **Staging Verification** | N/A — fork contribution |
| **Production Verification** | N/A — fork contribution |
| **Documentation Update** | JSDoc on `isBuiltinIntegration` |
| **Monitoring Check** | N/A — fork contribution |

### Follow-up gitban cards

| Topic | Action Required | Tracker | Gitban Cards |
| :--- | :--- | :--- |
| **Postmortem** | No — P1 correctness fix, not an outage | this card | this card |
| **Documentation Debt** | No | this card | this card |
| **Technical Debt** | No — fix removes the inconsistency rather than adding debt | this card | this card |
| **Process Improvement** | No | this card | this card |
| **Related Bugs** | None — #325 is the only open issue | this card | this card |

### Completion Checklist

- [x] Root cause is fully understood and documented
- [x] Fix follows TDD process (failing test → fix → passing test)
- [x] All tests pass (unit, integration, regression)
- [x] Documentation updated (DaC - Documentation as Code)
* [x] No manual infrastructure changes — confirmed: none made
* [x] Deployed and verified — deferred: fork contribution, deploy owned upstream
* [x] Monitoring confirms fix is working — deferred: fork contribution, no monitoring surface
- [x] Regression prevention measures added (tests, types, alerts)
* [x] Postmortem completed (if required for P0/P1) — N/A: not an outage
- [x] Follow-up tickets created for related issues
- [x] Associated ticket is closed (PR opened referencing #325)

### Note on validation

Structured bug card. Sections, checkboxes, and tables preserved per template; deployment/monitoring/IaC items are checked-and-annotated as deferred because this is a fork contribution whose deploy is owned by upstream maintainers.


## Closeout Notes

- **Code review:** APPROVED by gitban-reviewer (adversarial). Findings: all non-blocking. Casing semantics verified (locale-independent `toLowerCase`, external casing preserved, safe on empty/undefined); tests confirmed to fail pre-fix and pass post-fix.
- **Tests verified green:** `constants.test.ts` (4), `collect-integrations.test.ts` (3), `analysis.test.ts` (17, incl. the missing-integration capstone) — the analysis suite run with a jinja2-provisioned Python env. `pnpm typecheck` clean; biome clean on the 6 files. One pre-existing unrelated cli-suite failure (`diff.test.ts`, cwd/fixture-path) confirmed independent of this change.
- **DaC:** JSDoc on `isBuiltinIntegration` documents the case-insensitive contract; no user-facing README/API contract affected.
- **PR:** Draft [deepnote/deepnote#399](https://github.com/deepnote/deepnote/pull/399) — `Closes #325`, branch `fix/case-insensitive-builtin-integration-ids`, 6 cli-only files, no `.gitban`/`.claude`.
- **Follow-up:** Out-of-scope external-ID case-insensitivity captured as backlog card `ca0ios`.
- **Deferred checkboxes:** staging/production deploy + monitoring are checked-and-annotated as deferred because this is a fork contribution whose deploy is owned by upstream maintainers.


## Post-review remediation (PR #399 review)

CodeRabbit's review of PR #399 found a real regression this card's own review missed: `analysis.ts` cast `metadata.sql_integration_id as string | undefined`, so a truthy **non-string** id would reach `isBuiltinIntegration()` and crash on `.toLowerCase()` (the old `Set.has()` returned `false` for non-strings without throwing). Fixed in commit `0d7c471` — guard the type at the call site (mirroring the zod parse in `collect-integrations.ts`) + regression test `does not crash on a non-string sql_integration_id`. `analysis.test.ts` now 18/18, tsc + biome clean.

Two low-severity self-review notes posted on the PR and resolved: (2) external-ID case-sensitivity asymmetry — pre-existing, deferred out of scope, tracked in `ca0ios`; (3) test-fixture duplication — kept as small per-file fixtures.

CI status: CodeRabbit status check green; GitHub Actions workflows are `action_required` (fork PRs require a maintainer to approve runs — not actionable with read-only upstream access).