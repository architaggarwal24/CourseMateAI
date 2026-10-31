# Stage 2 — Study screens redesign ("graphite glass")

Unzip over `CourseMateAI/` (on top of Stage 1 + the audit hotfix). No files to delete, no new packages: no `npm install` needed.

## What changed
- **Workspace**: Study and Account now sit in one floating glass panel. The top bar holds the document chip (status badge,
  chunk count, animated indexing stages), the segmented tool tabs and Replace. The drag-and-drop overlay is a glass card with a running border light.
- **Chat**: assistant replies get an avatar orb and slide in; your messages pop in from the corner; a typing indicator glows;
  suggestion tiles are lit by the pointer; source chips; floating glass composer with a focus glow; "Explore further" follow-ups.
- **Quiz**: options are lifted glass rows (hover slide, spring press, key chips 1–4). A right answer pops green with a glow, a wrong one shakes red;
  the others dim. Gradient progress bar; review screen with an animated score ring and colour-edged question cards.
- **Flashcards**: spring 3D flip; once the answer shows, **drag the card right = "Got it", left = "Missed it"** (it leans and stamps KNOW IT / AGAIN). Buttons and keys still work.
- **Notes**: stats/download bar, segmented Full/Outline tabs, outline items with an accent edge.
- **Setup screens** (quiz/cards/notes): floating intro icon, big number stepper with a filled slider, suggestion tiles.
- **Login**: split screen: headline that reveals word by word, feature list, floating tilt-able product previews; glass form card with magnetic Login button.
- **Account**: profile banner (avatar in a lit ring, XP bar, 4 tilt stat cards that count up); Settings with a sticky section rail (wide screens) and pointer-lit cards; History in glass.
- **Sidebar user menu**: now a Radix dropdown (arrow keys, Esc) showing level + XP bar.
- Slightly brighter aurora behind Study.

## What to test
1. `npm test` → **437/437**. `npm run typecheck`, `npm run build` → pass.
2. **Login** (/login, logged out): headline animates in; hover the preview cards (they tilt); Register → step flow still works.
3. **Chat**: ask a question → typing dots, then the answer slides in with sources + Copy; click a follow-up chip.
4. **Quiz**: generate → press 1–4 or click; check right/wrong colours, explanation, Next; finish → score ring fills, % counts up.
5. **Flashcards**: Space flips (springy). After flipping, drag the card right/left past ~120px → counts as Got it / Missed.
6. **Notes**: generate → Full/Outline tabs, outline click scrolls, Markdown/Text download.
7. **Drag a PDF** anywhere on Study → glass drop overlay.
8. **Account**: Profile banner numbers count up; Settings rail links jump to sections; History list.
9. Sidebar foot: click your name → menu (Profile / Avatar / Settings / Log out), arrow keys work.
10. Phone width (390px): workspace fills the screen, tabs wrap under the document, dock at bottom.
