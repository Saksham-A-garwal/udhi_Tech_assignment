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
npm test                                # unit tests for checks and retry logic
```
The key is only read from the environment (`.env` is git-ignored). Never put it in code.

## Results (from `results.json`)
Cost is an estimate (0.10 USD / 1M input tokens, 0.40 USD / 1M output tokens). The free tier really costs $0.

| # | Concept | Checks | Cost (USD) | Retries |
|---|---|---|---|---|
| 1 | Pythagoras' theorem | PASS (5/5) | 0.001593 | 0 |
| 2 | Parts of a circle | FAIL: inside_viewbox | 0.002093 | 1 |
| 3 | Series circuit | FAIL: inside_viewbox | 0.002179 | 1 |
| 4 | Photosynthesis | PASS (5/5) | 0.001833 | 0 |
| 5 | States of matter | FAIL: inside_viewbox | 0.002628 | 1 |

Three diagrams still fail after their one retry. I kept them as they are, and did not hide or fake a pass.

## Checks
1. `parses`: valid XML. 2. `inside_viewbox`: every shape and text is inside the viewBox. 3. `title_and_labels`: a `<title>` and at least 3 `<text>` labels. 4. `has_animation`: CSS `@keyframes` or SMIL.
5. My own, `safe_content`: no `<script>`, event handlers (`onclick=`) or external links. The SVG is shown on the page, so this stops a model from running code in the reviewer's browser.

## Review storage: browser localStorage
Approve/Reject and notes are saved in the reviewer's browser. I chose it because it needs no database and works on free hosts, whose disks are wiped on redeploy. The downside: decisions are per browser and are not shared between reviewers.

## What failed and how I fixed it
- Gemini often returned 503. The client waits 2s, 4s, 8s and retries up to 3 times.
- The model wraps SVG in code fences. `extractSvg` strips them.
- The model puts text past the edge of the viewBox. The retry sends the exact failure message back to the model. That fixed none of the three that failed. The model moved some elements but broke others.
- Unverified: the viewBox check estimates text width, so it may be stricter than a real browser. Rotated groups are not checked.

## With one more day
- Fix the viewBox failures: use `text-anchor`, or a prompt with explicit safe margins, and try the larger `gemini-3.5-flash` model.
- Save reviews on the server so reviewers share them.
- Render the SVG in a headless browser to measure real text bounds.

## AI tools used
Claude Code wrote most of the code and tests with me. I reviewed it and ran it. Gemini generates the diagrams.
