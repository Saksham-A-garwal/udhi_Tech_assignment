# Science Diagram Maker

Asks Gemini (`gemini-3.5-flash-lite`) for one animated SVG per science concept, checks each SVG in code, retries once if a check fails, and shows the results on a page where a reviewer can approve or reject each one.

Live app: **<ADD LINK AFTER DEPLOY>**

## Run it on your computer
Needs Node 20+.
```
npm install
echo GEMINI_API_KEY=your_key > .env     # free key: aistudio.google.com/api-keys
npm run generate                        # Part A: all 5 concepts -> results.json (optional; results.json is already committed)
npm run dev                             # open http://localhost:3000
npm test                                # 45 unit tests: checks, edge cases, retry flow, Gemini client with a faked fetch
```
The key is only read from the environment (`.env` is git-ignored). Never put it in code.

## Results (from `results.json`)
Cost is an estimate (0.10 USD / 1M input tokens, 0.40 USD / 1M output tokens). The free tier really costs $0.

| # | Concept | Checks | Cost (USD) | Retries |
|---|---|---|---|---|
| 1 | Pythagoras' theorem | PASS (5/5) | 0.001593 | 0 |
| 2 | Parts of a circle | PASS (5/5) | 0.000891 | 0 |
| 3 | Series circuit | PASS (5/5) | 0.002263 | 1 |
| 4 | Photosynthesis | PASS (5/5) | 0.001833 | 0 |
| 5 | States of matter | PASS (5/5) | 0.001406 | 0 |

Retries are re-asks after a failed check. API retries (503 waits) are logged separately in `results.json` (`apiRetries`).

## Checks
1. `parses`: valid XML. 2. `inside_viewbox`: every shape and text is inside the viewBox. 3. `title_and_labels`: a `<title>` and at least 3 `<text>` labels. 4. `has_animation`: CSS `@keyframes` or SMIL.
5. My own, `safe_content`: no `<script>`, event handlers (`onclick=`) or external links. The SVG is shown on the page, so this stops a model from running code in the reviewer's browser.

## Review storage: browser localStorage
Approve/Reject and notes are saved in the reviewer's browser. I chose it because it needs no database and works on free hosts, whose disks are wiped on redeploy. The downside: decisions are per browser and are not shared between reviewers.

## What failed and how I fixed it
- Gemini often returned 503. The client waits 2s, 4s, 8s and retries up to 3 times.
- The model wraps SVG in code fences. `extractSvg` strips them.
- My first run showed 3 viewBox failures, and 2 retries did not fix them. Looking at the SVGs, the model was right and my check was wrong: it ignored `text-anchor` and `font-size` set in CSS classes, and it flagged `animateMotion` circles that start at (0,0) but are moved by the motion path. I fixed the check (CSS class rules are now read, and animateMotion elements are skipped) and added 2 unit tests. I then regenerated concepts 2, 3 and 5, so the numbers above come from real runs with the fixed check.
- One regeneration of concept 5 returned invalid XML (a duplicated `transform` attribute). The parse check caught it, and a later run passed.
- Not verified: the check estimates text width (0.5 x font size per character), so it can be wrong in either direction. Rotated groups and animateMotion elements are not checked.

## With one more day
- Render the SVGs in a headless browser to check them visually. I only tested the checks and have not looked at every diagram.
- Save reviews on the server so reviewers share them.
- Measure real text bounds in that browser instead of guessing the width.

## AI tools used
Claude Code wrote most of the code and tests with me. I reviewed it and ran it. Gemini generates the diagrams.
