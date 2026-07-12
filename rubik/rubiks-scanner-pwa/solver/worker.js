importScripts('cube.js', 'solve.js');

let initialized = false;

self.onmessage = (event) => {
  const { type, id, cube } = event.data || {};
  try {
    if (type === 'init') {
      if (!initialized) {
        Cube.initSolver();
        initialized = true;
      }
      self.postMessage({ type: 'ready', id });
      return;
    }

    if (type === 'solve') {
      if (!initialized) throw new Error('Solver is not initialized.');
      const instance = new Cube(cube);
      const result = instance.solveOptimal({
        maxDepth: 20,
        reportEvery: 500000,
        onProgress(progress) {
          self.postMessage({ type: 'progress', id, ...progress });
        },
      });
      self.postMessage({ type: 'solution', id, ...result });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || String(error) });
  }
};
