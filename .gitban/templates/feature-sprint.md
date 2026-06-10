---
# Template Schema Overview
description: A template for planning and setting up a feature sprint in gitban using batch card creation, sprint tags, roadmap integration, and CHANGELOG.md release notes. Note that this card is not for actually doing all the work, it's for setting up the sprint so that the work is done amazingly well.
use_case: Use this when starting a new sprint to create card stubs, link to roadmap milestones, and set up sprint infrastructure. Focus on setup and tooling, not day-to-day tracking.
patterns_used:
  - section: "Sprint Definition & Scope"
    pattern: "Pattern 1: Section Header"
  - section: "Card Planning & Brainstorming"
    pattern: "Pattern 6: Brainstorming Block"
  - section: "Batch Card Creation Workflow"
    pattern: "Pattern 4: Process Workflow"
  - section: "Sprint Execution Phases"
    pattern: "Pattern 9: Phased Task Checklist"
  - section: "Sprint Closeout & Retrospective"
    pattern: "Pattern 5: Closeout & Follow-up"
---

# Feature Sprint Setup Template

## Sprint Definition & Scope

* **Sprint Name/Tag**: [e.g., "AUTH", "TEMPLATES", "MULTIUSER" - used as filename prefix]
* **Sprint Goal**: [What we're trying to accomplish this sprint]
* **Timeline**: [Start date - End date, e.g., "2025-11-18 - 2025-12-01"]
* **Roadmap Link**: [Link to roadmap milestone, e.g., "v1 > m1 > Multi-user Support"]
* **Definition of Done**: [Sprint complete when X cards done, features shipped, milestone closed]

**Required Checks:**
* [ ] Sprint name/tag is chosen and will be used as prefix for all cards
* [ ] Sprint goal clearly articulates the value/outcome
* [ ] Roadmap milestone is identified and linked

---

## Card Planning & Brainstorming

> Use this space to brainstorm what cards you'll need for this sprint. Think about features, bugs, chores, spikes, and documentation work.

### Work Areas & Card Ideas

**Area 1: [e.g., Core Feature Development]**
* [Card idea 1 - e.g., "User authentication API endpoint"]
* [Card idea 2 - e.g., "Session management system"]
* [Card idea 3 - e.g., "OAuth provider integration"]

**Area 2: [e.g., Bug Fixes & Stability]**
* [Card idea 1 - e.g., "Fix login timeout on slow networks"]
* [Card idea 2 - e.g., "Fix CSRF token validation"]

**Area 3: [e.g., Documentation & Cleanup]**
* [Card idea 1 - e.g., "Update API documentation"]
* [Card idea 2 - e.g., "Refactor auth module for clarity"]

### Card Types Needed

* [ ] **Features**: [Number, e.g., "~5 feature cards"]
* [ ] **Bugs**: [Number, e.g., "~2 bug cards"]
* [ ] **Chores**: [Number, e.g., "~3 chore cards"]
* [ ] **Spikes**: [Number, e.g., "~1 spike for research"]
* [ ] **Docs**: [Number, e.g., "~1 docs card"]

---

## Sequential Card Creation Workflow

Use this workflow to create all sprint cards using sequential `create_card()` calls.
Sequential creation provides better error handling and is easier for AI agents to work with.

| Step | Status/Details | Universal Check |
| :---: | :--- | :---: |
| **1. Create Feature Cards** | [Record card IDs created] | - [ ] Feature cards created with sprint tag |
| **2. Create Bug Cards** | [Record card IDs created] | - [ ] Bug cards created with sprint tag |
| **3. Create Chore Cards** | [Record card IDs created] | - [ ] Chore cards created with sprint tag |
| **4. Create Spike Cards** | [Record card IDs created] | - [ ] Spike cards created with sprint tag |
| **5. Verify Sprint Tags** | [Run list_cards with group_by_sprint] | - [ ] All cards show correct sprint tag |
| **6. Fill Detailed Cards** | [Update high-priority cards with full details] | - [ ] P0/P1 cards have full acceptance criteria |

### Workflow Instructions

**Step 1-4: Create Cards by Type Sequentially**

Create cards one at a time for better error handling. Example:

```python
# Create feature cards sequentially
for title in [
    "User authentication API endpoint",
    "Session management system",
    "OAuth provider integration"
]:
    create_card(
        title,
        card_type="feature",
        priority="P1",
        status="backlog",
        owner="CAMERON",
        sprint="AUTH"  # Your sprint tag!
    )

# Create bug cards sequentially
for title in [
    "Fix login timeout on slow networks",
    "Fix CSRF token validation"
]:
    create_card(
        title,
        card_type="bug",
        priority="P0",
        status="backlog",
        sprint="AUTH"
    )

# Create stub cards (research needed)
for title in [
    "Research OAuth providers - needs investigation",
    "Design session storage strategy - TBD"
]:
    create_card(
        title,
        card_type="spike",
        priority="P2",
        status="backlog",
        sprint="AUTH"
    )
```

**Step 5: Verify Sprint Setup**

```python
# View all cards in this sprint
list_cards(group_by_sprint=True)

# Should show your sprint tag with all created cards
```

**Step 6: Add Details to Ready Cards**

Use `edit_card()` or `append_card()` to flesh out high-priority cards with:
- Full acceptance criteria
- Implementation details
- Testing requirements

**Created Card IDs**: [List all card IDs here for reference: abc123, def456, ...]

---

## Sprint Execution Phases

Track the major phases of sprint execution. This is lightweight - just checkpoint the key gitban operations.

| Phase / Task | Status / Link to Artifact | Universal Check |
| :--- | :--- | :---: |
| **Roadmap Integration** | [Link to roadmap milestone] | - [ ] Milestone updated with sprint tag |
| **Take Sprint** | [Date sprint was claimed] | - [ ] Used take_sprint() to claim work |
| **Mid-Sprint Check** | [Sprint progress notes] | - [ ] Reviewed list_cards(group_by_sprint=True) |
| **Complete Cards** | [Completed card IDs] | - [ ] Cards moved to done status |
| **Sprint Archive** | [Archive folder name] | - [ ] Used archive_cards() to bundle work |
| **Generate Summary** | [Summary.md location] | - [ ] Used generate_archive_summary() |
| **Update Changelog** | [Changelog entry] | - [ ] Recorded release notes in CHANGELOG.md |
| **Update Roadmap** | [Milestone status] | - [ ] Marked milestone complete |

### Phase Details

#### Roadmap Integration

**Quick Start:**

```python
# Browse roadmap structure (token-efficient): read the top level, then drill in
read_roadmap()                      # all milestones
read_roadmap(path="m1")             # stories under milestone m1

# Read a specific milestone, only the fields you need
read_roadmap(path="m1", fields=["title", "status", "stories"])

# Update milestone status
upsert_roadmap(
    path="m1",
    content={"status": "in_progress", "start_date": "2025-11-18"}
)
```

**Learn more**: `get_help(topic="roadmap")` for complete roadmap workflows, hierarchy, and best practices

#### Take Sprint

**Claim all backlog cards in sprint and assign to yourself:**

```python
take_sprint(sprint_name="AUTH", owner="CAMERON")
# Moves all backlog cards → todo and assigns owner
```

#### Monitor Progress

**Check sprint progress:**

```python
# View all cards grouped by sprint tag
list_cards(group_by_sprint=True)

# View only active work
list_cards(active_only=True, group_by_sprint=True)

# Get board statistics
get_gitban_stats()
```

**Learn more**: `get_help(topic="tools")` for complete tool reference and filtering options

---

## Sprint Closeout & Retrospective

| Task | Detail/Link |
| :--- | :--- |
| **Cards Archived** | [Link to sprint archive folder] |
| **Sprint Summary** | [Link to SUMMARY.md] |
| **Changelog Entry** | [Version number and changes] |
| **Roadmap Updated** | [Milestone marked complete] |
| **Retrospective** | [Date retrospective held] |

### Closeout Tools

**Archive completed work:**

```python
# Archive all done cards to sprint folder
archive_cards(
    archive_name="2025-11-AUTH-Sprint",
    all_done=True  # or specify card_ids for specific cards
)

# Generate sprint summary with metrics
generate_archive_summary(
    archive_folder_name="sprint-2025-11-auth-sprint-20251118",
    mode="auto"  # or "enhanced" with custom lessons learned
)
```

**Update changelog:**

Track what shipped in each version by recording release notes in the project's
`CHANGELOG.md` (Keep a Changelog format). The roadmap no longer carries an
embedded changelog; annotate completed roadmap nodes with `released_as`
metadata via `upsert_roadmap` for structured release traceability.

```markdown
## [1.1.0] - 2025-11-18

### Added
- User authentication API

### Fixed
- Critical login timeout bug

### Changed
- Updated authentication documentation
```

**Learn more**: `get_help(topic="roadmap")` for complete roadmap documentation

**Update roadmap milestone:**

```python
upsert_roadmap(
    path="m1",
    content={
        "status": "done",
        "actual_completion": "2025-11-18"
    }
)
```

### Follow-up & Lessons Learned

| Topic | Status / Action Required |
| :--- | :--- |
| **Incomplete Cards** | [Carry over to next sprint or move to backlog] |
| **Stub Cards** | [Which stubs need to become full cards?] |
| **Technical Debt** | [Created follow-up cards for debt introduced] |
| **Process Improvements** | [What to improve in next sprint setup?] |
| **Dependencies/Blockers** | [What blocked progress? How to prevent?] |

### What Went Well

* [e.g., "Batch card creation saved significant time"]
* [e.g., "Sprint tags kept work organized"]
* [e.g., "Roadmap integration helped track progress"]

### What Could Be Improved

* [e.g., "Should have created more detailed stubs upfront"]
* [e.g., "Need better estimation - created too many cards"]
* [e.g., "Roadmap updates should happen more frequently"]

### Completion Checklist

* [ ] All done cards archived to sprint folder
* [ ] Sprint summary generated with automatic metrics
* [ ] Changelog updated with version number and changes
* [ ] Roadmap milestone marked complete with actual date
* [ ] Incomplete cards moved to backlog or next sprint
* [ ] Retrospective notes captured above
* [ ] Follow-up cards created for technical debt
* [ ] Sprint closed and celebrated!
