/*
 * Super Slide — game shell, input and presentation.
 *
 * Touch is the primary input. Blocks track the finger directly, with a
 * damped response near each slot centre so they cling and then click past —
 * the closest a screen gets to magnetic detents. Every boundary crossing
 * fires a tick (sound + haptic), and shoving a block into something solid
 * rubber-bands and thuds instead of silently refusing.
 */
(function () {
  'use strict';

  var core = window.SlideCore;
  var levels = window.SlideLevels;
  var feel = window.SlideFeel;

  var W = core.W;
  var H = core.H;
  var STORAGE_KEY = 'superslide.v1';

  /* ------------------------------------------------------------- elements */

  var $ = function (id) { return document.getElementById(id); };
  var tray = $('tray');
  var board = $('board');
  var scrim = $('scrim');
  var toastEl = $('toast');

  /* --------------------------------------------------------------- state */

  var state = {
    levelIndex: 0,
    level: null,
    pieces: [],
    els: [],
    moves: 0,
    history: [],
    startedAt: 0,
    elapsed: 0,
    timer: null,
    won: false,
    cell: 60,
    selected: -1,
    segment: null,
    hint: null,
    busy: false
  };

  var save = load();
  var settings = save.settings;

  function defaults() {
    return {
      v: 1,
      progress: {},
      settings: { sound: true, haptics: true, magnet: true, theme: '' },
      last: null
    };
  }

  function load() {
    var base = defaults();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return base;
      base.progress = parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {};
      base.last = typeof parsed.last === 'string' ? parsed.last : null;
      if (parsed.settings) {
        Object.keys(base.settings).forEach(function (k) {
          if (k in parsed.settings) base.settings[k] = parsed.settings[k];
        });
      }
    } catch (err) { /* corrupt or unavailable storage falls back to defaults */ }
    return base;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(save)); } catch (err) { /* private mode */ }
  }

  /* -------------------------------------------------------------- helpers */

  function kindOf(p) {
    if (p.w === 2 && p.h === 2) return 'big';
    if (p.w === 2) return 'horz';
    if (p.h === 2) return 'vert';
    return 'unit';
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * 1.35) + 1) return 2;
    return 1;
  }

  var STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45l-5.81 3.05 1.11-6.47L2.6 9.45l6.5-.95z"/></svg>';

  function starRow(count, total) {
    var out = '';
    for (var i = 0; i < (total || 3); i++) {
      out += STAR_SVG.replace('<svg', '<svg class="' + (i < count ? 'star-on' : 'star-off') + '"');
    }
    return out;
  }

  var toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  /* ------------------------------------------------------------ occupancy */

  function occupancyGrid(skipIndex) {
    var grid = new Int8Array(W * H).fill(-1);
    for (var i = 0; i < state.pieces.length; i++) {
      if (i === skipIndex) continue;
      var p = state.pieces[i];
      for (var y = p.y; y < p.y + p.h; y++) {
        for (var x = p.x; x < p.x + p.w; x++) grid[y * W + x] = i;
      }
    }
    return grid;
  }

  function canMove(index, dx, dy) {
    var p = state.pieces[index];
    var nx = p.x + dx;
    var ny = p.y + dy;
    if (nx < 0 || ny < 0 || nx + p.w > W || ny + p.h > H) return false;
    var grid = occupancyGrid(index);
    for (var y = ny; y < ny + p.h; y++) {
      for (var x = nx; x < nx + p.w; x++) {
        if (grid[y * W + x] !== -1) return false;
      }
    }
    return true;
  }

  /* -------------------------------------------------------------- layout */

  function relayout() {
    var stage = document.querySelector('.stage');
    var rect = stage.getBoundingClientRect();
    var avail = { w: rect.width, h: rect.height };
    if (avail.w < 40 || avail.h < 40) return;

    var rough = Math.min((avail.w - 22) / W, (avail.h - 22) / H);
    var pad = clamp(Math.round(rough * 0.16), 8, 16);
    var cell = Math.floor(Math.min((avail.w - pad * 2 - 2) / W, (avail.h - pad * 2 - 2) / H));
    cell = clamp(cell, 34, 126);

    state.cell = cell;
    tray.style.setProperty('--cell', cell + 'px');
    tray.style.setProperty('--pad', pad + 'px');
  }

  /* ------------------------------------------------------------ rendering */

  function renderLevel() {
    board.innerHTML = '';
    state.els = state.pieces.map(function (p, i) {
      var el = document.createElement('div');
      el.className = 'piece';
      el.dataset.index = String(i);
      el.dataset.kind = kindOf(p);
      el.style.setProperty('--w', p.w);
      el.style.setProperty('--h', p.h);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', ariaFor(p));
      var face = document.createElement('div');
      face.className = 'face';
      el.appendChild(face);
      board.appendChild(el);
      return el;
    });
    syncPositions();
  }

  function ariaFor(p) {
    var kind = kindOf(p);
    var name = kind === 'big' ? 'Big block' : kind === 'unit' ? 'Small block' : 'Long block';
    return name + ' at column ' + (p.x + 1) + ', row ' + (p.y + 1);
  }

  function syncPositions() {
    for (var i = 0; i < state.pieces.length; i++) {
      var p = state.pieces[i];
      var el = state.els[i];
      el.style.setProperty('--px', p.x);
      el.style.setProperty('--py', p.y);
      el.style.setProperty('--dx', '0px');
      el.style.setProperty('--dy', '0px');
      el.setAttribute('aria-label', ariaFor(p));
    }
    updateGate();
  }

  // The gate lights up once the big block only has to drop straight out.
  function updateGate() {
    var bi = core.bigIndex(state.pieces);
    if (bi < 0) return;
    var p = state.pieces[bi];
    var armed = p.x === core.GOAL_X && p.y >= core.GOAL_Y - 1;
    tray.classList.toggle('armed', armed && !state.won);
  }

  function updateHud() {
    $('stat-moves').textContent = state.moves;
    $('stat-par').textContent = state.level.par;
    $('stat-time').textContent = formatTime(currentElapsed());

    var record = save.progress[state.level.id];
    $('stat-best').textContent = record && record.moves ? record.moves : '—';
    $('stat-moves-wrap').classList.toggle('over', state.moves > state.level.par);
    $('btn-undo').disabled = state.history.length === 0 || state.won;
  }

  function pulseMoves() {
    var wrap = $('stat-moves-wrap');
    wrap.classList.remove('pulse');
    void wrap.offsetWidth;
    wrap.classList.add('pulse');
    setTimeout(function () { wrap.classList.remove('pulse'); }, 200);
  }

  /* --------------------------------------------------------------- timer */

  function currentElapsed() {
    return state.elapsed + (state.startedAt ? Date.now() - state.startedAt : 0);
  }

  function startTimer() {
    if (state.startedAt || state.won) return;
    state.startedAt = Date.now();
    state.timer = setInterval(function () {
      $('stat-time').textContent = formatTime(currentElapsed());
    }, 250);
  }

  function stopTimer() {
    if (state.startedAt) {
      state.elapsed += Date.now() - state.startedAt;
      state.startedAt = 0;
    }
    clearInterval(state.timer);
    state.timer = null;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopTimer();
    else if (state.moves > 0 && !state.won) startTimer();
  });

  /* ------------------------------------------------------ moves & history */

  /**
   * A move is one continuous interaction with one block. Steps keep extending
   * the open segment — including around corners — until the gesture ends or a
   * different block is touched, which matches how par was computed.
   */
  function beginSegment(index) {
    if (state.segment && state.segment.index === index) return;
    endSegment();
    state.segment = { index: index, counted: false, fromX: state.pieces[index].x, fromY: state.pieces[index].y };
  }

  /**
   * Close the open segment. A block nudged around and left exactly where it
   * started is not a move — refund it, so exploring costs nothing.
   */
  function endSegment() {
    var seg = state.segment;
    state.segment = null;
    if (!seg || !seg.counted) return;
    var p = state.pieces[seg.index];
    if (p.x === seg.fromX && p.y === seg.fromY) {
      state.history.pop();
      state.moves = Math.max(0, state.moves - 1);
    }
  }

  /** Drop the open segment without the refund pass (undo and level loads). */
  function clearSegment() { state.segment = null; }

  function applyStep(index, dx, dy) {
    var p = state.pieces[index];
    var seg = state.segment;
    if (!seg || seg.index !== index) beginSegment(index);
    seg = state.segment;

    if (!seg.counted) {
      state.history.push({ index: index, x: seg.fromX, y: seg.fromY });
      state.moves++;
      seg.counted = true;
      startTimer();
      pulseMoves();
    }

    p.x += dx;
    p.y += dy;
    var el = state.els[index];
    el.style.setProperty('--px', p.x);
    el.style.setProperty('--py', p.y);
    clearHint();
    updateGate();
  }

  function undo() {
    if (!state.history.length || state.won) return;
    clearSegment();
    var entry = state.history.pop();
    var p = state.pieces[entry.index];
    p.x = entry.x;
    p.y = entry.y;
    state.moves = Math.max(0, state.moves - 1);
    clearHint();
    var el = state.els[entry.index];
    el.classList.add('settling');
    syncPositions();
    setTimeout(function () { el.classList.remove('settling'); }, 340);
    feel.play('undo');
    updateHud();
  }

  function resetLevel(silent) {
    loadLevel(state.levelIndex, true);
    if (!silent) feel.play('reset');
  }

  /* --------------------------------------------------------------- input */

  var drag = null;

  function selectPiece(index) {
    if (state.selected === index) return;
    if (state.selected >= 0 && state.els[state.selected]) state.els[state.selected].classList.remove('selected');
    state.selected = index;
    if (index >= 0 && state.els[index]) state.els[index].classList.add('selected');
  }

  /** Shape the leftover sub-cell distance so blocks cling to slot centres. */
  function detent(index, residual, axis) {
    var dir = residual > 0 ? 1 : residual < 0 ? -1 : 0;
    if (!dir) return 0;
    var open = canMove(index, axis === 'x' ? dir : 0, axis === 'y' ? dir : 0);
    var mag = Math.abs(residual);
    if (!open) {
      // Pushing into something solid: heavy resistance, small give.
      return dir * 0.17 * Math.tanh(mag / 0.34);
    }
    var c = Math.min(mag, 0.5);
    if (!settings.magnet) return dir * c;
    // Slow near the centre, full speed at the boundary. Continuous across the
    // hand-off, so the block never visibly detaches from the finger.
    var t = c / 0.5;
    return dir * c * (0.55 + 0.45 * t * t);
  }

  function stepToward(index, fx, fy) {
    var steps = 0;
    var blocked = false;
    for (var guard = 0; guard < 24; guard++) {
      var p = state.pieces[index];
      var rx = fx - p.x;
      var ry = fy - p.y;
      var wantX = rx > 0.5 ? 1 : rx < -0.5 ? -1 : 0;
      var wantY = ry > 0.5 ? 1 : ry < -0.5 ? -1 : 0;
      if (!wantX && !wantY) break;

      var order = Math.abs(rx) >= Math.abs(ry)
        ? [[wantX, 0], [0, wantY]]
        : [[0, wantY], [wantX, 0]];

      var moved = false;
      for (var i = 0; i < order.length; i++) {
        var sx = order[i][0];
        var sy = order[i][1];
        if ((sx || sy) && canMove(index, sx, sy)) { applyStep(index, sx, sy); steps++; moved = true; break; }
      }
      if (!moved) { blocked = true; break; }
    }
    return { steps: steps, blocked: blocked };
  }

  function onPointerDown(event) {
    if (state.won || state.busy) return;
    var el = event.target.closest ? event.target.closest('.piece') : null;
    if (!el) { selectPiece(-1); return; }
    if (drag) return;

    var index = Number(el.dataset.index);
    event.preventDefault();

    drag = {
      index: index,
      el: el,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.pieces[index].x,
      originY: state.pieces[index].y,
      travelled: 0,
      bumped: false
    };

    try { el.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    el.classList.add('dragging');
    selectPiece(index);
    beginSegment(index);
    feel.play('grab');
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();

    var cell = state.cell;
    var fx = drag.originX + (event.clientX - drag.startX) / cell;
    var fy = drag.originY + (event.clientY - drag.startY) / cell;

    var result = stepToward(drag.index, fx, fy);
    if (result.steps > 0) {
      drag.travelled += result.steps;
      drag.bumped = false;
      var p = state.pieces[drag.index];
      feel.play('tick', p.w * p.h);
      seat(drag.el);
      updateHud();
      if (core.isSolved(state.pieces)) { finishDrag(); onSolved(); return; }
    }

    var piece = state.pieces[drag.index];
    var rx = fx - piece.x;
    var ry = fy - piece.y;
    var ox = detent(drag.index, rx, 'x');
    var oy = detent(drag.index, ry, 'y');

    // One thud per shove, so leaning on a wall does not machine-gun.
    if (result.blocked && !drag.bumped && (Math.abs(rx) > 0.72 || Math.abs(ry) > 0.72)) {
      drag.bumped = true;
      feel.play('bump');
      drag.el.classList.add('blocked');
      setTimeout(function () { drag && drag.el.classList.remove('blocked'); }, 140);
    }

    drag.el.style.setProperty('--dx', (ox * cell).toFixed(2) + 'px');
    drag.el.style.setProperty('--dy', (oy * cell).toFixed(2) + 'px');
  }

  function seat(el) {
    el.classList.remove('seated');
    void el.offsetWidth;
    el.classList.add('seated');
  }

  function finishDrag() {
    if (!drag) return;
    var el = drag.el;
    var travelled = drag.travelled;
    var index = drag.index;
    try { el.releasePointerCapture(drag.pointerId); } catch (err) { /* ignore */ }
    el.classList.remove('dragging');
    el.classList.add('settling');
    el.style.setProperty('--dx', '0px');
    el.style.setProperty('--dy', '0px');
    setTimeout(function () { el.classList.remove('settling'); }, 340);
    drag = null;

    if (travelled > 0) {
      var p = state.pieces[index];
      feel.play('place', p.w * p.h);
      seat(el);
    } else {
      feel.play('tap');
    }
    endSegment();
    updateHud();
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    finishDrag();
    if (!state.won && core.isSolved(state.pieces)) onSolved();
  }

  tray.addEventListener('pointerdown', onPointerDown);
  tray.addEventListener('pointermove', onPointerMove, { passive: false });
  tray.addEventListener('pointerup', onPointerUp);
  tray.addEventListener('pointercancel', onPointerUp);
  tray.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ------------------------------------------------------------- keyboard */

  var ARROWS = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0]
  };

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var openSheet = document.querySelector('.sheet.open');

    if (event.key === 'Escape' && openSheet) { closeSheets(); return; }
    if (openSheet) return;

    if (event.key === 'u' || event.key === 'U') { undo(); return; }
    if (event.key === 'r' || event.key === 'R') { resetLevel(); return; }
    if (event.key === 'h' || event.key === 'H') { requestHint(); return; }

    var dir = ARROWS[event.key];
    if (!dir || state.won) return;
    event.preventDefault();

    var index = state.selected;
    if (index < 0) { index = core.bigIndex(state.pieces); selectPiece(index); }
    if (index < 0) return;

    beginSegment(index);
    if (canMove(index, dir[0], dir[1])) {
      applyStep(index, dir[0], dir[1]);
      var p = state.pieces[index];
      feel.play('tick', p.w * p.h);
      seat(state.els[index]);
      updateHud();
      if (core.isSolved(state.pieces)) onSolved();
    } else {
      feel.play('bump');
      var el = state.els[index];
      el.classList.add('blocked');
      setTimeout(function () { el.classList.remove('blocked'); }, 140);
    }
  });

  board.addEventListener('focusin', function (event) {
    var el = event.target.closest('.piece');
    if (el) selectPiece(Number(el.dataset.index));
  });

  /* ----------------------------------------------------------------- hint */

  var worker = null;
  var hintToken = 0;

  function getWorker() {
    if (worker !== null) return worker;
    try {
      worker = new Worker('/slide/js/solver-worker.js');
      worker.onmessage = onHintResult;
      worker.onerror = function () { worker = false; };
    } catch (err) {
      worker = false;
    }
    return worker;
  }

  function clearHint() {
    if (!state.hint) return;
    if (state.hint.ghost && state.hint.ghost.parentNode) state.hint.ghost.parentNode.removeChild(state.hint.ghost);
    if (state.els[state.hint.index]) state.els[state.hint.index].classList.remove('hinted');
    state.hint = null;
  }

  function requestHint() {
    if (state.won || state.busy) return;

    // Second press while a hint is showing plays it out.
    if (state.hint) { playHint(); return; }

    var btn = $('btn-hint');
    btn.classList.add('busy');
    btn.disabled = true;
    hintToken++;

    var payload = state.pieces.map(function (p) { return { x: p.x, y: p.y, w: p.w, h: p.h }; });
    var w = getWorker();
    if (w) {
      w.postMessage({ type: 'solve', token: hintToken, pieces: payload });
    } else {
      // No worker available: solve inline and accept the pause.
      var token = hintToken;
      setTimeout(function () {
        var solution = core.solve(payload, { maxNodes: 300000 });
        onHintResult({ data: { token: token, solution: solution } });
      }, 30);
    }
  }

  function onHintResult(event) {
    var data = event.data || {};
    if (data.token !== hintToken) return;

    var btn = $('btn-hint');
    btn.classList.remove('busy');
    btn.disabled = false;

    var solution = data.solution;
    if (!solution || !solution.path || !solution.path.length) {
      toast(solution ? 'Already solved!' : 'No way out from here — undo a few moves.');
      return;
    }

    var move = solution.path[0];
    var piece = state.pieces[move.piece];
    if (!piece) return;

    var ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.setProperty('--w', piece.w);
    ghost.style.setProperty('--h', piece.h);
    ghost.style.setProperty('--px', move.x);
    ghost.style.setProperty('--py', move.y);
    board.appendChild(ghost);
    state.els[move.piece].classList.add('hinted');

    state.hint = { index: move.piece, move: move, ghost: ghost, remaining: solution.moves };
    feel.play('hint');
    toast(solution.moves + (solution.moves === 1 ? ' move left' : ' moves to go') + ' — tap Hint again to play it');
  }

  /** Walk the hinted block along its path, one cell at a time. */
  function playHint() {
    if (!state.hint || state.busy) return;
    var move = state.hint.move;
    var index = state.hint.index;
    var cells = move.cells.slice();
    clearHint();

    state.busy = true;
    selectPiece(index);
    beginSegment(index);
    var el = state.els[index];
    el.classList.add('settling');

    var i = 0;
    (function stepOnce() {
      if (i >= cells.length) {
        el.classList.remove('settling');
        endSegment();
        state.busy = false;
        var p = state.pieces[index];
        feel.play('place', p.w * p.h);
        seat(el);
        updateHud();
        if (core.isSolved(state.pieces)) onSolved();
        return;
      }
      var target = cells[i++];
      var piece = state.pieces[index];
      applyStep(index, target.x - piece.x, target.y - piece.y);
      feel.play('tick', piece.w * piece.h);
      seat(el);
      updateHud();
      setTimeout(stepOnce, 130);
    })();
  }

  /* ------------------------------------------------------------------ win */

  function onSolved() {
    if (state.won) return;
    state.won = true;
    stopTimer();
    endSegment();
    clearHint();
    selectPiece(-1);
    updateHud();

    var elapsed = currentElapsed();
    var stars = starsFor(state.moves, state.level.par);
    var id = state.level.id;
    var record = save.progress[id] || {};
    var isBest = !record.moves || state.moves < record.moves;

    save.progress[id] = {
      solved: true,
      moves: isBest ? state.moves : record.moves,
      time: isBest || !record.time ? elapsed : Math.min(record.time, elapsed),
      stars: Math.max(stars, record.stars || 0)
    };
    persist();

    tray.classList.remove('armed');
    tray.classList.add('won');

    var bigEl = state.els[core.bigIndex(state.pieces)];
    bigEl.classList.remove('settling');
    bigEl.classList.add('escaping');
    feel.play('escape');

    setTimeout(function () {
      feel.play('win');
      confetti(stars);
      showWin(stars, elapsed, isBest);
    }, 560);
  }

  function showWin(stars, elapsed, isBest) {
    $('win-stars').innerHTML = starRow(stars);
    $('win-title').textContent = stars === 3 ? 'Perfect!' : stars === 2 ? 'Solved' : 'Got it';
    $('win-sub').textContent = state.moves <= state.level.par
      ? 'You matched par.'
      : (state.moves - state.level.par) + ' over par — a tighter line exists.';
    $('win-moves').textContent = state.moves;
    $('win-par').textContent = state.level.par;
    $('win-time').textContent = formatTime(elapsed);
    $('win-time-wrap').classList.toggle('best', !!isBest);
    $('btn-next').textContent = state.levelIndex < levels.length - 1 ? 'Next level' : 'Back to levels';
    openSheet('sheet-win');
    renderLevelGrid();
  }

  var CONFETTI_COLORS = ['#ff7a52', '#ffcf5c', '#4be0a8', '#7b8bff', '#3fd6c8', '#e23b32'];

  function confetti(stars) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var host = $('confetti');
    host.innerHTML = '';
    var count = 26 + stars * 12;
    for (var i = 0; i < count; i++) {
      var bit = document.createElement('i');
      bit.style.left = (Math.random() * 100) + 'vw';
      bit.style.top = (-8 - Math.random() * 20) + 'vh';
      bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      bit.style.setProperty('--drift', (Math.random() * 180 - 90) + 'px');
      bit.style.setProperty('--spin', (Math.random() * 900 - 450) + 'deg');
      bit.style.animationDuration = (1.5 + Math.random() * 1.4) + 's';
      bit.style.animationDelay = (Math.random() * 0.35) + 's';
      host.appendChild(bit);
    }
    setTimeout(function () { host.innerHTML = ''; }, 3600);
  }

  /* --------------------------------------------------------------- levels */

  function loadLevel(index, keepScroll) {
    index = clamp(index, 0, levels.length - 1);
    var level = levels[index];

    state.levelIndex = index;
    state.level = level;
    state.pieces = core.parseLayout(level.rows).map(function (p) {
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    });
    state.moves = 0;
    state.history = [];
    state.elapsed = 0;
    state.startedAt = 0;
    state.won = false;
    state.selected = -1;
    state.busy = false;
    clearSegment();
    clearHint();
    clearInterval(state.timer);
    state.timer = null;
    drag = null;

    tray.classList.remove('won', 'armed');
    $('level-name').textContent = level.name;
    var record = save.progress[level.id];
    $('level-meta').textContent = 'Level ' + (index + 1) + ' of ' + levels.length +
      (level.classic ? ' · The classic' : '') +
      (record && record.stars ? ' · ' + record.stars + '★' : '');

    save.last = level.id;
    persist();

    renderLevel();
    relayout();
    updateHud();
    if (!keepScroll) renderLevelGrid();
  }

  function renderLevelGrid() {
    var grid = $('level-grid');
    var solvedCount = 0;
    var starTotal = 0;
    var html = levels.map(function (level, i) {
      var record = save.progress[level.id];
      if (record && record.solved) { solvedCount++; starTotal += record.stars || 0; }
      var classes = ['level-card'];
      if (i === state.levelIndex) classes.push('current');
      if (record && record.solved) classes.push('done');
      return '<button class="' + classes.join(' ') + '" data-index="' + i + '">' +
        '<span class="num">' + String(i + 1).padStart(2, '0') + (level.classic ? ' · CLASSIC' : '') + '</span>' +
        '<span class="nm">' + level.name + '</span>' +
        '<span class="meta">' + (record && record.moves ? record.moves + '/' + level.par + ' ' : 'par ' + level.par + ' ') +
        '<span class="stars">' + (record && record.solved ? starRow(record.stars || 1) : '') + '</span></span>' +
        '</button>';
    }).join('');
    grid.innerHTML = html;
    $('levels-progress').textContent = solvedCount + ' of ' + levels.length + ' solved · ' +
      starTotal + ' of ' + (levels.length * 3) + ' stars';
  }

  $('level-grid').addEventListener('click', function (event) {
    var card = event.target.closest('.level-card');
    if (!card) return;
    closeSheets();
    loadLevel(Number(card.dataset.index));
    feel.play('tap');
  });

  /* --------------------------------------------------------------- sheets */

  function openSheet(id) {
    closeSheets(true);
    var sheet = $(id);
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
    scrim.classList.add('open');
  }

  function closeSheets(keepScrim) {
    Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (sheet) {
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden', 'true');
    });
    if (!keepScrim) scrim.classList.remove('open');
  }

  scrim.addEventListener('click', function () { closeSheets(); });

  $('btn-levels').addEventListener('click', function () { renderLevelGrid(); openSheet('sheet-levels'); feel.play('tap'); });
  $('btn-settings').addEventListener('click', function () { openSheet('sheet-settings'); feel.play('tap'); });
  $('btn-undo').addEventListener('click', undo);
  $('btn-reset').addEventListener('click', function () { resetLevel(); });
  $('btn-hint').addEventListener('click', requestHint);
  $('btn-replay').addEventListener('click', function () { closeSheets(); resetLevel(true); feel.play('tap'); });
  $('btn-next').addEventListener('click', function () {
    closeSheets();
    if (state.levelIndex < levels.length - 1) loadLevel(state.levelIndex + 1);
    else { renderLevelGrid(); openSheet('sheet-levels'); }
    feel.play('tap');
  });

  // Swipe a sheet down to dismiss it.
  Array.prototype.forEach.call(document.querySelectorAll('.sheet'), function (sheet) {
    var startY = 0;
    var dragging = false;
    sheet.addEventListener('pointerdown', function (event) {
      if (!event.target.closest('.grabber') && !event.target.closest('h2')) return;
      dragging = true;
      startY = event.clientY;
      sheet.style.transition = 'none';
    });
    sheet.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var dy = Math.max(0, event.clientY - startY);
      sheet.style.transform = 'translateY(' + dy + 'px)';
    });
    var release = function (event) {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      sheet.style.transform = '';
      var travel = event.clientY - startY;
      // Flick it down, or just tap the grabber.
      if (travel > 70 || (Math.abs(travel) < 6 && event.target.closest('.grabber'))) closeSheets();
    };
    sheet.addEventListener('pointerup', release);
    sheet.addEventListener('pointercancel', release);
  });

  /* ------------------------------------------------------------- settings */

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme || '');
    Array.prototype.forEach.call($('opt-theme').children, function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.theme === (settings.theme || '')));
    });
  }

  function bindSwitch(id, key, onChange) {
    var el = $(id);
    el.setAttribute('aria-checked', String(!!settings[key]));
    el.addEventListener('click', function () {
      settings[key] = !settings[key];
      el.setAttribute('aria-checked', String(settings[key]));
      persist();
      if (onChange) onChange(settings[key]);
      feel.play('tap');
    });
  }

  bindSwitch('opt-sound', 'sound', function (on) { feel.setSound(on); });
  bindSwitch('opt-haptics', 'haptics', function (on) { feel.setHaptics(on); if (on) feel.haptic('medium'); });
  bindSwitch('opt-magnet', 'magnet');

  $('opt-theme').addEventListener('click', function (event) {
    var btn = event.target.closest('button');
    if (!btn) return;
    settings.theme = btn.dataset.theme;
    persist();
    applyTheme();
    feel.play('tap');
  });

  $('opt-wipe').addEventListener('click', function () {
    save.progress = {};
    persist();
    renderLevelGrid();
    updateHud();
    loadLevel(state.levelIndex, true);
    toast('Progress erased');
  });

  var HAPTIC_COPY = {
    full: 'Your device supports vibration — every detent is felt.',
    ios: 'iOS has no web vibration API. Using the system switch tap as a stand-in, so it may be subtle or silent.',
    none: 'This browser exposes no haptics, so feedback is sound and motion only.'
  };
  $('haptics-hint').textContent = HAPTIC_COPY[feel.capability()];

  /* -------------------------------------------------------------- install */

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    $('btn-install').style.display = '';
  });

  $('btn-install').addEventListener('click', function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      $('btn-install').style.display = 'none';
    });
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    $('btn-install').style.display = 'none';
    toast('Installed — it works offline now');
  });

  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !isStandalone) $('install-note').style.display = '';

  /* ----------------------------------------------------------------- boot */

  feel.init(settings);
  applyTheme();

  var startIndex = 0;
  if (save.last) {
    var found = levels.findIndex(function (l) { return l.id === save.last; });
    if (found >= 0) startIndex = found;
  }
  loadLevel(startIndex);

  // Manifest shortcut: /slide/?screen=levels opens straight to the picker.
  try {
    if (new URLSearchParams(location.search).get('screen') === 'levels') {
      renderLevelGrid();
      openSheet('sheet-levels');
    }
  } catch (err) { /* no URLSearchParams support is harmless */ }

  var resizeTimer = null;
  function scheduleRelayout() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 60);
  }
  window.addEventListener('resize', scheduleRelayout);
  window.addEventListener('orientationchange', scheduleRelayout);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(document.querySelector('.stage'));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleRelayout);

  // Absolute paths throughout: the host may serve this page as /slide or
  // /slide/, and relative URLs resolve against the site root in the first case.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/slide/sw.js', { scope: '/slide/' })
        .catch(function () { /* offline support is optional */ });
    });
  }
})();
