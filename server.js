import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPTS } from './src/concepts.js';
import { generateDiagram } from './src/generate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(here, 'public')));

// Saved results: read from results.json. No AI call happens here.
app.get('/api/results', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(path.join(here, 'results.json'), 'utf8')));
  } catch {
    res.json([]);
  }
});

// Generate button: run Part A live for one concept. The result is sent back, not saved to disk.
let busy = false; // one live call at a time, so visitors cannot burn the free quota in parallel
app.post('/api/generate/:id', async (req, res) => {
  const concept = CONCEPTS.find((c) => c.id === Number(req.params.id));
  if (!concept) return res.status(404).json({ error: 'Unknown concept id.' });
  if (busy) return res.status(429).json({ error: 'Another diagram is being generated. Please wait a moment and try again.' });
  busy = true;
  try {
    res.json(await generateDiagram(concept));
  } catch (e) {
    res.status(e.status && e.status >= 400 ? e.status : 502).json({ error: e.message });
  } finally {
    busy = false;
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Open http://localhost:${port}`));
