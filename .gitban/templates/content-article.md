```yaml
---
# Template Schema Overview
# This block describes the purpose of this template and the patterns it uses.
description: A template for tracking a long-form article from concept through post-publish engagement, encoded as a ten-phase editorial workflow (concept, research, outline, hook, draft, revise, anti-AI-tells scrub, pre-publish checklist, publish, post-publish).
use_case: Use this for any article-format content piece where research and revision are substantial — blog posts, long-form LinkedIn articles, newsletter essays, technical explainers. Not for quick posts, twitter threads, or micro-content.
patterns_used:
  - section: "Piece Overview & Context"
    pattern: "Pattern 1: Section Header"
  - section: "Phase 1 — Concept"
    pattern: "Pattern 1: Section Header (custom fields)"
  - section: "Phase 2 — Research & Sources"
    pattern: "Pattern 7: Research Log (Annotated Bibliography)"
  - section: "Phase 3 — Outline"
    pattern: "Pattern 6: Brainstorming Block"
  - section: "Phase 4 — Hook Selection"
    pattern: "Pattern 6: Brainstorming Block"
  - section: "Phase 5 — Draft"
    pattern: "Pattern 2: Structured Review (draft artifact link + checks)"
  - section: "Phase 6 — Revision Log"
    pattern: "Pattern 3: Iterative Log"
  - section: "Phase 7 — Anti-AI-Tells Scrub"
    pattern: "Pattern 2: Structured Review (artifact scan + checks)"
  - section: "Phase 8 — Factuality & Pre-Publish Checklist"
    pattern: "Pattern 2: Structured Review (factuality table + checklist)"
  - section: "Phase 9 — Publish"
    pattern: "Pattern 1: Section Header (publish metadata)"
  - section: "Phase 10 — Post-Publish & Closeout"
    pattern: "Pattern 5: Closeout & Follow-up"
---
```

# Article Workflow for [Piece Title]

**When to use this template:** Any content piece where concept, research, and revision are substantial enough to track. One card, one thesis, one audience — but the same card can drive one or many channel outputs (blog post, LinkedIn post, LinkedIn long-form, Twitter thread, newsletter essay). Declare the channels you actually intend to publish to in Phase 1; consult the Channel Reference tables below when you draft for each one.

**When NOT to use this template:** Internal engineering documentation (use `documentation.md`), ADRs (use `documentation-adr.md`), feature work (use `feature.md`), or throwaway drafts you do not plan to publish.

**Multi-channel discipline:** The Channel Reference section below is a pick-list of per-channel rules. When you create a card, copy in only the channel subsections you actually plan to ship to. The card does not require you to produce a version for every channel — only the ones you declared in Phase 1 and the Repurposing Plan. Do not add channel-specific checkboxes to your card; if it is not declared, it is not required.

---

## Piece Overview & Context

* **Working Title:** [e.g., "Why your agent harness is leaking context"]
* **Primary Channel / Format:** [The one channel this piece is written *for* first — e.g., Blog (1500 words). Every other channel is a downstream repurpose.]
* **Additional Channels Planned:** [Optional. List only the channels you actually intend to publish to, e.g., "LinkedIn post summary, Twitter thread". Leave blank if primary only. Do NOT list channels speculatively — whatever is here becomes real work in the Repurposing Plan.]
* **Target Publish Date (primary):** [YYYY-MM-DD]
* **Length Target (primary):** [e.g., 1500 words; cut from a 2500-word first draft. See Channel Reference for per-channel targets.]
* **Author Voice Reference:** [e.g., "match the voice of [prior piece link]"]

**Required Checks:**
* [ ] **Working Title** is set above.
* [ ] **Primary channel / format** is identified.
* [ ] **Additional channels planned** is either filled or explicitly left blank (not left ambiguous).
* [ ] **Target publish date** is set for the primary channel.
* [ ] **Length target** is defined for the primary channel.

---

## Channel Reference (optional)

Per-channel rules. **This section is a reference pick-list — not a checklist and not tasks.** The template carries rules for every channel a card might publish to; copy into your card only the channel subsections that match the Primary Channel and Additional Channels Planned you declared in Piece Overview. Do not copy subsections for channels you are not shipping to — unused rows become speculative work. You can also omit this section entirely if the channel rules are well-known and do not need to live in the card.

Below are the reference subsections, one per channel. Prune aggressively on card creation.

### Blog / Long-form Article

