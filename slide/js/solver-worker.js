/*
 * Solve off the main thread. The hardest boards explore ~40k states, which is
 * well over a frame budget on a phone, so hints never block the drag loop.
 */
/* global importScripts, SlideCore */
importScripts('solver.js');

self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'solve') return;
  var result = null;
  try {
    result = SlideCore.solve(data.pieces, { maxNodes: 300000 });
  } catch (err) {
    result = null;
  }
  self.postMessage({
    type: 'solved',
    token: data.token,
    solution: result ? { moves: result.moves, steps: result.steps, path: result.path } : null
  });
};
