/*
 * Super Slide — puzzle core + solver
 * Klotski / Huarong Dao engine shared by the game and the level tooling.
 *
 * Board is 4 wide x 5 tall. A valid piece set (matching the physical device)
 * is exactly: one 2x2 block, five 1x2 rectangles (either orientation) and
 * four 1x1 squares — 18 filled cells, 2 empty.
 *
 * A "move" is one continuous interaction with a single piece: it may travel
 * any distance and turn corners, exactly like one drag gesture. Under this
 * convention the classic layout solves in 81 moves / 116 cell steps, which
 * matches the published minimums.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SlideCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var W = 4;
  var H = 5;
  var GOAL_X = 1;
  var GOAL_Y = 3;
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function typeChar(p) {
    if (p.w === 2 && p.h === 2) return 'B';
    if (p.w === 1 && p.h === 2) return 'V';
    if (p.w === 2 && p.h === 1) return 'H';
    return 'S';
  }

  /**
   * Parse a layout written as 5 strings of 4 chars. Each distinct letter is a
   * piece, '.' is empty. Throws on a malformed layout.
   */
  function parseLayout(rows) {
    if (!Array.isArray(rows) || rows.length !== H) throw new Error('layout needs ' + H + ' rows');
    var boxes = Object.create(null);
    for (var y = 0; y < H; y++) {
      var row = rows[y];
      if (typeof row !== 'string' || row.length !== W) throw new Error('row ' + y + ' needs ' + W + ' cells');
      for (var x = 0; x < W; x++) {
        var ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        var b = boxes[ch];
        if (!b) boxes[ch] = { x0: x, y0: y, x1: x, y1: y, n: 1 };
        else {
          b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y);
          b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
          b.n++;
        }
      }
    }
    var pieces = [];
    Object.keys(boxes).forEach(function (ch) {
      var b = boxes[ch];
      var w = b.x1 - b.x0 + 1;
      var h = b.y1 - b.y0 + 1;
      if (w * h !== b.n) throw new Error('piece "' + ch + '" is not a rectangle');
      pieces.push({ id: ch, x: b.x0, y: b.y0, w: w, h: h });
    });
    pieces.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    return pieces;
  }

  /** Check the piece set matches the physical Super Slide inventory. */
  function validate(pieces) {
    var count = { B: 0, V: 0, H: 0, S: 0 };
    var grid = new Array(W * H).fill(null);
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.x < 0 || p.y < 0 || p.x + p.w > W || p.y + p.h > H) return 'piece out of bounds';
      count[typeChar(p)]++;
      for (var y = p.y; y < p.y + p.h; y++) {
        for (var x = p.x; x < p.x + p.w; x++) {
          if (grid[y * W + x] !== null) return 'pieces overlap';
          grid[y * W + x] = i;
        }
      }
    }
    if (count.B !== 1) return 'needs exactly one 2x2 block';
    if (count.V + count.H !== 5) return 'needs exactly five 1x2 rectangles';
    if (count.S !== 4) return 'needs exactly four 1x1 squares';
    return null;
  }

  /**
   * Canonical key: same-shaped pieces are interchangeable, so hashing the grid
   * of shape codes collapses equivalent states and keeps the search small.
   */
  function encode(pieces) {
    var cells = new Array(W * H).fill('.');
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var c = typeChar(p);
      for (var y = p.y; y < p.y + p.h; y++) {
        for (var x = p.x; x < p.x + p.w; x++) cells[y * W + x] = c;
      }
    }
    return cells.join('');
  }

  function bigIndex(pieces) {
    for (var i = 0; i < pieces.length; i++) if (pieces[i].w === 2 && pieces[i].h === 2) return i;
    return -1;
  }

  function isSolved(pieces) {
    var i = bigIndex(pieces);
    return i >= 0 && pieces[i].x === GOAL_X && pieces[i].y === GOAL_Y;
  }

  /** Occupancy grid of piece indices, -1 for empty, optionally lifting one piece. */
  function occupancy(pieces, coords, skip) {
    var grid = new Int8Array(W * H).fill(-1);
    for (var i = 0; i < pieces.length; i++) {
      if (i === skip) continue;
      var p = pieces[i];
      var px = coords[i * 2];
      var py = coords[i * 2 + 1];
      for (var y = py; y < py + p.h; y++) {
        for (var x = px; x < px + p.w; x++) grid[y * W + x] = i;
      }
    }
    return grid;
  }

  /**
   * Every position one piece can reach in a single gesture, with the cell path
   * taken to get there. `grid` must already have that piece lifted out.
   */
  function reachable(grid, piece, fromX, fromY) {
    var free = new Uint8Array(W * H);
    for (var y = 0; y <= H - piece.h; y++) {
      for (var x = 0; x <= W - piece.w; x++) {
        var ok = 1;
        for (var yy = y; yy < y + piece.h && ok; yy++) {
          for (var xx = x; xx < x + piece.w; xx++) {
            if (grid[yy * W + xx] !== -1) { ok = 0; break; }
          }
        }
        free[y * W + x] = ok;
      }
    }
    var from = new Int16Array(W * H).fill(-1);
    var seen = new Uint8Array(W * H);
    var queue = [fromY * W + fromX];
    seen[fromY * W + fromX] = 1;
    var out = [];
    for (var head = 0; head < queue.length; head++) {
      var cur = queue[head];
      var cx = cur % W;
      var cy = (cur / W) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DIRS[d][0];
        var ny = cy + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx + piece.w > W || ny + piece.h > H) continue;
        var idx = ny * W + nx;
        if (seen[idx] || !free[idx]) continue;
        seen[idx] = 1;
        from[idx] = cur;
        queue.push(idx);
        out.push(idx);
      }
    }
    return { cells: out, from: from };
  }

  function tracePath(from, startIdx, endIdx) {
    var path = [];
    var cur = endIdx;
    while (cur !== startIdx && cur !== -1) {
      path.push({ x: cur % W, y: (cur / W) | 0 });
      cur = from[cur];
    }
    path.reverse();
    return path;
  }

  /**
   * Breadth-first search for the shortest solution.
   * Returns { moves, steps, path: [{piece, x, y, cells}] } or null.
   */
  function solve(pieces, options) {
    var opts = options || {};
    var limit = opts.maxNodes || 400000;
    var n = pieces.length;
    var big = bigIndex(pieces);
    if (big < 0) return null;

    var start = new Int8Array(n * 2);
    for (var i = 0; i < n; i++) { start[i * 2] = pieces[i].x; start[i * 2 + 1] = pieces[i].y; }

    var scratch = pieces.map(function (p) { return { x: 0, y: 0, w: p.w, h: p.h }; });
    function keyOf(coords) {
      for (var k = 0; k < n; k++) { scratch[k].x = coords[k * 2]; scratch[k].y = coords[k * 2 + 1]; }
      return encode(scratch);
    }

    if (start[big * 2] === GOAL_X && start[big * 2 + 1] === GOAL_Y) {
      return { moves: 0, steps: 0, path: [] };
    }

    var seen = new Set([keyOf(start)]);
    var posList = [start];
    var parent = [-1];
    var moveList = [null];

    function build(nodeIndex) {
      var path = [];
      var cur = nodeIndex;
      while (cur > 0) { path.push(moveList[cur]); cur = parent[cur]; }
      path.reverse();
      var steps = path.reduce(function (s, m) { return s + m.cells.length; }, 0);
      return { moves: path.length, steps: steps, path: path, explored: posList.length };
    }

    for (var head = 0; head < posList.length; head++) {
      if (posList.length > limit) return null;
      var coords = posList[head];
      for (var pi = 0; pi < n; pi++) {
        var p = pieces[pi];
        var ox = coords[pi * 2];
        var oy = coords[pi * 2 + 1];
        var grid = occupancy(pieces, coords, pi);
        var reach = reachable(grid, p, ox, oy);
        var startIdx = oy * W + ox;
        for (var c = 0; c < reach.cells.length; c++) {
          var destIdx = reach.cells[c];
          var nx = destIdx % W;
          var ny = (destIdx / W) | 0;
          var next = new Int8Array(coords);
          next[pi * 2] = nx;
          next[pi * 2 + 1] = ny;
          var key = keyOf(next);
          if (seen.has(key)) continue;
          seen.add(key);
          posList.push(next);
          parent.push(head);
          moveList.push({ piece: pi, x: nx, y: ny, cells: tracePath(reach.from, startIdx, destIdx) });
          if (pi === big && nx === GOAL_X && ny === GOAL_Y) return build(posList.length - 1);
        }
      }
    }
    return null;
  }

  return {
    W: W,
    H: H,
    GOAL_X: GOAL_X,
    GOAL_Y: GOAL_Y,
    DIRS: DIRS,
    typeChar: typeChar,
    parseLayout: parseLayout,
    validate: validate,
    encode: encode,
    bigIndex: bigIndex,
    isSolved: isSolved,
    occupancy: occupancy,
    reachable: reachable,
    tracePath: tracePath,
    solve: solve
  };
});