| Rule | Value |
| :--- | :--- |
| **Length target** | 800-2000 words; aim ~1500. Draft to ~2x target, then cut. |
| **Longest section** | Under ~600 words. Split with H3 subheads if larger. |
| **Title length** | 50-60 characters for SEO. |
| **Slug** | Kebab-case, descriptive, carries the core idea. |
| **Meta description** | 140-160 characters. Summarizes the thesis, does not just repeat the title. |
| **Open Graph image** | Set before publish, or explicitly N/A with reason. |
| **Internal links** | At least one link to prior work on the same blog where applicable. Anchor text is descriptive, never "click here". |
| **Citations** | Inline as you draft — do not defer to the factuality pass. |
| **Canonical URL** | Set if cross-posting to a newsletter or guest publication. |
| **Tags / Categories** | 3-5 blog taxonomy tags. |
| **Reading time** | Target 4-10 minutes (word_count / 200). |
| **Structure** | 5-7 H2 sections typical. Hook, stakes, argument body, counterpoint, resolution, CTA. |

### LinkedIn Post (short-form feed)

| Rule | Value |
| :--- | :--- |
| **Length target** | 200-400 words / 900-1300 characters. |
| **Hook fold** | First 1-2 lines must carry the hook above the "see more" fold. |
| **Compression check** | Write an 8-word summary of the thesis before drafting, as a one-idea-discipline forcing function. |
| **Markdown** | None. LinkedIn strips headers and the post looks broken. |
| **Line breaks** | Short beats separated by blank lines. No wall-of-text paragraphs. |
| **Links** | Place in the first comment, not the post body, unless click-through is the primary goal. Links in body tank reach. |
| **Hashtags** | 3-5 max, at the bottom, relevant to the target persona's feed. |
| **Emoji** | Sparingly, only where they add meaning. Never as bullet points. |
| **Structure** | 3-5 beats. Hook, setup, argument, turn, CTA. No formal sections. |

### LinkedIn Long-form Article

| Rule | Value |
| :--- | :--- |
| **Length target** | 1000-2500 words. LinkedIn tolerates longer than a blog. |
| **Hook fold** | First 2-3 lines visible in the preview before the cut. |
| **Subheadings** | Allowed and encouraged for scannability. |
| **Hero image** | 1 recommended. |
| **Publish mechanism** | LinkedIn "write article", not a regular feed post. |
| **Voice** | Closer to blog than feed post — more room for argument development. |

### Twitter / X Thread

| Rule | Value |
| :--- | :--- |
| **Character budget per tweet** | 280 hard cap. Target <260 to leave room for "1/N" numbering if used. |
| **Thread length** | 5-10 tweets typical. Cap at whatever the argument actually needs — never pad. |
| **Hook tweet (1 of N)** | Carries the whole thread's survival. One hook formula from the hook-formula-library. |
| **Middle tweets** | One beat per tweet. Each tweet stands on its own as a readable unit — no sentences carried across tweets. |
| **Closing tweet (N of N)** | Pinned CTA, one action only. |
| **Links** | Avoid in the hook tweet (tanks reach). Place in the closing tweet or a dedicated source tweet near the end. |
| **Media** | Consider an image or chart in tweet 1 to boost dwell time. |
| **Numbering** | "1/" or "🧵" signals a thread; pick one convention per thread. |

### Newsletter Essay

| Rule | Value |
| :--- | :--- |
| **Length target** | 800-1500 words. |
| **Subject line** | Treated as a hook. Draft 2-3 candidates and pick. |
| **Preview text** | 40-90 characters. Complements the subject, does not repeat it. |
| **Voice** | Heavier personal voice than blog. Newsletters are an intimate channel. |
| **CTA** | One primary. Optionally one soft secondary (reply, forward). |
| **Archive link** | Include for long-lived pieces so readers can share outside the subscriber list. |

---

## Phase 1 — Concept

Lock the piece before you research or draft. Skipping this phase is the single biggest reason articles fail the relevance check later.

* **Goal of the piece:** [What reaction, decision, or belief change do you want from the reader?]
* **Target Audience Persona:** [Pick ONE persona from audience-personas. Name their job, current frustration, and the decision this piece should help them make.]
* **Core Idea (one sentence):** [If this takes more than one sentence, the piece has two ideas. Split it.]
* **Why now, why them:** [Relevance protocol — current reader context, timing, news cycle, product moment.]
* **Reader walks away believing/doing:** [One sentence the reader should finish the piece thinking or planning.]

**Required Checks:**
* [ ] Goal of the piece is stated.
* [ ] One audience persona is named (not "everyone").
* [ ] Core idea fits in one sentence.
* [ ] Relevance ("why now, why them") is written.
* [ ] Reader walkaway is stated.
* [ ] Concept has been challenged: does the reader owe this piece their time?

