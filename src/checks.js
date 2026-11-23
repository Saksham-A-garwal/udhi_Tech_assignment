import { DOMParser } from '@xmldom/xmldom';

export const CHECK_NAMES = [
  'parses',
  'inside_viewbox',
  'title_and_labels',
  'has_animation',
  'safe_content',
];

const TOLERANCE = 1;
const SKIP_TAGS = new Set(['defs', 'clipPath', 'mask', 'marker', 'pattern', 'symbol', 'style', 'title', 'desc']);


function elementChildren(node) {
  return Array.from(node.childNodes || []).filter((n) => n.nodeType === 1);
}

function walk(node, fn) {
  fn(node);
  for (const c of elementChildren(node)) walk(c, fn);
}

function tagOf(el) {
  return el.localName || el.tagName;
}

function nums(str) {
  return (str || '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) || [];
}

function num(el, attr, fallback = 0) {
  const v = parseFloat(el.getAttribute(attr));
  return Number.isFinite(v) ? v : fallback;
}


export function parseSvg(svg) {
  const errors = [];
  const parser = new DOMParser({
    onError: (level, msg) => {
      if (level !== 'warning') errors.push(msg.split('\n')[0]);
    },
  });
  let doc;
  try {
    doc = parser.parseFromString(svg, 'image/svg+xml');
  } catch (e) {
    return { doc: null, error: `XML parse error: ${e.message.split('\n')[0]}` };
  }
  if (errors.length) return { doc: null, error: `XML parse error: ${errors[0]}` };
  const root = doc && doc.documentElement;
  if (!root || tagOf(root) !== 'svg') return { doc: null, error: 'Root element is not <svg>' };
  return { doc, root, error: null };
}


function getViewBox(root) {
  const vb = nums(root.getAttribute('viewBox'));
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  return null;
}


function composeTransform(parent, attr) {
  if (!attr) return parent;
  let t = parent;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(attr))) {
    const a = nums(m[2]);
    let c;
    if (m[1] === 'translate') c = { sx: 1, sy: 1, tx: a[0] || 0, ty: a[1] || 0 };
    else if (m[1] === 'scale') c = { sx: a[0] ?? 1, sy: a[1] ?? a[0] ?? 1, tx: 0, ty: 0 };
    else return null;

    t = { sx: t.sx * c.sx, sy: t.sy * c.sy, tx: t.sx * c.tx + t.tx, ty: t.sy * c.ty + t.ty };
  }
  return t;
}

const ARG_COUNT = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function pathPoints(d) {
  const pts = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const re = /([a-zA-Z])([^a-zA-Z]*)/g;
  let m;
  while ((m = re.exec(d || ''))) {
    const cmd = m[1];
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;
    const n = ARG_COUNT[lower];
    if (n === undefined) continue;
    if (lower === 'z') { x = sx; y = sy; continue; }
    const a = nums(m[2]);
    for (let i = 0, first = true; i + n <= a.length; i += n, first = false) {
      const p = a.slice(i, i + n);
      if (lower === 'h') x = rel ? x + p[0] : p[0];
      else if (lower === 'v') y = rel ? y + p[0] : p[0];
      else {

        const ex = p[n - 2], ey = p[n - 1];
        x = rel ? x + ex : ex;
        y = rel ? y + ey : ey;
        if (lower === 'm' && first) { sx = x; sy = y; }
      }
      pts.push([x, y]);
    }
  }
  return pts;
}


let cssClassRules = {};
function readCssRules(root) {
  cssClassRules = {};
  walk(root, (n) => {
    if (n.nodeType !== 1 || tagOf(n) !== 'style') return;
    const css = (n.textContent || '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      for (const sel of m[1].split(',')) {
        const cls = /^\s*(?:text)?\.([\w-]+)\s*$/.exec(sel);
        if (cls) cssClassRules[cls[1]] = (cssClassRules[cls[1]] || '') + ';' + m[2];
      }
    }
  });
}


function styleProp(n, prop) {
  const a = n.getAttribute(prop);
  if (a) return a.trim();
  const re = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)');
  const inline = re.exec(n.getAttribute('style') || '');
  if (inline) return inline[1].trim();
  for (const c of (n.getAttribute('class') || '').split(/\s+/)) {
    const m = c && cssClassRules[c] ? re.exec(cssClassRules[c]) : null;
    if (m) return m[1].trim();
  }
  return null;
}

function fontSizeOf(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    const v = parseFloat(styleProp(n, 'font-size'));
    if (Number.isFinite(v)) return v;
  }
  return 16;
}

function anchorOf(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    const a = styleProp(n, 'text-anchor');
    if (a) return a;
  }
  return 'start';
}


function elementPoints(el, tag) {
  switch (tag) {
    case 'rect': {
      const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
      return [[x, y], [x + w, y + h]];
    }
    case 'circle': {
      const cx = num(el, 'cx'), cy = num(el, 'cy'), r = num(el, 'r');
      return [[cx - r, cy - r], [cx + r, cy + r]];
    }
    case 'ellipse': {
      const cx = num(el, 'cx'), cy = num(el, 'cy'), rx = num(el, 'rx'), ry = num(el, 'ry');
      return [[cx - rx, cy - ry], [cx + rx, cy + ry]];
    }
    case 'line':
      return [[num(el, 'x1'), num(el, 'y1')], [num(el, 'x2'), num(el, 'y2')]];
    case 'polygon':
    case 'polyline': {
      const a = nums(el.getAttribute('points'));
      const out = [];
      for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]);
      return out;
    }
    case 'path':
      return pathPoints(el.getAttribute('d'));
    case 'text': {
      const text = (el.textContent || '').trim();
      if (!text || !el.getAttribute('x') || !el.getAttribute('y')) return [];
      const x = num(el, 'x'), y = num(el, 'y'), fs = fontSizeOf(el);
      const w = text.length * fs * 0.5;
      const anchor = anchorOf(el);
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      return [[x0, y - fs], [x0 + w, y + fs * 0.25]];
    }
    default:
      return [];
  }
}

