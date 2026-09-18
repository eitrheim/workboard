# Design QA

## September 18, 2026: Work register header

- Reference: `/Users/aeitrheim/Downloads/Screenshot 2026-09-18 at 11.30.43 AM.png`
- Visual verification: passed in the local browser preview at desktop width.
- Implemented: date and title, Refresh/New repeat task/New task actions, four live summary cards, compact project selector, and saved filters with a live Due this week count.
- Responsive implementation: summary cards collapse to two columns and controls wrap on mobile.

## September 18, 2026: Score chart

- Visual verification: passed in the local browser preview at desktop width.
- Implemented: numeric vertical scale, horizontal comparison gridlines, and a Carryover explanation for open tasks that were already overdue at the period start.

## September 18, 2026: Extracted items pane

- Reference: `/Users/aeitrheim/Downloads/Screenshot 2026-09-18 at 12.50.22 PM.png`
- Visual verification: passed with three locally parsed Markdown tasks.
- Implemented: file-aware header, compact confidence badges and detail chips, visually separated result rows, per-item Approve/Edit/Discard actions, and header-level Approve all.

## September 18, 2026: Extracted queue deduplication

- Fixed: server-backed extraction no longer creates a second optimistic Review queue item.
- Verification: static Site tests and production build passed; persisted source items now refresh the canonical queue state.

## Source visual truth

- Review queue: `/var/folders/lc/0tlf8lf16yn0y9qbzz_b7mfr0000gp/T/TemporaryItems/NSIRD_screencaptureui_RgpQbQ/Screenshot 2026-08-28 at 1.05.39 PM.png`
- Work register: `/var/folders/lc/0tlf8lf16yn0y9qbzz_b7mfr0000gp/T/TemporaryItems/NSIRD_screencaptureui_fmRoA2/Screenshot 2026-08-28 at 1.06.44 PM.png`
- Work plan: `/var/folders/lc/0tlf8lf16yn0y9qbzz_b7mfr0000gp/T/TemporaryItems/NSIRD_screencaptureui_IWQkBN/Screenshot 2026-08-28 at 1.07.25 PM.png`
- Work plan before build: `/Users/aeitrheim/Downloads/Screenshot 2026-08-28 at 1.52.05 PM.png`
- Work plan after build: `/Users/aeitrheim/Downloads/Screenshot 2026-08-28 at 1.53.01 PM.png`
- Completed and score: `/var/folders/lc/0tlf8lf16yn0y9qbzz_b7mfr0000gp/T/TemporaryItems/NSIRD_screencaptureui_SOSunb/Screenshot 2026-08-28 at 1.08.17 PM.png`

## Implementation evidence

- Implementation: local Vite app at `http://localhost:4173/`
- Screenshot: unavailable
- Viewport: not captured
- Source and implementation pixel dimensions: not comparable
- Density normalization: not performed
- State: live-only setup gate; no seeded task or review-queue records

## Comparison

The app build, Sites packaging, and static route contract pass. Browser-rendered screenshots and interaction inspection are blocked because the in-app browser returned a local connection refusal for the preview server, and a Chrome browser is unavailable in this session. No visual pass/fail judgment is made from source code alone.

## Findings

- [P1] Browser-rendered visual comparison unavailable.
  Location: all four screens.
  Evidence: the local implementation could not be opened by the available browser surface.
  Impact: typography, responsive layout, spacing, and visible interaction states cannot be verified against the screenshots.
  Fix: reopen the local preview in a browser that can reach the desktop-hosted server, then capture desktop and mobile states and rerun this QA report.

## Primary interactions implemented

- Screen navigation across Review queue, Work register, Work plan, and Completed and score.
- Review queue tabs, approve, edit, fill in, reject, dismiss, and retry.
- Work register project filters, deadline sorting, mark done, clear blocker.
- Work plan reorder suggestion, mark done, clear blocker.
- Work plan pre-build and built states; Build work plan, End period, Re-plan with AI order, dependency review, Add deadlines, capacity summary, task move controls, deferred work, and task completion.
- Completed score period selector and score chart.
- Responsive desktop sidebar and mobile bottom navigation.
- Work-register task titles open the task editor.
- Work-plan cards support native drag-and-drop reordering.
- Work-plan available-task table supports adding a task into the plan.
- Task editor accepts decimal effort hours, notes, AI-populated note state, and image attachments.

## Final result

Visual browser QA remains blocked in this session. Live data QA is pending the Microsoft Entra app registration and OpenAI key; the app now uses a live-only setup gate with no seeded records.

---

## September 18, 2026: Project View summary

### Comparison evidence

- Source visual truth: `/var/folders/lc/0tlf8lf16yn0y9qbzz_b7mfr0000gp/T/TemporaryItems/NSIRD_screencaptureui_9OiwYb/Screenshot 2026-09-18 at 1.12.37 PM.png`
- Implementation: browser-rendered local Vite preview at `http://127.0.0.1:5174/`, Project View route
- Capture: transient computer-use browser screenshot at a 1280 × 720 CSS-pixel viewport; no durable screenshot file was produced by the browser surface
- State: no local backend records were available, so the Project View rendered its empty-data state. The header, colored stat cards, section frame, spacing, and two-column milestone grid were inspected directly.
- Focused layout inspection: the local render reported a two-column milestone grid, pale-yellow Open card, pale-green Completed card, and no browser console errors.

### Findings and resolution

- [Resolved] The previous header had neutral cards, an oversized next-event line, and a separate event count badge. It now uses the compact title area, yellow Open card, green Completed card, and detailed next-milestone card from the reference.
- [Resolved] The milestone strip is now a padded two-column card area. Cards include urgency dots, readable metadata, and semantic timing pills such as `3 days overdue` and `Due in 7 days`.
- [Resolved] Overdue project cards use the reference's neutral dot while retaining a red overdue label.

### Fidelity surfaces

- Typography: preserves the existing Workboard type scale while tightening the stat and event hierarchy to match the reference.
- Spacing and layout rhythm: aligned compact header cards with a 25 px milestone container and 18 px two-column card gap.
- Colors and tokens: Open uses the existing warm yellow semantic token; Completed uses the existing pale green token; urgency labels retain the app's red, amber, and blue semantic colors.
- Image quality and asset fidelity: no raster assets are present in the reference region.
- Copy and content: labels now read `Next milestone`; live project, milestone, and task data remain dynamic.

### Final result

passed

---

## September 18, 2026: Project score summary

- Source visual truth: `/Users/aeitrheim/Downloads/Screenshot 2026-09-18 at 1.20.07 PM.png`
- Implementation: local Project View at `http://127.0.0.1:5174/`, inspected at 1280 × 720 CSS pixels.
- Verified: the Open card reads `0 Tasks`; the Completed card reads `0 Pts`; the project-contribution progress bar is absent; no browser console errors were reported.
- Live state note: local preview had no backend records, so zero values were expected. The completed value is calculated from the selected project's completed-task point total.

### Final result

passed