---

## Style & Voice Research

> Before drafting, search this repository for content style guides, writing skills, editorial practices, and voice guidance. Populate the sections below with the specific guidance that applies to this piece. Look in `gitban/prompts/card_types/content/` for practices and style guides, `.claude/skills/` for writing skills, and any editorial docs referenced by those files. Adapt what you find to the declared channel and audience — do not copy irrelevant guidance.

* **Style guide sources found:** [paths to docs you found — populate like this:]
  * `gitban/prompts/card_types/content/style-guide.md`
  * `gitban/prompts/card_types/content/practices.md`
  * `.claude/skills/technical-content-writer/SKILL.md`
* **Voice principles for this piece:** [Extract from the guides above the voice rules that apply to your channel/audience. Example for a blog post aimed at senior engineers:]
  * Direct, first-person builder voice — the person who built this, explaining why it works
  * Willing to have opinions; unwilling to oversell
  * No marketing speech, no thought-leader cadence
  * Dry, specific, respects what the reader already knows
* **Argument/structure guidance:** [Extract the argument-building principles. Example:]
  * Lead with concrete examples, let abstraction emerge
  * Each section must earn the next — "does the reader now believe something new?"
  * Thesis stated as a claim the reader could disagree with
  * Sequence from what the reader knows to what they don't
  * Start later — delete setup sections the reader doesn't need
* **Anti-patterns to avoid:** [Extract from the anti-AI-tells checklist and anti-patterns list. Example:]
  * No throat-clearing openers ("In today's fast-paced world", "Let's dive in")
  * No AI-tell phrases (delve, tapestry, landscape, leverage, unlock, game-changer)
  * No emojis anywhere
  * No uniform paragraph lengths or tricolons in every section
  * No conclusions that restate the introduction

**Required Checks:**
* [ ] Searched repo for content style guides, practices, editorial guidance, and writing skills.
* [ ] Populated voice and style sections above with applicable guidance for this piece.
* [ ] Confirmed guidance applies to the declared channel and audience.

---

## Phase 2 — Research & Sources

Everything you need to back claims goes here. Dump links, quotes, and data as you find them so the factuality pass has something concrete to reference.

| Source | Type | Key Finding |
| :--- | :--- | :--- |
| [Link or citation] | [Paper / Blog / Data / Internal Doc / Commit / Card] | [Short summary of the finding you will cite] |
| [Link or citation] | [Type] | [What this proves or disproves] |
| [Link or citation] | [Type] | [Finding] |

**Required Checks:**
* [ ] Walked every non-trivial draft claim into the ledger with at least one trusted source.
* [ ] Chased every internal claim to a commit hash, card ID, or data snapshot.
* [ ] Verified every external claim against the fact-check-sources allow-list.
* [ ] Re-ran any headline numbers (counts, sizes, dates) against the live repo rather than inheriting them from the brief.

---

## Phase 3 — Outline

> Sketch the structure before drafting. This is not the draft — it's the skeleton the draft will hang on.

* **Thesis restatement:** [One sentence — same core idea from Phase 1, now refined.]
* **Section 1 — [Heading]:** [One-line purpose]
* **Section 2 — [Heading]:** [One-line purpose]
* **Section 3 — [Heading]:** [One-line purpose]
* **Closing beat:** [How the piece lands — return to the hook, challenge the reader, issue the CTA]

**Required Checks:**
* [ ] Outline has a clear arc (setup → development → payoff).
* [ ] Every section earns its place — no filler sections padding to length target.
* [ ] Outline has been read aloud or re-read with fresh eyes before drafting.

---

## Phase 4 — Hook Selection

> Draft 2-3 hook candidates from the hook-formula-library. Pick the winner.

* **Candidate 1 — [Formula name, e.g., contrarian claim]:** [Hook text]
* **Candidate 2 — [Formula name, e.g., specific number]:** [Hook text]
* **Candidate 3 — [Formula name, e.g., curiosity gap]:** [Hook text]
* **Selected hook:** [The chosen hook, with the reason in one phrase]

**Required Checks:**
* [ ] At least 2 hook candidates were drafted.
* [ ] Selected hook is from the hook-formula-library (not a throat-clear, not "In today's fast-paced world").
* [ ] Hook fits the channel (for LinkedIn long-form: visible above the fold).

---

## Phase 5 — Draft

Write long, fast, and without editing. First draft is for getting the full shape on the page, not for polish.

* **Draft artifact link:** [Path or URL to the drafting doc]
* **Word count of first draft:** [e.g., 2400 words — should be ~1.5-2x the length target]
* **Draft includes:** [ ] hook  [ ] all outlined sections  [ ] closing beat  [ ] placeholder CTA