export function checkViewBox(root) {
  const vb = getViewBox(root);
  if (!vb) return { passed: false, message: 'The root <svg> has no valid viewBox (needs "minX minY width height").' };
  readCssRules(root);
  const problems = [];
  let skipped = 0;

  const visit = (el, t) => {
    const tag = tagOf(el);
    if (SKIP_TAGS.has(tag)) return;
    if (elementChildren(el).some((c) => tagOf(c) === 'animateMotion')) { skipped++; return; }
    const nt = composeTransform(t, el.getAttribute('transform'));
    if (nt === null) { skipped++; return; }
    for (const [px, py] of elementPoints(el, tag)) {
      const X = px * nt.sx + nt.tx, Y = py * nt.sy + nt.ty;
      if (X < vb.x - TOLERANCE || X > vb.x + vb.w + TOLERANCE || Y < vb.y - TOLERANCE || Y > vb.y + vb.h + TOLERANCE) {
        problems.push(`<${tag}> reaches (${Math.round(X)}, ${Math.round(Y)})`);
        break;
      }
    }
    for (const c of elementChildren(el)) visit(c, nt);
  };
  for (const c of elementChildren(root)) visit(c, { sx: 1, sy: 1, tx: 0, ty: 0 });

  if (problems.length) {
    const shown = problems.slice(0, 5).join('; ');
    return {
      passed: false,
      message: `${problems.length} element(s) are outside the viewBox (${vb.x} ${vb.y} ${vb.w} ${vb.h}): ${shown}.`,
    };
  }
  return { passed: true, message: `All drawn elements are inside the viewBox${skipped ? ` (${skipped} rotated/matrix group(s) not verifiable)` : ''}.` };
}


export function checkTitleAndLabels(root) {
  const title = elementChildren(root).find((c) => tagOf(c) === 'title');
  const hasTitle = !!title && title.textContent.trim().length > 0;
  let labels = 0;
  walk(root, (el) => {
    if (tagOf(el) === 'text' && (el.textContent || '').trim()) labels++;
  });
  const problems = [];
  if (!hasTitle) problems.push('missing a non-empty <title> as a direct child of <svg>');
  if (labels < 3) problems.push(`only ${labels} text label(s), need at least 3`);
  return problems.length
    ? { passed: false, message: `The SVG is ${problems.join(' and ')}.` }
    : { passed: true, message: `Has a title and ${labels} text labels.` };
}


export function checkAnimation(root) {
  let smil = 0;
  let css = false;
  walk(root, (el) => {
    const tag = tagOf(el);
    if (['animate', 'animateTransform', 'animateMotion', 'set'].includes(tag)) smil++;
    if (tag === 'style' && /@keyframes/.test(el.textContent) && /animation(-name)?\s*:/.test(el.textContent)) css = true;
  });
  return smil || css
    ? { passed: true, message: smil ? `Has ${smil} SMIL animation element(s).` : 'Has CSS @keyframes animation.' }
    : { passed: false, message: 'No animation found. Add SMIL (<animate>, <animateTransform>, <animateMotion>) or CSS @keyframes.' };
}


export function checkSafeContent(root) {
  const problems = [];
  walk(root, (el) => {
    const tag = tagOf(el);
    if (tag === 'script') problems.push('<script> element');
    if (tag === 'foreignObject') problems.push('<foreignObject> element');
    for (const a of Array.from(el.attributes || [])) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on')) problems.push(`${a.name} event handler`);
      if ((name === 'href' || name === 'xlink:href') && !a.value.trim().startsWith('#')) problems.push(`external ${a.name} "${a.value.slice(0, 40)}"`);
      if (/javascript:/i.test(a.value)) problems.push('javascript: URL');
    }
    if (tag === 'style' && /@import|url\(\s*['"]?https?:/i.test(el.textContent)) problems.push('external CSS import/url');
  });
  return problems.length
    ? { passed: false, message: `Unsafe content found: ${[...new Set(problems)].slice(0, 5).join(', ')}. Remove it.` }
    : { passed: true, message: 'No scripts, event handlers or external links.' };
}


export function runChecks(svg) {
  const parsed = parseSvg(svg);
  if (parsed.error) {
    return CHECK_NAMES.map((name) => ({
      name,
      passed: false,
      message: name === 'parses' ? parsed.error : 'Not run because the SVG could not be parsed.',
    }));
  }
  const { root } = parsed;
  return [
    { name: 'parses', passed: true, message: 'SVG parsed as valid XML.' },
    { name: 'inside_viewbox', ...checkViewBox(root) },
    { name: 'title_and_labels', ...checkTitleAndLabels(root) },
    { name: 'has_animation', ...checkAnimation(root) },
    { name: 'safe_content', ...checkSafeContent(root) },
  ];
}
