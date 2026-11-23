// Runs Part A for all 5 concepts and saves results.json.
// Usage: npm run generate        (needs GEMINI_API_KEY in the environment or in .env)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPTS } from '../src/concepts.js';
import { generateDiagram } from '../src/generate.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'results.json');
const only = process.argv[2] ? Number(process.argv[2]) : null; // optional: run one concept id

let results = [];
try { results = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }

let failed = 0;
for (const c of CONCEPTS.filter((x) => !only || x.id === only)) {
  console.log(`\n[${c.id}/5] ${c.concept}`);
  try {
    const r = await generateDiagram(c);
    // The log line the assignment asks for
    console.log(
      `  model=${r.model} in=${r.inputTokens} out=${r.outputTokens} cost=$${r.costUsd} retries=${r.retries} apiRetries=${r.apiRetries}`,
    );
    for (const k of r.checks) console.log(`  ${k.passed ? 'PASS' : 'FAIL'} ${k.name}: ${k.message}`);
    results = [...results.filter((x) => x.id !== r.id), r].sort((a, b) => a.id - b.id);
    fs.writeFileSync(file, JSON.stringify(results, null, 2)); // save after each one
  } catch (e) {
    failed++;
    console.error(`  ERROR: ${e.message}`);
  }
}
console.log(`\nSaved ${results.length} result(s) to results.json${failed ? ` (${failed} failed, run again)` : ''}`);
process.exit(failed ? 1 : 0);
