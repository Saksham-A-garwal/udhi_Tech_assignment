import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/checks.js';

const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
  <title>Good diagram</title>
  <circle cx="400" cy="250" r="100" fill="none" stroke="black">
    <animate attributeName="r" values="90;110;90" dur="2s" repeatCount="indefinite"/>
  </circle>
  <text x="400" y="50" text-anchor="middle">One</text>
  <text x="100" y="480">Two</text>
  <text x="700" y="480" text-anchor="end">Three</text>
  <path d="M 10 10 L 100 10 L 100 100 Z" fill="red"/>
</svg>`;

const status = (svg) => Object.fromEntries(runChecks(svg).map((c) => [c.name, c.passed]));

test('a good svg passes all 5 checks', () => {
  assert.deepEqual(status(good), {
    parses: true, inside_viewbox: true, title_and_labels: true, has_animation: true, safe_content: true,
  });
});

test('broken XML fails parse and the rest are not run', () => {
  const s = status('<svg viewBox="0 0 10 10"><title>x</svg>');
  assert.equal(s.parses, false);
  assert.equal(s.has_animation, false);
});

test('shape outside viewBox is caught', () => {
  const s = status(good.replace('cx="400"', 'cx="790"'));
  assert.equal(s.inside_viewbox, false);
});

test('path and translate outside viewBox are caught', () => {
  assert.equal(status(good.replace('L 100 100', 'L 100 900')).inside_viewbox, false);
  assert.equal(status(good.replace('<path', '<g transform="translate(900,0)"><path').replace('Z" fill="red"/>', 'Z" fill="red"/></g>')).inside_viewbox, false);
});

test('missing viewBox fails', () => {
  assert.equal(status(good.replace(' viewBox="0 0 800 500"', '')).inside_viewbox, false);
});

test('missing title and too few labels fail', () => {
  assert.equal(status(good.replace('<title>Good diagram</title>', '')).title_and_labels, false);
  assert.equal(status(good.replace(/<text x="100"[^]*?<\/text>/, '')).title_and_labels, false);
});

test('no animation fails; CSS keyframes pass', () => {
  const noAnim = good.replace(/<animate[^>]*\/>/, '');
  assert.equal(status(noAnim).has_animation, false);
  const css = noAnim.replace('<title>', '<style>@keyframes s{to{opacity:0}} circle{animation: s 2s infinite}</style><title>');
  assert.equal(status(css).has_animation, true);
});

test('scripts, handlers and external links fail the safety check', () => {
  assert.equal(status(good.replace('<title>', '<script>alert(1)</script><title>')).safe_content, false);
  assert.equal(status(good.replace('<circle', '<circle onclick="x()"')).safe_content, false);
  assert.equal(status(good.replace('<path', '<image href="https://evil.com/a.png"/><path')).safe_content, false);
});
