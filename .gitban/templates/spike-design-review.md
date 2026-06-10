---
# Template Schema Overview
description: A structured design review template based on IxD principles and heuristics. Forces reviewers through six categories of design quality — strategic alignment, navigation, data entry, feedback, accessibility, and psychology — ensuring no major UX dimension is overlooked before sign-off.
use_case: Use this when reviewing a design (wireframe, prototype, mockup, or implemented UI) to systematically evaluate it against proven interaction design principles. Suitable for design critiques, pre-launch reviews, and milestone checkpoints.
patterns_used:
  - section: "Review Context"
    pattern: "Pattern 1: Section Header"
  - section: "Strategic Alignment & Cognitive Load"
    pattern: "Pattern 2: Structured Review"
  - section: "Navigation & Architecture"
    pattern: "Pattern 2: Structured Review"
  - section: "Data Entry & Interaction"
    pattern: "Pattern 2: Structured Review"
  - section: "Feedback & Communication"
    pattern: "Pattern 2: Structured Review"
  - section: "Accessibility & Inclusivity"
    pattern: "Pattern 2: Structured Review"
  - section: "Psychology & Retention"
    pattern: "Pattern 2: Structured Review"
  - section: "Review Verdict & Follow-up"
    pattern: "Pattern 5: Closeout & Follow-up"
---

# Design Review

## Review Context

* **Design Under Review**: [Name of feature, screen, or flow being reviewed]
* **Design Artifact**: [Link to Figma, prototype, screenshot, or PR]
* **Designer/Owner**: [Who created or owns this design]
* **Review Date**: [Date of review]
* **Review Type**: [Wireframe / High-fidelity mockup / Prototype / Implemented UI]
* **Target Platform**: [Web / Mobile / Desktop / Responsive]

---

## Strategic Alignment & Cognitive Load

*Does the design respect the user's mental energy and existing habits?*

| Principle | Verdict | Notes |
| :--- | :---: | :--- |
| **Jakob's Law** — Interface feels familiar, not reinventing the wheel | | |
| **Hick's Law** — User is not overwhelmed with too many choices per screen | | |
| **Miller's Law** — Complex information chunked into groups of 5-9 items | | |
| **Aesthetic-Usability Effect** — Visual polish is high enough to earn forgiveness | | |
| **Occam's Razor** — This is the simplest possible flow to achieve the goal | | |

- [ ] Strategic alignment section reviewed — all principles evaluated

---

## Navigation & Architecture

*Can the user find their way without getting lost?*

| Principle | Verdict | Notes |
| :--- | :---: | :--- |
| **Visibility of System Status** — User knows where they are and what is happening | | |
| **Breadcrumbs/Wayfinding** — User can orient themselves if they land on this page cold | | |
| **Thumb Zone** — Primary actions reachable with one hand on mobile (if applicable) | | |
| **Progressive Disclosure** — Advanced settings hidden until needed, primary UI is clean | | |
| **F-Pattern/Z-Pattern** — Most important information placed where the eye scans first | | |

- [ ] Navigation & architecture section reviewed — all principles evaluated

---

## Data Entry & Interaction

*How easy is it for the user to provide information or take action?*

| Principle | Verdict | Notes |
| :--- | :---: | :--- |
| **Fitts's Law** — Primary action buttons are large enough and easy to hit | | |
| **Inline Validation** — Errors shown while typing, not after submit | | |
| **Error Prevention** — UI makes it impossible to make certain mistakes | | |
| **Forgiveness** — Undo or cancel available for every significant action | | |
| **Constraints** — Choices limited to prevent invalid states | | |

- [ ] Data entry & interaction section reviewed — all principles evaluated

---

## Feedback & Communication

*Is the system talking back to the user effectively?*

| Principle | Verdict | Notes |
| :--- | :---: | :--- |
| **Feedback Loops** — Every click produces a visual response (spinner, state change, toast) | | |
| **System & Real World Match** — Uses customer language, not product jargon | | |
| **Skeleton Screens** — Placeholders shown during data loading to reduce perceived wait | | |
| **Empty States** — Clear call-to-action when there is no data to display | | |
| **Micro-interactions** — Small animations confirm success and add polish | | |

- [ ] Feedback & communication section reviewed — all principles evaluated

---

## Accessibility & Inclusivity

*Can everyone use this, regardless of their situation or device?*

| Principle | Verdict | Notes |
| :--- | :---: | :--- |
| **Color Contrast** — Text readable for low-vision users and in bright sunlight | | |
| **Mobile First** — Design works on small screens as well as large monitors | | |
| **Dark Mode** — Light-on-dark experience considered (if applicable) | | |
| **Graceful Degradation** — Core experience functional if high-end features fail to load | | |
| **Signifiers** — Links and buttons clearly identifiable as clickable elements | | |

- [ ] Accessibility & inclusivity section reviewed — all principles evaluated

---

## Psychology & Retention

*Are we encouraging the right behaviors and building trust?*

| Principle | Verdict | Notes |
| :--- | :---: | :--- |
| **Social Proof** — User shown that others have successfully used this feature | | |
| **Zeigarnik Effect** — Long processes show progress to motivate completion | | |
| **Von Restorff Effect** — Primary action visually distinct from everything else | | |
| **Scarcity/Urgency** — If used, it is honest and helpful, not a dark pattern | | |
| **Direct Manipulation** — Users interact with objects directly rather than via menus | | |

- [ ] Psychology & retention section reviewed — all principles evaluated

---

## Review Verdict & Follow-up

| Item | Detail |
| :--- | :--- |
| **Overall Verdict** | [Approved / Approved with changes / Needs revision / Blocked] |
| **Critical Issues** | [List any blockers that must be fixed before proceeding] |
| **Minor Issues** | [List nice-to-haves or polish items] |
| **Next Review Date** | [If revision needed, when to re-review] |

### Strengths

* [What this design does well]

### Issues Found

* [Key problems identified during review]

### Action Items

| Action | Owner | Priority |
| :--- | :--- | :---: |
| [Description of required change] | [Who] | [P0/P1/P2] |

### Completion Checklist

* [ ] All six review sections evaluated with verdicts and notes
* [ ] Critical issues documented with clear descriptions
* [ ] Action items assigned with owners and priorities
* [ ] Overall verdict recorded
* [ ] Designer notified of review outcome
* [ ] Follow-up review scheduled (if revision needed)

### Note on validation

This card follows a structured template. Keep its sections, checkboxes, and tables and fill them in rather than removing them — gitban validates card structure when the card is created and when it is completed, and a non-conforming card is held as a draft until it is corrected.
