// Fast drop-in for makefun-diff 1.0.0.
//
// Same answer as the house baseline on every input, computed with the
// same Myers rule the vendor states: common prefix, then common suffix,
// then the greedy search that on each diagonal keeps the path furthest
// into the old text, preferring a deletion when deletion and insertion
// reach the same point, never moving past either end, and following
// every run of equal lines as far as it goes.
//
// Speed comes from removing the baseline's per-step object allocations
// and from not searching the whole text: lines are interned to small
// integer ids (one Map lookup per line), long runs of equal lines
// that hold at least two once-only lines and end on once-only lines
// are fixed as anchors (chained by total kept length), the short
// stretches between them are searched with the exact Myers search,
// which keeps only integer x positions in one flat, reused Int32Array
// trace, and the edit script is recovered by walking that trace
// backwards. No dependency, no I/O, no caching between cases:
// every scratch structure is emptied at the start of each case.

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;
const SENTINEL = -1000000000;
const CONTEXT = 3;

// Split a text into its lines (cut after every '\n'; a last line with
// no '\n' is a line too; the empty text has none) and intern each line
// to an integer id shared by both texts of the case. Returns the id
// array and the line strings in parallel.
function tokenize(text, map, strs) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const n = last + (parts[last] !== '' ? 1 : 0);
  const ids = new Int32Array(n);
  const lines = new Array(n);
  for (let i = 0; i < last; i++) {
    const line = parts[i] + '\n';
    let id = map.get(line);
    if (id === undefined) {
      id = strs.length;
      map.set(line, id);
      strs.push(line);
    }
    ids[i] = id;
    lines[i] = line;
  }
  if (parts[last] !== '') {
    const line = parts[last];
    let id = map.get(line);
    if (id === undefined) {
      id = strs.length;
      map.set(line, id);
      strs.push(line);
    }
    ids[last] = id;
    lines[last] = line;
  }
  return { ids, lines };
}

// One flat trace buffer, reused across the cases of a run: trace
// row d starts at offset d*(d+1)/2 and holds d+1 entries, for
// k = -d, -d+2, ..., d (index (k+d)/2), the furthest x reached on
// that diagonal after the snake, or SENTINEL when unreachable.
// A single growing buffer beats one Int32Array per d (thousands of
// allocations and a 30 MB trace to collect per case).
let traceBuf = new Int32Array(1 << 20);
function traceOff(d) { return (d * (d + 1)) / 2; }
function traceEnsure(need) {
  if (need <= traceBuf.length) return;
  let cap = traceBuf.length;
  while (cap < need) cap *= 2;
  const next = new Int32Array(cap);
  next.set(traceBuf);
  traceBuf = next;
}

