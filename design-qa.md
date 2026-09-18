# Design QA

## September 18, 2026: Work register header

- Reference: `/Users/aeitrheim/Downloads/Screenshot 2026-09-18 at 11.30.43 AM.png`
- Visual verification: passed in the local browser preview at desktop width.
- Implemented: date and title, Refresh/New repeat task/New task actions, four live summary cards, compact project selector, and saved filters with a live Due this week count.
- Responsive implementation: summary cards collapse to two columns and controls wrap on mobile.

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
