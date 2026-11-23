# Science Diagram Maker

Live app: **<ADD LINK AFTER DEPLOY>**

Model: `gemini-3.5-flash-lite` (free tier).

## How to run it on your computer
Needs Node 20+.
```
npm install
echo GEMINI_API_KEY=your_key > .env     # free key from aistudio.google.com/api-keys
npm run generate                        # Part A: all 5 concepts -> results.json
npm run dev                             # open http://localhost:3000
npm test
```
The key is read only from the environment. `.env` is git-ignored.

## Results
Cost is an estimate (0.10 USD per 1M input tokens, 0.40 USD per 1M output tokens). The free tier really costs $0.

| # | Concept | Pass / fail | Cost (USD) | Retries |
|---|---|---|---|---|
| 1 | Pythagoras' theorem | PASS | 0.001593 | 0 |
| 2 | Parts of a circle | PASS | 0.000891 | 0 |
| 3 | Series circuit | PASS | 0.002263 | 1 |
| 4 | Photosynthesis | PASS | 0.001833 | 0 |
| 5 | States of matter | PASS | 0.001406 | 0 |

My own 5th check is `safe_content`: no `<script>`, event handlers or external links, because the SVG is shown in the reviewer's browser.

## Where Approve / Reject is saved
In the browser (localStorage). I chose it because it needs no database and free hosts wipe their disks on redeploy. The downside is that choices are per browser and not shared between reviewers.

## What failed, and how I fixed it
- My first run showed 3 viewBox failures that 2 retries did not fix. The SVGs were fine and my check was wrong. It ignored `text-anchor` and `font-size` set in CSS classes, and it flagged `animateMotion` circles that start at (0,0). I fixed the check, added tests, and regenerated concepts 2, 3 and 5.
- Gemini often returned 503. The client waits 2s, 4s and 8s and retries up to 3 times.
- The model wraps SVG in code fences. `extractSvg` strips them.
- One run returned invalid XML (a duplicated `transform` attribute). The parse check caught it, and a later run passed.
- Not verified: the check guesses text width, so it can be wrong. I have not looked at every diagram in a browser.

## With one more day
- Render each SVG in a headless browser and measure real text bounds instead of guessing.
- Save reviews on the server so reviewers share them.
- Try the larger `gemini-3.5-flash` model for more reliable first answers.

## AI tools used
- Claude Code: wrote most of the code and tests with me. I reviewed and ran it.
- Gemini: generates the diagrams.
