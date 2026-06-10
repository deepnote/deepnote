---
verdict: APPROVAL
card_id: jlb11a
review_number: 1
commit: 3684ca4
date: 2026-06-09
has_backlog_items: false
---

# Review — jlb11a (EXTIDCI1, cycle 1)

Case-insensitive SQL integration ID matching across built-in and external IDs.
Complete-fix scope (all three parts of the #325 fix) shipped in one commit on
`packages/cli/` only.

## Gate 1 — completion claim: PASS

- **DoD present and strong.** Intent is concrete and written from outside the
  code (a user sees one integration regardless of casing; `deepnote lint` reports
  it once; credentials fetched once). It names the observable regression signal
  (duplicate lint entries / duplicate fetch). Not a restatement of the title.
- **Capstone is real and unfakeable.** The authoritative combined capstone asserts
  `lint.integrations.missing === ['My-Warehouse']` over a three-block project
  mixing a built-in (`Pandas-DataFrame`) with two casings of one external
  (`My-Warehouse`/`my-warehouse`). It exercises `checkForIssues` — the exact
  function `deepnote lint` calls — so it cannot be ticked by a unit test in
  isolation or by mocking the assembly away. The earlier external-only capstone
  is explicitly superseded; no stale/weak capstone remains in force.
- **Checkbox integrity.** Manual Test ("Pass") is honestly left unchecked with a
  clear, verifiable rationale: the CLI-binary e2e depends on a Python analysis
  subprocess that returns empty output in this worktree, and the executor proved
  the failure is environmental (pre-existing `commands/lint.test.ts` fails
  identically on unmodified HEAD), not a regression. The lint `missing`-summary
  behavior is covered at the library boundary instead. This is exactly the right
  disclosure — no false attestation. "Code review approved" boxes correctly left
  for the reviewer.

## Gate 2 — implementation quality: PASS

Verified the diff against the gold standard for a correctness fix on a shared
collection/aggregation path.

- **Part 1 (built-in).** `isBuiltinIntegration` added in `constants.ts` with
  accurate JSDoc, `BUILTIN_INTEGRATIONS.has(id.toLowerCase())` against a Set
  documented as canonical-lowercase. Both call sites routed through it. `BUILTIN_INTEGRATIONS`
  export retained (still consumed by `commands/lint.test.ts`). No duplicated
  `.toLowerCase()` keying logic — the helper is the single source of truth. DRY satisfied.
- **Part 2 (robustness).** The `as string | undefined` cast is replaced with a
  `typeof rawId === 'string' ? rawId : undefined` guard, so a malformed
  `sql_integration_id` is dropped before `.toLowerCase()`. `collect-integrations.ts`
  keeps its `z.string().optional()` parse. No lazy cast, no swallowed error.
- **Part 3 (external dedup).** `collectRequiredIntegrationIds` keys a
  `Map<lowercased, firstSeenOriginal>` and returns `Array.from(map.values())`.
  `checkMissingIntegrations` keys `configured`/`missing`/`usage` by lowercased id,
  carries a `displayCasing` map, and derives messages, `details.integrationId`,
  and `summary.*` from the first-seen original casing. Confirmed
  `getIntegrationEnvVarName(displayId)` yields the same env var as the lowercased
  key would (it sanitizes+uppercases), so display casing flowing through is
  consistent with the env-var contract. Confirmed `idsToFetch` in
  `fetch-and-merge-integrations.ts` derives from `requiredIds`, so deduping at
  collection genuinely removes the redundant fetch — the Intent's "fetched once"
  claim holds end-to-end.

- **No consumer drift.** `details.integrationId` is now always the display casing,
  consistent with the message string; no consumer depends on per-block raw casing
  (the only `.integrationId` consumers are unrelated `merge`/`fetch` error paths).

- **TDD shape is genuine.** Tests assert behavior, not internals. Failure/edge
  cases present and meaningful: non-string id ignored without throwing, no-over-merge
  for genuinely distinct externals, configured-via-env case, built-in filtered
  case-insensitively. Not happy-path-only. The library-level capstone walks the
  real `checkForIssues` path against real inputs (no overmocking).

- **Tests executed and green.** Re-ran `pnpm --filter @deepnote/cli exec vitest run`
  on the three files with `/tmp/dn-venv/bin` on PATH: 31/31 pass
  (constants 3, collect-integrations 7, analysis 21).

- **Hygiene.** Commit touches only `packages/cli/`; no `.gitban/`/`.claude/` staged.
  JSDoc updated on the new helper and both modified collectors (DaC satisfied).
  No ADR governs ID casing; none required.

## BLOCKERS

None.

## FOLLOW-UP

None. The card is the complete #325 fix and introduces no tech debt — it removes
the built-in-vs-external casing inconsistency rather than adding any.

## Outstanding close-out actions

- The CLI-binary `deepnote lint` e2e (Manual Test) remains unverified due to the
  worktree's Python toolkit venv producing empty analysis output. This is an
  environment limitation, not a code gap, and the behavior is covered at the
  `checkForIssues` library boundary. Re-running the manual lint on a mixed-case
  fixture in an environment with a working toolkit venv is a nice-to-have before
  the PR ships, not a merge blocker.
