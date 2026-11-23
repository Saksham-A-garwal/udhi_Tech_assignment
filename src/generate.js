// Part A for ONE concept: ask the model, check the SVG, retry once if a check failed.
import { callGemini, estimateCostUsd, MODEL } from './gemini.js';
import { runChecks } from './checks.js';

const SYSTEM = `You are an expert maker of clear, accurate, animated SVG diagrams for UK GCSE students.
Return ONLY the SVG code. No markdown, no code fences, no explanation.
Rules:
- The root element is <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">.
- The first child is a <title> that names the diagram.
- Add at least 6 short <text> labels that name the important parts (font-size 14 or more).
- Include at least one animation that helps explain the idea, using SMIL (<animate>, <animateTransform>, <animateMotion>) or CSS @keyframes.
- Keep EVERYTHING inside the viewBox, including text. Leave a margin of 20 units.
- No <script>, no event handlers, no <foreignObject>, no external images, fonts or links.
- The science must be correct and easy to read on a white background.`;

function buildPrompt(c) {
  return `Make one animated SVG diagram for this ${c.subject} concept: ${c.concept}.\n\nExplain this text visually:\n"${c.text}"`;
}

function buildRetryPrompt(c, previousSvg, failures) {
  return `${buildPrompt(c)}

Your previous SVG failed these checks:
${failures.map((f) => `- ${f.name}: ${f.message}`).join('\n')}

Here is the previous SVG:
${previousSvg}

Fix every problem and return the complete corrected SVG only.`;
}

// Pull the <svg>...</svg> out of the model reply (it may add fences or chatter).
export function extractSvg(text) {
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start === -1) return text.trim(); // let the parse check report it
  return end === -1 ? text.slice(start).trim() : text.slice(start, end + 6).trim();
}

export async function generateDiagram(c, { call = callGemini } = {}) {
  let inputTokens = 0;
  let outputTokens = 0;
  let apiRetries = 0;
  let retries = 0; // how many times we re-asked because a check failed
  let svg = '';
  let checks = [];

  let prompt = buildPrompt(c);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await call({ system: SYSTEM, prompt });
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    apiRetries += r.apiRetries;
    svg = extractSvg(r.text);
    checks = runChecks(svg);

    const failures = checks.filter((x) => !x.passed);
    if (failures.length === 0 || attempt === 1) break;

    retries++;
    console.log(`  Checks failed (${failures.map((f) => f.name).join(', ')}); retrying once`);
    prompt = buildRetryPrompt(c, svg, failures);
  }

  return {
    id: c.id,
    concept: c.concept,
    subject: c.subject,
    model: MODEL,
    svg,
    checks,
    allPassed: checks.every((x) => x.passed),
    inputTokens,
    outputTokens,
    costUsd: Number(estimateCostUsd(inputTokens, outputTokens).toFixed(6)),
    retries,
    apiRetries,
    generatedAt: new Date().toISOString(),
  };
}
