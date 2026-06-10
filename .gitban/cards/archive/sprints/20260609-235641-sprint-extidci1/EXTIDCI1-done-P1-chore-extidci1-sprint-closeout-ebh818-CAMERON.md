# EXTIDCI1 Sprint Closeout

> **Sprint**: EXTIDCI1 | **Type**: chore | **Step**: N (final)
>
> Mandatory closeout card for sprint EXTIDCI1. Dispatched last. Walks accumulated retrospective items using the four-type deferral grid (see planner/SKILL.md per-item block format for the grid definitions).

## Purpose

Close out sprint EXTIDCI1: archive done cards, generate the sprint summary, update `CHANGELOG.md`, mark roadmap stories complete, and process every item in the Sprint Retrospective section below using the four-type deferral grid each item carries.

## Sprint Retrospective

<!-- planner appends items below this line during the sprint. Each item is a self-contained block with its own classification grid per planner/SKILL.md. Leave this section empty if no items accumulate. -->

## Acceptance Criteria

- [x] Every item under `## Sprint Retrospective` has exactly one deferral-type row marked `true` in its inline grid (exactly-one-true constraint)
- [x] Every item has its `Action taken:` field filled in matching the chosen deferral type (card id for backlog/sprint, prose for note-only, commit hash for fixed-with-note)
- [x] Every item's two per-item checkboxes (`Item {N} classified`, `Item {N} actioned`) are ticked
- [x] Sprint summary generated via `generate_archive_summary`
- [x] Roadmap updated for any stories this sprint completed
- [x] `CHANGELOG.md` updated for any user-visible changes landed this sprint
- [x] All sprint cards archived via `archive_cards`

---

## Cleanup Scope & Context

- **Sprint/Release:** EXTIDCI1
- **Primary Feature Work:** Case-insensitive external integration ID matching (card jlb11a)
- **Cleanup Category:** Sprint closeout

**Required Checks:**

- [x] Sprint/Release is identified above.
- [x] Primary feature work that generated this cleanup is documented.

---

## Deferred Work Review

- [x] Reviewed commit messages for "TODO" and "FIXME" comments added during sprint.
- [x] Reviewed PR comments for "out of scope" or "follow-up needed" discussions.
- [x] Reviewed code for new TODO/FIXME markers (grep for them).
- [x] Checked team chat/standup notes for deferred items.

| Cleanup Category    | Specific Item / Location                                | Priority | Justification for Cleanup                           |
| :------------------ | :------------------------------------------------------ | :------: | :-------------------------------------------------- |
| **Sprint closeout** | EXTIDCI1 retrospective (see Sprint Retrospective above) |    P1    | Process retro items via the four-type deferral grid |

---

## Cleanup Checklist

### Documentation Updates (optional)

| Task          | Status / Details                                   | Done? |
| :------------ | :------------------------------------------------- | :---: |
| **CHANGELOG** | Update for user-visible changes landed this sprint | - [x] |

---

## Validation & Closeout

### Pre-Completion Verification

| Verification Task | Status / Evidence      |
| :---------------- | :--------------------- |
| **Tests Passing** | [evidence at closeout] |
| **Code Review**   | [reviewer verdict]     |

### Follow-up & Lessons Learned

| Topic                    | Status / Action Required                                                                                                                                                     |
| :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Process Improvements** | This sprint exists because external-ID work was wrongly hand-deferred and #399 was hand-executed instead of dispatched; now run through the dispatcher per lifecycle rule #6 |

### Completion Checklist

<!-- gate0: upper-checklist -->

- [x] Sprint summary generated via `generate_archive_summary`. <!-- cite: card:jlb11a -->
- [x] Roadmap updated for any stories this sprint completed. <!-- cite: roadmap:m1/s4/database-integrations-package/case-insensitive-id-filtering -->
- [x] `CHANGELOG.md` updated for any user-visible changes landed this sprint (N/A — repo has no CHANGELOG / changeset convention). <!-- cite: none -->
- [x] All sprint cards archived via `archive_cards`. <!-- cite: card:jlb11a -->