**Required Checks:**
* [ ] First draft is written end-to-end without stopping to edit.
* [ ] Draft word count is logged and is longer than target (draft-then-cut discipline).
* [ ] Every outlined section has draft content (no `[TODO]` markers left).

### Human Review (optional)

If the author wants to review the draft before revision passes begin, generate a self-contained HTML review page at `skills-workspace/{card-slug}-draft-review.html`. The page should embed the current draft split by H2 sections and render the markdown using a CDN library (`<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>`, render with `marked.parse()`). Each section gets a labeled feedback textarea beneath it. At the top, include a verdict selector: "Approve" or "Revise" (radio buttons or toggle). Include a "Submit Feedback" button that downloads `{card-slug}-draft-feedback.json` containing `{verdict: "approve"|"revise", sections: [{heading, feedback, timestamp}]}`. If verdict is "approve", apply any included notes and proceed to Phase 6. If verdict is "revise", apply the notes, regenerate the review HTML with the updated draft, and wait for another submission. Do not regenerate the review HTML if it already exists and no feedback JSON has appeared — the human has not yet submitted.

* **Review page:** [path to generated HTML, or "skipped"]
* **Feedback received:** [path to feedback JSON, or "skipped"]
* **Verdict:** [approve / revise / skipped]

---

## Phase 6 — Revision Log

Iterative revision. Each pass has a specific goal. Copy the Iteration block for each pass.

| Iteration # | Pass Goal | Action Taken | Outcome / Word Count |
| :---: | :--- | :--- | :--- |
| **1** | [e.g., Cut to target length] | [e.g., Removed Section 2, tightened intro] | [e.g., 2400 → 1680 words] |
| **2** | [e.g., Voice pass] | [e.g., Rewrote 4 paragraphs in author voice] | [e.g., Voice now matches reference] |
| **3** | [e.g., Evidence pass] | [e.g., Added 3 citations, cut 1 unbackable claim] | [Outcome] |

---

#### Iteration 1: [Pass Goal Summary]

**Pass Goal:** [What this revision pass is fixing. Length, voice, evidence, flow, hook strength, one-idea discipline, etc.]

**Action Taken:** [What you actually changed.]

