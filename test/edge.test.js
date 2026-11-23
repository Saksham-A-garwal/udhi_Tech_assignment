import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/checks.js';
import { generateDiagram, extractSvg } from '../src/generate.js';
import { callGemini, estimateCostUsd, ApiError } from '../src/gemini.js';
import { CONCEPTS } from '../src/concepts.js';

const wrap = (inner, vb = '0 0 800 500') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><title>T</title>${inner}</svg>`;
const labels = '<text x="10" y="20">a</text><text x="10" y="40">b</text><text x="10" y="60">c</text>';
const anim = '<circle cx="50" cy="50" r="5"><animate attributeName="r" values="5;9;5" dur="1s"/></circle>';
const get = (svg, name) => runChecks(svg).find((c) => c.name === name);

test('empty string and plain text do not parse', () => {
  assert.equal(get('', 'parses').passed, false);
  assert.equal(get('hello world', 'parses').passed, false);
});
test('unclosed tag fails to parse and does not throw', () => {
  assert.equal(get('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', 'parses').passed, false);
});
test('duplicated attribute (a real model error) fails to parse', () => {
  assert.equal(get(wrap('<g transform="a" transform="b"/>'), 'parses').passed, false);
});

test('shape exactly on the edge passes; 3 units outside fails', () => {
  assert.equal(get(wrap('<rect x="0" y="0" width="800" height="500"/>'), 'inside_viewbox').passed, true);
  assert.equal(get(wrap('<rect x="0" y="0" width="803" height="500"/>'), 'inside_viewbox').passed, false);
});
test('negative coordinates are caught', () => {
  assert.equal(get(wrap('<circle cx="2" cy="50" r="10"/>'), 'inside_viewbox').passed, false);
});
test('viewBox with commas and a non-zero origin works', () => {
  assert.equal(get(wrap('<rect x="100" y="100" width="50" height="50"/>', '100,100,200,200'), 'inside_viewbox').passed, true);
  assert.equal(get(wrap('<rect x="0" y="0" width="50" height="50"/>', '100,100,200,200'), 'inside_viewbox').passed, false);
});
test('invalid viewBox values fail', () => {
  assert.equal(get(wrap('', 'a b c d'), 'inside_viewbox').passed, false);
  assert.equal(get(wrap('', '0 0 0 0'), 'inside_viewbox').passed, false);
});
test('scale transform that pushes a shape out is caught', () => {
  assert.equal(get(wrap('<g transform="scale(3)"><rect x="200" y="10" width="100" height="10"/></g>'), 'inside_viewbox').passed, false);
});
test('nested translate is composed', () => {
  const inside = wrap('<g transform="translate(700,0)"><g transform="translate(50,0)"><circle cx="10" cy="50" r="5"/></g></g>');
  assert.equal(get(inside, 'inside_viewbox').passed, true);
  const out = wrap('<g transform="translate(700,0)"><g transform="translate(100,0)"><circle cx="10" cy="50" r="5"/></g></g>');
  assert.equal(get(out, 'inside_viewbox').passed, false);
});
test('long text that overflows to the right is caught; text-anchor=end fixes it', () => {
  const long = 'x'.repeat(80);
  assert.equal(get(wrap(`<text x="700" y="50" font-size="16">${long}</text>`), 'inside_viewbox').passed, false);
  assert.equal(get(wrap(`<text x="700" y="50" font-size="16" text-anchor="end">${long}</text>`), 'inside_viewbox').passed, true);
});
test('elements inside <defs> are not counted as drawn', () => {
  assert.equal(get(wrap('<defs><rect x="5000" y="5000" width="10" height="10"/></defs>'), 'inside_viewbox').passed, true);
});
test('path with relative commands is followed', () => {
  assert.equal(get(wrap('<path d="M 700 100 l 50 0 l 100 0"/>'), 'inside_viewbox').passed, false);
  assert.equal(get(wrap('<path d="M 100 100 l 50 0 l 100 0 z"/>'), 'inside_viewbox').passed, true);
});

test('empty title fails; title nested inside a group does not count', () => {
  assert.equal(get(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><title>  </title>${labels}</svg>`, 'title_and_labels').passed, false);
  assert.equal(get(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><g><title>T</title></g>${labels}</svg>`, 'title_and_labels').passed, false);
});
test('exactly 3 labels passes, 2 fails, blank labels do not count', () => {
  assert.equal(get(wrap(labels), 'title_and_labels').passed, true);
  assert.equal(get(wrap('<text x="1" y="1">a</text><text x="1" y="2">b</text>'), 'title_and_labels').passed, false);
  assert.equal(get(wrap('<text x="1" y="1">a</text><text x="1" y="2">b</text><text x="1" y="3">   </text>'), 'title_and_labels').passed, false);
});
test('text made of <tspan> counts as one label', () => {
  assert.equal(get(wrap('<text x="1" y="1"><tspan>a</tspan><tspan>b</tspan></text>'), 'title_and_labels').passed, false);
});

test('each SMIL element counts as animation', () => {
  for (const a of ['<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/>', '<animateMotion dur="2s" path="M0 0 L5 5"/>', '<set attributeName="r" to="9" begin="1s"/>']) {
    assert.equal(get(wrap(`<circle cx="9" cy="9" r="3">${a}</circle>`), 'has_animation').passed, true);
  }
});
test('@keyframes defined but never used does not count', () => {
  assert.equal(get(wrap('<style>@keyframes spin{to{opacity:0}}</style>'), 'has_animation').passed, false);
});
test('css animation with @keyframes counts', () => {
  assert.equal(get(wrap('<style>@keyframes spin{to{opacity:0}} .a{animation: spin 2s infinite}</style>'), 'has_animation').passed, true);
});

test('safety check catches each kind of unsafe thing', () => {
  const bads = [
    '<script>alert(1)</script>',
    '<rect width="5" height="5" onload="x()"/>',
    '<image href="http://evil.test/a.png"/>',
    '<image xlink:href="https://evil.test/a.png" xmlns:xlink="http://www.w3.org/1999/xlink"/>',
    '<a href="javascript:alert(1)"><rect width="5" height="5"/></a>',
    '<foreignObject width="5" height="5"/>',
    '<style>@import url(http://evil.test/x.css);</style>',
    '<style>.a{background:url(https://evil.test/a.png)}</style>',
  ];
  for (const b of bads) assert.equal(get(wrap(b), 'safe_content').passed, false, b);
});
test('internal #id references are allowed', () => {
  assert.equal(get(wrap('<defs><g id="a"><rect width="5" height="5"/></g></defs><use href="#a"/>'), 'safe_content').passed, true);
});

test('extractSvg handles chatter around the SVG and no SVG at all', () => {
  assert.equal(extractSvg('Sure! Here:\n<svg a="1"></svg>\nHope it helps'), '<svg a="1"></svg>');
  assert.equal(extractSvg('  no svg here  '), 'no svg here');
  assert.equal(extractSvg('<svg a="1"><g>'), '<svg a="1"><g>');
});

const good = wrap(labels + anim);
test('empty model reply: fails checks, retries once, no crash', async () => {
  let calls = 0;
  const r = await generateDiagram(CONCEPTS[0], { call: async () => { calls++; return { text: '', inputTokens: 5, outputTokens: 0, apiRetries: 0 }; } });
  assert.equal(calls, 2);
  assert.equal(r.allPassed, false);
  assert.equal(r.checks[0].passed, false);
});
test('API error during the retry is thrown, not swallowed', async () => {
  let n = 0;
  const call = async () => {
    if (n++ === 0) return { text: '<svg', inputTokens: 1, outputTokens: 1, apiRetries: 0 };
    throw new ApiError('boom', 503);
  };
  await assert.rejects(generateDiagram(CONCEPTS[0], { call }), /boom/);
});
test('apiRetries from both calls are summed', async () => {
  const replies = [{ text: '<svg', apiRetries: 2 }, { text: good, apiRetries: 1 }];
  const r = await generateDiagram(CONCEPTS[0], { call: async () => ({ inputTokens: 1, outputTokens: 1, ...replies.shift() }) });
  assert.equal(r.apiRetries, 3);
  assert.equal(r.retries, 1);
});

test('cost estimate: zero tokens is zero, 1M tokens uses the per-million price', () => {
  assert.equal(estimateCostUsd(0, 0), 0);
  assert.ok(Math.abs(estimateCostUsd(0, 1_000_000) - 0.4) < 1e-9);
  assert.ok(Math.abs(estimateCostUsd(1_000_000, 0) - 0.1) < 1e-9);
});

async function withFetch(fn, body) {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = fn;
  try { return await body(); } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = realKey;
  }
}
const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

test('missing API key gives a clear error and makes no request', async () => {
  const realKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try { await assert.rejects(callGemini({ system: 's', prompt: 'p' }), /GEMINI_API_KEY/); }
  finally { if (realKey !== undefined) process.env.GEMINI_API_KEY = realKey; }
});
test('400 is not retried', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json(400, { error: { message: 'bad request' } }); },
    () => assert.rejects(callGemini({ system: 's', prompt: 'p' }), /400.*bad request/));
  assert.equal(calls, 1);
});
test('429 gets a friendly rate-limit hint after 3 retries (2s+4s+8s wait)', { timeout: 30000 }, async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json(429, { error: { message: 'quota' } }); },
    () => assert.rejects(callGemini({ system: 's', prompt: 'p' }), /rate limit/));
  assert.equal(calls, 4);
});
test('503 then success: returns text, tokens (thinking tokens counted) and apiRetries=1', { timeout: 10000 }, async () => {
  let calls = 0;
  const ok = { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: '<svg/>' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 } };
  const r = await withFetch(async () => (calls++ === 0 ? json(503, {}) : json(200, ok)), () => callGemini({ system: 's', prompt: 'p' }));
  assert.equal(r.text, '<svg/>');
  assert.equal(r.inputTokens, 10);
  assert.equal(r.outputTokens, 25);
  assert.equal(r.apiRetries, 1);
});
test('network failure becomes a readable error', async () => {
  await withFetch(async () => { throw new Error('ECONNRESET'); },
    () => assert.rejects(callGemini({ system: 's', prompt: 'p' }), /Could not reach the Gemini API: ECONNRESET/));
});
test('empty candidates (safety block) returns empty text instead of crashing', async () => {
  const r = await withFetch(async () => json(200, { usageMetadata: { promptTokenCount: 3 } }), () => callGemini({ system: 's', prompt: 'p' }));
  assert.equal(r.text, '');
  assert.equal(r.inputTokens, 3);
});
