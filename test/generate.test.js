import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDiagram, extractSvg } from '../src/generate.js';
import { CONCEPTS } from '../src/concepts.js';

const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><title>T</title>
<circle cx="400" cy="250" r="50"><animate attributeName="r" values="40;60;40" dur="2s" repeatCount="indefinite"/></circle>
<text x="50" y="50">a</text><text x="50" y="80">b</text><text x="50" y="110">c</text></svg>`;
const bad = good.replace(/<animate[^>]*\/>/, '');

const fake = (replies, prompts = []) => async ({ prompt }) => {
  prompts.push(prompt);
  return { text: replies.shift(), inputTokens: 100, outputTokens: 200, apiRetries: 0 };
};

test('good first answer: no retry', async () => {
  const r = await generateDiagram(CONCEPTS[0], { call: fake([good]) });
  assert.equal(r.retries, 0);
  assert.equal(r.allPassed, true);
});

test('bad first answer: retries once, tells the model why, sums tokens', async () => {
  const prompts = [];
  const r = await generateDiagram(CONCEPTS[0], { call: fake([bad, good], prompts) });
  assert.equal(r.retries, 1);
  assert.equal(r.allPassed, true);
  assert.equal(r.inputTokens, 200);
  assert.equal(r.outputTokens, 400);
  assert.match(prompts[1], /has_animation/);
});

test('still bad after the retry: stops (only one retry) and reports failure', async () => {
  const r = await generateDiagram(CONCEPTS[0], { call: fake([bad, bad]) });
  assert.equal(r.retries, 1);
  assert.equal(r.allPassed, false);
});

test('extractSvg removes code fences', () => {
  assert.equal(extractSvg('```svg\n<svg a="1"></svg>\n```'), '<svg a="1"></svg>');
});