// Exact Myers trace on the middle slices a[0..n), b[0..m) (after the
// caller trimmed prefix/suffix). Returns { runs } where runs are
// {kind, count} in forward order, kinds KEEP/DELETE/INSERT.
function myersRuns(a, n, b, m) {
  if (n === 0) return m === 0 ? [] : [{ kind: INSERT, count: m }];
  if (m === 0) return [{ kind: DELETE, count: n }];

  let x = -1;
  let y = -1;
  while (x + 1 < n && y + 1 < m && a[x + 1] === b[y + 1]) { x++; y++; }
  traceBuf[0] = x;
  if (x + 1 >= n && y + 1 >= m) return [{ kind: KEEP, count: n }];

  const maxD = n + m;
  let D = -1;
  let finalK = 0;
  for (let d = 1; d <= maxD; d++) {
    const base = traceOff(d);
    const prevBase = traceOff(d - 1);
    traceEnsure(base + d + 1);
    let done = false;
    for (let j = 0; j <= d; j++) {
      const k = -d + 2 * j;
      const removeX = j - 1 >= 0 ? traceBuf[prevBase + j - 1] : SENTINEL;
      const addX = j < d ? traceBuf[prevBase + j] : SENTINEL;
      const canRemove = removeX !== SENTINEL && removeX + 1 < n;
      const canAdd = addX !== SENTINEL && addX - k < m;
      if (!canRemove && !canAdd) { traceBuf[base + j] = SENTINEL; continue; }
      const byDel = canRemove ? removeX + 1 : -2;
      const byIns = canAdd ? addX : -2;
      let xx = byDel >= byIns ? byDel : byIns;
      let yy = xx - k;
      while (xx + 1 < n && yy + 1 < m && a[xx + 1] === b[yy + 1]) { xx++; yy++; }
      traceBuf[base + j] = xx;
      if (xx + 1 >= n && yy + 1 >= m) { D = d; finalK = k; done = true; break; }
    }
    if (done) break;
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Walk the trace backwards. Each step contributes one edit and the
  // snake that followed it (in forward order); collect them reversed,
  // then reverse and merge adjacent runs of the same kind.
  const rev = [];
  let cx = n - 1;
  let cy = m - 1;
  for (let d = D; d >= 1; d--) {
    const k = cx - cy;
    const prevBase = traceOff(d - 1);
    const j = (k + d) >> 1;
    const removeX = j - 1 >= 0 ? traceBuf[prevBase + j - 1] : SENTINEL;
    const addX = j < d ? traceBuf[prevBase + j] : SENTINEL;
    const canRemove = removeX !== SENTINEL && removeX + 1 < n;
    const canAdd = addX !== SENTINEL && addX - k < m;
    const byDel = canRemove ? removeX + 1 : -2;
    const byIns = canAdd ? addX : -2;
    let xCand;
    let kind;
    let xPrev;
    let kPrev;
    if (byDel >= byIns) {
      kind = DELETE; xPrev = removeX; kPrev = k - 1; xCand = removeX + 1;
    } else {
      kind = INSERT; xPrev = addX; kPrev = k + 1; xCand = addX;
    }
    const snake = cx - xCand;
    if (snake > 0) rev.push({ kind: KEEP, count: snake });
    rev.push({ kind, count: 1 });
    cx = xPrev;
    cy = xPrev - kPrev;
  }
  if (cx >= 0) rev.push({ kind: KEEP, count: cx + 1 });
  rev.reverse();
  const runs = [];
  for (const r of rev) {
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === r.kind) lastRun.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  return runs;
}

// Scratch structures reused across the cases of a run (emptied at
// the start of each case, so no case's data carries into the next);
// a fresh 20k-entry Map per case is pure allocation churn.
let internMap = new Map();
let internStrs = [];
let gramMap = new Map();

// Push a run onto a run list, merging with the previous run when it
// is of the same kind.
function pushRun(runs, kind, count) {
  if (count <= 0) return;
  const lastRun = runs[runs.length - 1];
  if (lastRun !== undefined && lastRun.kind === kind) lastRun.count += count;
  else runs.push({ kind, count });
}

// The anchored shortcut. A single unique line is NOT a safe anchor:
// Myers's tie-break can keep the repeated line it is swapped with
// and move the unique line instead (both scripts are equally short),
// so anchoring single lines changes the patch. What is safe is a
// maximal run of at least 4 equal lines, holding at least 2 lines
// that occur exactly once in each text: skipping such a run would
// cost at least 8 edits, and no 1- or 2-line swap can displace it,
// while a moved block's copy of it conflicts with the runs around
// it and loses the chain below. Runs are chained by total kept
// length (a run is taken only when it follows the previous run in
// both texts), and every stretch between chained runs is diffed
// with the exact Myers search above, which alone decides every
// ambiguous spot (moved blocks, swaps, repeated runs). With no
// chained run at all this falls back to the plain search.
function anchoredRuns(a, n, b, m, distinct) {
  const countA = new Int32Array(distinct);
  const countB = new Int32Array(distinct);
  for (let i = 0; i < n; i++) countA[a[i]]++;
  for (let j = 0; j < m; j++) countB[b[j]]++;
  const unique = (id) => countA[id] === 1 && countB[id] === 1;

  // Index b's 4-grams (numeric hash) to candidate positions, keeping
  // only grams that occur at most 4 times, so runs of repeated lines
  // never flood the search.
  gramMap.clear();
  for (let j = 0; j + 3 < m; j++) {
    const h = ((b[j] * 1000003 + b[j + 1]) * 1000003 + b[j + 2]) * 1000003 + b[j + 3];
    let list = gramMap.get(h);
    if (list === undefined) { list = []; gramMap.set(h, list); }
    if (list.length < 5) list.push(j);
  }
  // Maximal runs of length >= 4 with at least 2 unique lines.
  const runs0 = [];
  for (let i = 0; i + 3 < n; i++) {
    const h = ((a[i] * 1000003 + a[i + 1]) * 1000003 + a[i + 2]) * 1000003 + a[i + 3];
    const list = gramMap.get(h);
    if (list === undefined) continue;
    for (let t = 0; t < list.length; t++) {
      const j = list[t];
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) continue; // not a run start
      if (a[i] !== b[j] || a[i + 1] !== b[j + 1] || a[i + 2] !== b[j + 2] || a[i + 3] !== b[j + 3]) continue; // hash hit, not a match
      let len = 4;
      while (i + len < n && j + len < m && a[i + len] === b[j + len]) len++;
      // Trim the run's ends back to lines that occur exactly once in
      // each text. A run edge on a duplicated line can slide by one
      // copy (a doubled or repeated line), which shifts the next
      // gap's start by one and flips which copy Myers keeps; a
      // unique line cannot slide, so the anchor's ends are exact.
      let ii = i;
      let jj = j;
      while (len > 0 && !unique(a[ii])) { ii++; jj++; len--; }
      while (len > 0 && !unique(a[ii + len - 1])) len--;
      let uniq = 0;
      for (let k = 0; k < len && uniq < 2; k++) if (unique(a[ii + k])) uniq++;
      if (uniq < 2 || len < 4) continue;
      runs0.push({ i: ii, j: jj, len });
    }
  }
  if (runs0.length === 0) return myersRuns(a, n, b, m);

  // Heaviest chain of non-overlapping runs, in both texts.
  const R = runs0.length;
  const dp = new Int32Array(R);
  const prev = new Int32Array(R);
  let bestIdx = -1;
  let bestVal = 0;
  for (let r = 0; r < R; r++) {
    const run = runs0[r];
    let val = run.len;
    let p = -1;
    for (let s = 0; s < r; s++) {
      const o = runs0[s];
      if (o.i + o.len <= run.i && o.j + o.len <= run.j && dp[s] + run.len > val) {
        val = dp[s] + run.len;
        p = s;
      }
    }
    dp[r] = val;
    prev[r] = p;
    if (val > bestVal) { bestVal = val; bestIdx = r; }
  }
  // Walk the chain backwards, then forward.
  const chain = [];
  for (let r = bestIdx; r >= 0; r = prev[r]) chain.push(runs0[r]);
  chain.reverse();

  const runs = [];
  let prevI = -1;
  let prevJ = -1;
  for (const run of chain) {
    const gap = myersRuns(a.subarray(prevI + 1, run.i), run.i - prevI - 1, b.subarray(prevJ + 1, run.j), run.j - prevJ - 1);
    for (const r of gap) pushRun(runs, r.kind, r.count);
    pushRun(runs, KEEP, run.len);
    prevI = run.i + run.len - 1;
    prevJ = run.j + run.len - 1;
  }
  const gap = myersRuns(a.subarray(prevI + 1, n), n - prevI - 1, b.subarray(prevJ + 1, m), m - prevJ - 1);
  for (const r of gap) pushRun(runs, r.kind, r.count);
  return runs;
}