**Outcome:** [Result of the pass — word count, what's now working, what still needs attention.]

*(Copy and paste the 'Iteration N' block above for each subsequent revision pass.)*

**Required Checks:**
* [ ] Ran at least one length-cut pass (draft-then-cut-workflow).
* [ ] Ran at least one voice pass comparing the draft against the Author Voice Reference in Piece Overview and the voice-guide in `gitban/prompts/card_types/content/practices.md`.
* [ ] Ran at least one evidence pass — every claim in the draft either has a row in the Phase 8 factuality ledger or got cut.
* [ ] Stopped revising when further edits stopped improving the piece, not when bored.

---

## Phase 7 — Anti-AI-Tells Scrub

Scan the revised draft for the markers of generic LLM output. Fix what you find.

| Tell | Present (y/n) | Location And Fix |
| :--- | :---: | :--- |
| "In today's fast-paced world" / "In an era of" | [y/n] | [Line and replacement] |
| "Let's dive in" / "Let's unpack this" | [y/n] | [Line and replacement] |
| "It's not just X, it's Y" construction | [y/n] | [Line and replacement] |
| "delve" / "tapestry" / "landscape" / "realm" | [y/n] | [Line and replacement] |
| Em-dash overuse (more than one per paragraph) | [y/n] | [Fix] |
| Rule-of-three tricolons in every paragraph | [y/n] | [Fix] |
| Robotic "In summary, we have explored..." closing | [y/n] | [Fix] |
| Corporate-neutral voice where author voice should be | [y/n] | [Fix] |

**Required Checks:**
* [ ] Every row in the table is marked y/n.
* [ ] Every "y" has a fix or a conscious decision to keep.
* [ ] Draft has been read aloud at least once to catch cadence problems.

---

## Phase 8 — Factuality & Pre-Publish Checklist

### Factuality Ledger

| Claim | Type (internal/external/opinion) | Source | Verified (y/n) |
| :--- | :--- | :--- | :---: |
| [Claim as it appears in the draft] | [internal] | [commit hash, card ID, or source URL] | [y/n] |
| [Next claim] | [external] | [Source] | [y/n] |

### Pre-Publish Review Checklist

* [ ] Hook is from hook-formula-library, not a throat-clear.
* [ ] One idea only — split if two are present.
* [ ] Voice passes the anti-ai-tells-checklist scan above.
* [ ] Every non-trivial claim in the factuality ledger is verified (y).
* [ ] Audience persona from Phase 1 is named and the piece speaks to them specifically.
* [ ] Length is within the target budget.
* [ ] CTA is present and drawn from the cta-library.
* [ ] Channel formatting is correct (headings, paragraph breaks, fold discipline).
* [ ] Repurposing chain is planned (see optional section below if used).
* [ ] Cadence slot is booked.
* [ ] Engagement plan for the first hour after publish is written (see Phase 10).

### Human Review (optional)

If the author wants to review the final draft before publishing, generate a self-contained HTML review page at `skills-workspace/{card-slug}-prepublish-review.html`. The page should embed the final revised draft split by H2 sections, render each section as formatted text with a labeled feedback textarea beneath it. At the top, include a verdict selector: "Approve" or "Revise" (radio buttons or toggle). Include a "Submit Feedback" button that downloads `{card-slug}-prepublish-feedback.json` containing `{verdict: "approve"|"revise", sections: [{heading, feedback, timestamp}]}`. If verdict is "approve", apply any included notes and proceed to Phase 9. If verdict is "revise", apply the notes, regenerate the review HTML with the updated draft, and wait for another submission. Do not regenerate the review HTML if it already exists and no feedback JSON has appeared — the human has not yet submitted.

* **Review page:** [path to generated HTML, or "skipped"]
* **Feedback received:** [path to feedback JSON, or "skipped"]
* **Verdict:** [approve / revise / skipped]

---

## Phase 9 — Publish

* **Publish URL:** [URL after publish]
* **Publish Date/Time:** [Actual publish timestamp]
* **Channel:** [e.g., company blog, LinkedIn long-form, newsletter]

**Required Checks:**
* [ ] Piece has been published.
* [ ] URL is recorded above.
* [ ] First engagement window has begun (see Phase 10).

---

## Repurposing Plan (optional)

If this article feeds into additional channels, plan the chain here (repurposing-protocol). Only list channels that were declared in Piece Overview > Additional Channels Planned — do not pad with speculative rows. If you copied channel subsections into the Channel Reference section above, the rules you need are already inline.

| Channel | Format | Length Target | Hook Variant | CTA Variant | Publish Date |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [e.g., LinkedIn post] | [short-form summary] | [Length per the channel subsection you copied above] | [Hook variant tuned for the channel] | [CTA variant tuned for the channel] | [Date] |
| [e.g., Twitter thread] | [thread of N tweets] | [Length per the channel subsection you copied above] | [Hook variant] | [CTA] | [Date] |

---

## Cadence & Engagement (optional)

* **Cadence slot:** [Which slot in the publishing calendar this fills — e.g., "Tuesday 8am LinkedIn long-form"]
* **Reason to publish on this slot:** [Why now, per cadence-rules]

---

## Phase 10 — Post-Publish & Closeout

### Engagement Tracking

| Task | Detail |
| :--- | :--- |
| **First-hour response plan** | [Who replies to comments, in what voice, how fast] |
| **Post URL** | [Link] |
| **Engagement window closes** | [Date + time when you stop actively monitoring] |

### Metrics That Matter

| Metric | Target | Actual | Notes |
| :--- | :--- | :--- | :--- |
| [e.g., Meaningful comments] | [e.g., 10+] | [Actual] | [Who engaged, what they said] |
| [e.g., Profile visits] | [Target] | [Actual] | [Notes] |
| [e.g., DMs from target persona] | [Target] | [Actual] | [Notes] |

### Follow-up & Lessons Learned

| Topic | Status / Action Required |
| :--- | :--- |
| **What worked in this piece** | [e.g., Contrarian hook pulled 3x comments of prior pieces] |
| **What to do differently next time** | [e.g., Cut Section 3 — added length without adding value] |
| **Future pieces this seeded** | [e.g., Reader asked about X — new card created] |
| **Repurposing executed** | [e.g., LinkedIn post done, twitter thread pending] |

### Completion Checklist

* [ ] Piece is published at the URL recorded in Phase 9.
* [ ] First-hour engagement window has been worked.
* [ ] Metrics that matter are recorded above.
* [ ] Lessons learned are documented.
* [ ] Repurposing chain is either executed or explicitly scheduled.
* [ ] Follow-up cards (if any) have been created.
* [ ] Card is ready to close.

---

=== MANDATORY CARD FOOTER ===
### Note on validation

This card follows a structured template. Keep its sections, checkboxes, and tables and fill them in rather than removing them — gitban validates card structure when the card is created and when it is completed, and a non-conforming card is held as a draft until it is corrected.