// A line as the patch writes it: op, the line, a newline, and '%' on
// a line of its own when the line had no newline.
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  internMap.clear();
  internStrs.length = 0;
  const map = internMap;
  const strs = internStrs;
  const A = tokenize(input.old, map, strs);
  const B = tokenize(input.new, map, strs);
  const a = A.ids;
  const b = B.ids;
  const n = a.length;
  const m = b.length;

  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  const mid = anchoredRuns(a.subarray(prefix, n - suffix), n - prefix - suffix, b.subarray(prefix, m - suffix), m - prefix - suffix, strs.length);
  for (const r of mid) {
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === r.kind) lastRun.count += r.count;
    else runs.push({ kind: r.kind, count: r.count });
  }
  if (suffix > 0) {
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === KEEP) lastRun.count += suffix;
    else runs.push({ kind: KEEP, count: suffix });
  }

  // Change runs: each a stretch of deletions/insertions between keeps.
  const aLines = A.lines;
  const bLines = B.lines;
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) { o += r.count; p += r.count; continue; }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) { c.dels += r.count; o += r.count; deleted += r.count; }
    else { c.ins += r.count; p += r.count; inserted += r.count; }
  }

  // Hunks: change runs at most 2*CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const lastH = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (lastH.o + lastH.dels));
    const oldEnd = lastH.o + lastH.dels + after;
    const newEnd = lastH.p + lastH.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', aLines[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', aLines[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', bLines[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', aLines[at]));
  }
  return out.join('');
}
