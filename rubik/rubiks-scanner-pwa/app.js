'use strict';

const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const FACE_META = {
  U: { name: 'Up', colorName: 'White', colorCode: 'W', topFace: 'B', fallback: '#f5f7ff' },
  R: { name: 'Right', colorName: 'Red', colorCode: 'R', topFace: 'U', fallback: '#ef3f58' },
  F: { name: 'Front', colorName: 'Green', colorCode: 'G', topFace: 'U', fallback: '#39b86b' },
  D: { name: 'Down', colorName: 'Yellow', colorCode: 'Y', topFace: 'F', fallback: '#ffd43b' },
  L: { name: 'Left', colorName: 'Orange', colorCode: 'O', topFace: 'U', fallback: '#ff8b2c' },
  B: { name: 'Back', colorName: 'Blue', colorCode: 'B', topFace: 'U', fallback: '#377cf5' },
};
const STORAGE_KEY = 'cubescan-state-v1';

const state = {
  faces: Object.fromEntries(FACE_ORDER.map((face) => [face, null])),
  currentFaceIndex: 0,
  selectedSticker: null,
  stream: null,
  track: null,
  torchOn: false,
  rescanSingle: false,
  solution: [],
  solutionIndex: 0,
  solutionMeta: null,
  solving: false,
  solveCancelled: false,
};

const dom = {};
let deferredInstallPrompt = null;
let toastTimer = null;
let solverWorker = null;
let wakeLock = null;
let solverReadyResolve;
let solverReadyReject;
let solverReady = new Promise((resolve, reject) => {
  solverReadyResolve = resolve;
  solverReadyReject = reject;
});

function resetSolverReadyPromise() {
  solverReady = new Promise((resolve, reject) => {
    solverReadyResolve = resolve;
    solverReadyReject = reject;
  });
}
let workerRequestId = 0;
const workerRequests = new Map();

window.addEventListener('DOMContentLoaded', init);

function init() {
  cacheDom();
  bindEvents();
  loadSavedState();
  initSolverWorker();
  initInstallHandling();
  registerServiceWorker();
  renderHomeState();
  renderMoveNet();
  showView('homeView');
}

function cacheDom() {
  const ids = [
    'homeButton', 'installButton', 'homeView', 'scanView', 'reviewView', 'solveView',
    'startButton', 'resumeButton', 'solverStatus', 'scanProgress', 'scanTitle',
    'orientationText', 'faceBadge', 'cameraStage', 'camera', 'captureCanvas', 'scanGrid',
    'cameraMessage', 'torchButton', 'backFaceButton', 'captureButton', 'skipToReviewButton',
    'cubeNet', 'selectedStickerText', 'colorPalette', 'colorCounts', 'validationBox',
    'solveProgress', 'solveProgressTitle', 'solveProgressDetail', 'solveButton',
    'cancelSolveButton', 'rescanButton', 'clearButton', 'moveCounter', 'optimalProof', 'solvedMessage',
    'solutionPlayer', 'moveNet', 'turnArrow', 'doubleBadge', 'movePosition', 'moveNotation',
    'moveInstruction', 'previousMoveButton', 'nextMoveButton', 'algorithmText',
    'newScanButton', 'toast'
  ];
  ids.forEach((id) => { dom[id] = document.getElementById(id); });
}

function bindEvents() {
  dom.startButton.addEventListener('click', () => beginScan(firstMissingFaceIndex()));
  dom.resumeButton.addEventListener('click', resumeSavedScan);
  dom.homeButton.addEventListener('click', goHome);
  document.querySelector('.brand').addEventListener('click', (event) => {
    event.preventDefault();
    goHome();
  });
  dom.captureButton.addEventListener('click', captureCurrentFace);
  dom.backFaceButton.addEventListener('click', previousFace);
  dom.skipToReviewButton.addEventListener('click', openReview);
  dom.torchButton.addEventListener('click', toggleTorch);
  dom.solveButton.addEventListener('click', solveCube);
  dom.cancelSolveButton.addEventListener('click', cancelOptimalSearch);
  dom.rescanButton.addEventListener('click', rescanSelectedFace);
  dom.clearButton.addEventListener('click', clearScan);
  dom.previousMoveButton.addEventListener('click', () => setSolutionStep(state.solutionIndex - 1));
  dom.nextMoveButton.addEventListener('click', nextSolutionStep);
  dom.newScanButton.addEventListener('click', clearScan);
  window.addEventListener('resize', positionCameraShades);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && dom.scanView.classList.contains('active')) stopCamera();
    if (!document.hidden && state.solving) acquireWakeLock();
  });
}

function showView(id) {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === id));
  dom.homeButton.classList.toggle('hidden', id === 'homeView');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function goHome() {
  if (state.solving) {
    showToast('Cancel the optimal search before leaving this screen.');
    return;
  }
  stopCamera();
  renderHomeState();
  showView('homeView');
}

function renderHomeState() {
  const captured = FACE_ORDER.filter((face) => state.faces[face]?.samples?.length === 9).length;
  dom.resumeButton.classList.toggle('hidden', captured === 0);
  dom.resumeButton.textContent = captured === 6 ? 'Review saved scan' : `Resume scan (${captured}/6)`;
}

function resumeSavedScan() {
  const captured = FACE_ORDER.filter((face) => state.faces[face]?.samples?.length === 9).length;
  if (captured === 6) openReview();
  else beginScan(firstMissingFaceIndex());
}

function firstMissingFaceIndex() {
  const index = FACE_ORDER.findIndex((face) => !state.faces[face]?.samples?.length);
  return index === -1 ? 0 : index;
}

async function beginScan(faceIndex = 0, singleFace = false) {
  if (state.solving) {
    showToast('Cancel the optimal search before rescanning.');
    return;
  }
  state.currentFaceIndex = Math.max(0, Math.min(5, faceIndex));
  state.rescanSingle = singleFace;
  updateScanHeader();
  showView('scanView');
  await startCamera();
}

function updateScanHeader() {
  const face = FACE_ORDER[state.currentFaceIndex];
  const meta = FACE_META[face];
  const topColor = FACE_META[meta.topFace].colorName;
  const colorName = meta.colorName.toLowerCase();

  dom.scanProgress.textContent = state.rescanSingle
    ? `Rescanning ${meta.colorName} face`
    : `Face ${state.currentFaceIndex + 1} of 6`;
  dom.scanTitle.textContent = `Scan the ${colorName} face`;
  dom.orientationText.textContent = `Keep the ${topColor.toLowerCase()} center at the top edge.`;
  dom.faceBadge.textContent = meta.colorCode;
  dom.faceBadge.style.background = meta.fallback;
  dom.faceBadge.style.color = face === 'U' || face === 'D' ? '#111522' : '#ffffff';
  dom.captureButton.setAttribute('aria-label', `Capture ${colorName} face`);
  dom.backFaceButton.disabled = state.currentFaceIndex === 0 || state.rescanSingle;
  dom.backFaceButton.classList.toggle('hidden', state.rescanSingle);
  dom.skipToReviewButton.classList.toggle('hidden', !allFacesCaptured() || state.rescanSingle);
}

async function startCamera() {
  stopCamera();
  dom.cameraMessage.classList.add('hidden');
  dom.captureButton.disabled = true;

  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    showCameraError('The camera requires HTTPS. Host this folder on an HTTPS site or open it through localhost.');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraError('This browser does not expose the camera API. Try Safari, Chrome, or Edge on a phone.');
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    dom.camera.srcObject = state.stream;
    await dom.camera.play();
    state.track = state.stream.getVideoTracks()[0] || null;
    dom.captureButton.disabled = false;
    updateTorchAvailability();
    requestAnimationFrame(positionCameraShades);
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    showCameraError(denied
      ? 'Camera access was denied. Allow camera access in your browser settings, then open the scanner again.'
      : `The camera could not start: ${error?.message || error}`);
  }
}

function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
  state.track = null;
  state.torchOn = false;
  dom.torchButton.classList.add('hidden');
  dom.torchButton.classList.remove('active');
  dom.camera.srcObject = null;
}

function showCameraError(message) {
  dom.cameraMessage.textContent = message;
  dom.cameraMessage.classList.remove('hidden');
  dom.captureButton.disabled = true;
}

function updateTorchAvailability() {
  try {
    const capabilities = state.track?.getCapabilities?.();
    dom.torchButton.classList.toggle('hidden', !capabilities?.torch);
  } catch {
    dom.torchButton.classList.add('hidden');
  }
}

async function toggleTorch() {
  if (!state.track) return;
  try {
    state.torchOn = !state.torchOn;
    await state.track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
    dom.torchButton.classList.toggle('active', state.torchOn);
  } catch {
    state.torchOn = false;
    dom.torchButton.classList.remove('active');
    showToast('Flashlight control is unavailable on this camera.');
  }
}

function positionCameraShades() {
  if (!dom.scanView.classList.contains('active')) return;
  const stage = dom.cameraStage.getBoundingClientRect();
  const grid = dom.scanGrid.getBoundingClientRect();
  const top = Math.max(0, grid.top - stage.top);
  const bottom = Math.max(0, stage.bottom - grid.bottom);
  const left = Math.max(0, grid.left - stage.left);
  const right = Math.max(0, stage.right - grid.right);
  const [shadeTop, shadeBottom, shadeLeft, shadeRight] = document.querySelectorAll('.camera-shade');
  Object.assign(shadeTop.style, { top: '0', left: '0', right: '0', height: `${top}px` });
  Object.assign(shadeBottom.style, { bottom: '0', left: '0', right: '0', height: `${bottom}px` });
  Object.assign(shadeLeft.style, { top: `${top}px`, bottom: `${bottom}px`, left: '0', width: `${left}px` });
  Object.assign(shadeRight.style, { top: `${top}px`, bottom: `${bottom}px`, right: '0', width: `${right}px` });
}

function captureCurrentFace() {
  if (!state.stream || dom.camera.readyState < 2) {
    showToast('The camera is not ready yet.');
    return;
  }

  try {
    const samples = sampleStickerGrid();
    const averageLuma = samples.reduce((sum, color) => sum + relativeLuminance(color), 0) / 9;
    if (averageLuma < 0.025) {
      showToast('The image is too dark. Add more light or use the flashlight.');
      return;
    }

    const face = FACE_ORDER[state.currentFaceIndex];
    state.faces[face] = { samples, labels: null, confidence: null };
    saveState();
    flashCapture();

    if (state.rescanSingle) {
      classifyAllStickers();
      stopCamera();
      openReview();
      return;
    }

    if (state.currentFaceIndex === 5) {
      classifyAllStickers();
      stopCamera();
      openReview();
    } else {
      state.currentFaceIndex += 1;
      updateScanHeader();
      showToast(`${FACE_META[face].colorName} face captured.`);
    }
  } catch (error) {
    showToast(error?.message || 'Could not sample the camera image.');
  }
}

function flashCapture() {
  const flash = document.createElement('div');
  Object.assign(flash.style, {
    position: 'absolute', inset: '0', background: '#fff', opacity: '.7', pointerEvents: 'none', zIndex: '20', transition: 'opacity .22s ease'
  });
  dom.cameraStage.appendChild(flash);
  requestAnimationFrame(() => { flash.style.opacity = '0'; });
  setTimeout(() => flash.remove(), 250);
}

function previousFace() {
  if (state.currentFaceIndex <= 0) return;
  state.currentFaceIndex -= 1;
  updateScanHeader();
}

function sampleStickerGrid() {
  const video = dom.camera;
  const canvas = dom.captureCanvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight) throw new Error('The camera frame is not available yet.');

  canvas.width = videoWidth;
  canvas.height = videoHeight;
  context.drawImage(video, 0, 0, videoWidth, videoHeight);

  const videoRect = video.getBoundingClientRect();
  const gridRect = dom.scanGrid.getBoundingClientRect();
  const scale = Math.max(videoRect.width / videoWidth, videoRect.height / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const offsetX = (videoRect.width - renderedWidth) / 2;
  const offsetY = (videoRect.height - renderedHeight) / 2;
  const gridX = gridRect.left - videoRect.left;
  const gridY = gridRect.top - videoRect.top;
  const cellWidth = gridRect.width / 3;
  const cellHeight = gridRect.height / 3;
  const samples = [];

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const centerCssX = gridX + (col + 0.5) * cellWidth;
      const centerCssY = gridY + (row + 0.5) * cellHeight;
      const centerX = (centerCssX - offsetX) / scale;
      const centerY = (centerCssY - offsetY) / scale;
      const sampleWidth = Math.max(8, (cellWidth * 0.34) / scale);
      const sampleHeight = Math.max(8, (cellHeight * 0.34) / scale);
      const x = Math.max(0, Math.round(centerX - sampleWidth / 2));
      const y = Math.max(0, Math.round(centerY - sampleHeight / 2));
      const width = Math.min(videoWidth - x, Math.round(sampleWidth));
      const height = Math.min(videoHeight - y, Math.round(sampleHeight));
      const pixels = context.getImageData(x, y, width, height).data;
      samples.push(robustMedianColor(pixels));
    }
  }
  return samples;
}

function robustMedianColor(pixelData) {
  const reds = [];
  const greens = [];
  const blues = [];
  for (let i = 0; i < pixelData.length; i += 16) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 248 && max - min < 10) continue;
    reds.push(r); greens.push(g); blues.push(b);
  }
  if (!reds.length) {
    for (let i = 0; i < pixelData.length; i += 16) {
      reds.push(pixelData[i]); greens.push(pixelData[i + 1]); blues.push(pixelData[i + 2]);
    }
  }
  return { r: median(reds), g: median(greens), b: median(blues) };
}

function median(values) {
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
}

function allFacesCaptured() {
  return FACE_ORDER.every((face) => state.faces[face]?.samples?.length === 9);
}

function classifyAllStickers() {
  if (!allFacesCaptured()) return false;
  const references = Object.fromEntries(FACE_ORDER.map((face) => [face, state.faces[face].samples[4]]));
  const rows = [];
  const stickerRefs = [];

  FACE_ORDER.forEach((face) => {
    state.faces[face].labels = new Array(9).fill(null);
    state.faces[face].confidence = new Array(9).fill(Infinity);
    state.faces[face].labels[4] = face;
    state.faces[face].samples.forEach((sample, index) => {
      if (index === 4) return;
      const costs = FACE_ORDER.flatMap((candidate) => Array(8).fill(colorDistance(sample, references[candidate])));
      rows.push(costs);
      stickerRefs.push({ face, index, sample });
    });
  });

  const assignment = hungarian(rows);
  stickerRefs.forEach((ref, rowIndex) => {
    const slot = assignment[rowIndex];
    const label = FACE_ORDER[Math.floor(slot / 8)];
    state.faces[ref.face].labels[ref.index] = label;
    const directCosts = FACE_ORDER.map((candidate) => colorDistance(ref.sample, references[candidate])).sort((a, b) => a - b);
    state.faces[ref.face].confidence[ref.index] = directCosts[1] - directCosts[0];
  });
  saveState();
  return true;
}

// Minimum-cost square assignment. Returns the selected column for each row.
function hungarian(cost) {
  const n = cost.length;
  const m = cost[0]?.length || 0;
  if (!n || n !== m) throw new Error('Color assignment matrix must be square.');
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= m; j += 1) assignment[p[j] - 1] = j - 1;
  return assignment;
}

function colorDistance(a, b) {
  const labA = rgbToLab(a);
  const labB = rgbToLab(b);
  const dl = labA.l - labB.l;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  const labDistance = Math.sqrt(dl * dl + da * da + db * db);
  const hsvA = rgbToHsv(a);
  const hsvB = rgbToHsv(b);
  const hueDelta = Math.min(Math.abs(hsvA.h - hsvB.h), 360 - Math.abs(hsvA.h - hsvB.h)) / 180;
  const saturationWeight = Math.min(hsvA.s, hsvB.s);
  return labDistance + hueDelta * 42 * saturationWeight + Math.abs(hsvA.s - hsvB.s) * 9;
}

function rgbToLab({ r, g, b }) {
  let rr = r / 255; let gg = g / 255; let bb = b / 255;
  rr = rr > 0.04045 ? ((rr + 0.055) / 1.055) ** 2.4 : rr / 12.92;
  gg = gg > 0.04045 ? ((gg + 0.055) / 1.055) ** 2.4 : gg / 12.92;
  bb = bb > 0.04045 ? ((bb + 0.055) / 1.055) ** 2.4 : bb / 12.92;
  const x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  const y = rr * 0.2126 + gg * 0.7152 + bb * 0.0722;
  const z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
  const f = (value) => value > 0.008856 ? value ** (1 / 3) : (7.787 * value) + (16 / 116);
  const fx = f(x); const fy = f(y); const fz = f(z);
  return { l: (116 * fy) - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function rgbToHsv({ r, g, b }) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rr) h = 60 * (((gg - bb) / delta) % 6);
    else if (max === gg) h = 60 * (((bb - rr) / delta) + 2);
    else h = 60 * (((rr - gg) / delta) + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function relativeLuminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function openReview() {
  if (!allFacesCaptured()) {
    showToast('Capture all six faces first.');
    return;
  }
  if (!FACE_ORDER.every((face) => state.faces[face].labels?.length === 9)) classifyAllStickers();
  stopCamera();
  state.selectedSticker = null;
  renderReview();
  showView('reviewView');
}

function renderReview() {
  renderCubeNet();
  renderColorPalette();
  renderColorCounts();
  renderValidation();
}

function renderCubeNet() {
  dom.cubeNet.innerHTML = '';
  const netOrder = ['U', 'L', 'F', 'R', 'B', 'D'];
  netOrder.forEach((face) => {
    const faceElement = document.createElement('div');
    faceElement.className = 'net-face';
    faceElement.dataset.face = face;
    const label = document.createElement('span');
    label.className = 'face-label';
    label.textContent = `${face} · ${FACE_META[face].name}`;
    faceElement.appendChild(label);

    state.faces[face].labels.forEach((stickerFace, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sticker';
      button.style.background = displayColor(stickerFace);
      button.ariaLabel = `${FACE_META[face].name} face, sticker ${index + 1}: ${FACE_META[stickerFace].name} color`;
      if (index === 4) {
        button.classList.add('center');
        button.disabled = true;
      } else {
        button.addEventListener('click', () => selectSticker(face, index));
      }
      if (state.selectedSticker?.face === face && state.selectedSticker?.index === index) button.classList.add('selected');
      const confidence = state.faces[face].confidence?.[index];
      if (Number.isFinite(confidence) && confidence < 7) button.classList.add('low-confidence');
      faceElement.appendChild(button);
    });
    dom.cubeNet.appendChild(faceElement);
  });
}

function selectSticker(face, index) {
  state.selectedSticker = { face, index };
  const currentLabel = state.faces[face].labels[index];
  dom.selectedStickerText.textContent = `${FACE_META[face].name} face, sticker ${index + 1}. Currently classified as ${FACE_META[currentLabel].name}.`;
  renderCubeNet();
  renderColorPalette();
}

function renderColorPalette() {
  dom.colorPalette.innerHTML = '';
  FACE_ORDER.forEach((face) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'palette-color';
    button.style.background = displayColor(face);
    button.title = FACE_META[face].name;
    button.ariaLabel = `Set selected sticker to ${FACE_META[face].name}`;
    button.disabled = !state.selectedSticker;
    button.addEventListener('click', () => setSelectedSticker(face));
    dom.colorPalette.appendChild(button);
  });
}

function setSelectedSticker(label) {
  if (state.solving) {
    showToast('Cancel the optimal search before editing stickers.');
    return;
  }
  if (!state.selectedSticker) return;
  const { face, index } = state.selectedSticker;
  state.faces[face].labels[index] = label;
  state.faces[face].confidence[index] = Infinity;
  saveState();
  renderReview();
  dom.selectedStickerText.textContent = `${FACE_META[face].name} face, sticker ${index + 1}. Set to ${FACE_META[label].name}.`;
}

function renderColorCounts() {
  const counts = Object.fromEntries(FACE_ORDER.map((face) => [face, 0]));
  FACE_ORDER.forEach((face) => state.faces[face].labels.forEach((label) => { counts[label] += 1; }));
  dom.colorCounts.innerHTML = '';
  FACE_ORDER.forEach((face) => {
    const row = document.createElement('div');
    row.className = `count-row${counts[face] === 9 ? '' : ' bad'}`;
    row.innerHTML = `<span class="count-dot" style="background:${displayColor(face)}"></span><span>${FACE_META[face].name} color</span><strong>${counts[face]}/9</strong>`;
    dom.colorCounts.appendChild(row);
  });
}

function renderValidation() {
  const result = validateCubeState();
  dom.validationBox.className = `validation-box ${result.valid ? 'good' : 'bad'}`;
  dom.validationBox.innerHTML = `<strong>${escapeHtml(result.title)}</strong><span>${escapeHtml(result.message)}</span>`;
  dom.solveButton.disabled = !result.valid || state.solving;
  return result;
}

function faceletString() {
  return FACE_ORDER.map((face) => state.faces[face].labels.join('')).join('');
}

function validateCubeState() {
  if (!allFacesCaptured()) return { valid: false, title: 'Scan incomplete', message: 'Capture all six faces.' };
  const labels = FACE_ORDER.flatMap((face) => state.faces[face].labels || []);
  if (labels.length !== 54 || labels.some((label) => !FACE_ORDER.includes(label))) {
    return { valid: false, title: 'Missing sticker data', message: 'One or more stickers have no recognized color.' };
  }
  const counts = Object.fromEntries(FACE_ORDER.map((face) => [face, labels.filter((label) => label === face).length]));
  const wrongCount = FACE_ORDER.find((face) => counts[face] !== 9);
  if (wrongCount) {
    return { valid: false, title: 'Color counts do not match', message: `The ${FACE_META[wrongCount].name} color appears ${counts[wrongCount]} times; it must appear exactly 9 times.` };
  }
  if (FACE_ORDER.some((face) => state.faces[face].labels[4] !== face)) {
    return { valid: false, title: 'A center color is incorrect', message: 'Center stickers define each face and cannot be changed.' };
  }

  try {
    const cube = Cube.fromString(faceletString());
    if (!isPermutation(cube.cp, 8) || !isPermutation(cube.ep, 12)) {
      return { valid: false, title: 'Impossible piece combination', message: 'At least one edge or corner appears twice, or another piece is missing. Check the marked and similarly colored stickers.' };
    }
    if (cube.co.reduce((sum, value) => sum + value, 0) % 3 !== 0) {
      return { valid: false, title: 'A corner is twisted', message: 'This scan describes a single twisted corner, which a normal cube cannot reach. Check corner stickers and face orientation.' };
    }
    if (cube.eo.reduce((sum, value) => sum + value, 0) % 2 !== 0) {
      return { valid: false, title: 'An edge is flipped', message: 'This scan describes a single flipped edge. Check edge stickers and make sure every face used the requested top edge.' };
    }
    if (permutationParity(cube.cp) !== permutationParity(cube.ep)) {
      return { valid: false, title: 'Two pieces are swapped', message: 'This state cannot be reached by legal turns. Recheck the scan orientation or two similar stickers.' };
    }
    return { valid: true, title: 'Cube state is valid', message: 'All 54 stickers form a physically solvable 3×3 cube.', cube };
  } catch (error) {
    return { valid: false, title: 'Could not read this cube', message: error?.message || 'Review the sticker colors and scan orientation.' };
  }
}

function isPermutation(values, size) {
  return Array.isArray(values)
    && values.length === size
    && [...values].sort((a, b) => a - b).every((value, index) => value === index);
}

function permutationParity(values) {
  let inversions = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) if (values[i] > values[j]) inversions += 1;
  }
  return inversions % 2;
}

function rescanSelectedFace() {
  const face = state.selectedSticker?.face || 'U';
  beginScan(FACE_ORDER.indexOf(face), true);
}

function clearScan() {
  if (state.solving) {
    showToast('Cancel the optimal search before clearing the scan.');
    return;
  }
  stopCamera();
  FACE_ORDER.forEach((face) => { state.faces[face] = null; });
  state.selectedSticker = null;
  state.solution = [];
  state.solutionMeta = null;
  localStorage.removeItem(STORAGE_KEY);
  renderHomeState();
  showView('homeView');
  showToast('Scan cleared.');
}

async function solveCube() {
  const validation = renderValidation();
  if (!validation.valid || state.solving) return;

  state.solving = true;
  state.solveCancelled = false;
  state.solutionMeta = null;
  dom.solveButton.disabled = true;
  dom.solveButton.textContent = 'Searching optimally…';
  dom.cancelSolveButton.classList.remove('hidden');
  dom.solveProgress.classList.remove('hidden');
  updateSolveProgress({ stage: 'upper-bound' });

  try {
    await acquireWakeLock();
    await solverReady;
    const result = await callSolver(
      'solve',
      { cube: validation.cube.toJSON() },
      updateSolveProgress,
    );
    const algorithm = result.algorithm || '';
    const verification = validation.cube.clone();
    if (algorithm) verification.move(algorithm);
    if (!verification.isSolved()) throw new Error('The generated algorithm did not verify.');

    state.solution = algorithm.trim() ? algorithm.trim().split(/\s+/) : [];
    state.solutionIndex = 0;
    state.solutionMeta = result;
    renderSolution();
    showView('solveView');
  } catch (error) {
    if (state.solveCancelled || error?.message === 'Search cancelled.') {
      showToast('Optimal search cancelled.');
    } else {
      showToast(`Solver error: ${error?.message || error}`);
    }
  } finally {
    state.solving = false;
    dom.solveProgress.classList.add('hidden');
    dom.cancelSolveButton.classList.add('hidden');
    dom.cancelSolveButton.disabled = false;
    dom.solveButton.textContent = 'Find shortest solution';
    dom.solveButton.disabled = !validateCubeState().valid;
    await releaseWakeLock();
  }
}

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || document.hidden || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; }, { once: true });
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  const lock = wakeLock;
  wakeLock = null;
  try { await lock.release(); } catch { /* already released */ }
}

function updateSolveProgress(progress = {}) {
  if (progress.stage === 'upper-bound') {
    dom.solveProgressTitle.textContent = 'Finding an upper bound…';
    dom.solveProgressDetail.textContent = 'First finding a short solution, then proving whether anything shorter exists.';
    return;
  }

  if (progress.stage === 'proof-search') {
    dom.solveProgressTitle.textContent = `Proving depth ${progress.depth}…`;
    const nodes = Number.isFinite(progress.nodes) ? formatInteger(progress.nodes) : '0';
    const candidate = Number.isFinite(progress.upperBound) ? ` Fast candidate: ${progress.upperBound} moves.` : '';
    dom.solveProgressDetail.textContent = `${nodes} search nodes checked.${candidate} Keep this page open.`;
  }
}

function cancelOptimalSearch() {
  if (!state.solving || state.solveCancelled) return;
  state.solveCancelled = true;
  dom.cancelSolveButton.disabled = true;
  if (solverWorker) solverWorker.terminate();
  solverWorker = null;
  workerRequests.forEach(({ reject }) => reject(new Error('Search cancelled.')));
  workerRequests.clear();
  resetSolverReadyPromise();
  setSolverStatus('Restarting solver…', 'loading');
  initSolverWorker();
}

function initSolverWorker() {
  const readyResolve = solverReadyResolve;
  const readyReject = solverReadyReject;
  if (!window.Worker) {
    setSolverStatus('Worker unsupported', 'error');
    readyReject(new Error('This browser does not support Web Workers.'));
    return;
  }
  try {
    const worker = new Worker('solver/worker.js');
    solverWorker = worker;
    worker.addEventListener('message', handleWorkerMessage);
    worker.addEventListener('error', (event) => {
      if (worker !== solverWorker) return;
      const error = new Error(event.message || 'Solver worker failed.');
      setSolverStatus('Solver failed', 'error');
      workerRequests.forEach(({ reject }) => reject(error));
      workerRequests.clear();
      readyReject(error);
    });
    callSolver('init').then(() => {
      setSolverStatus('Optimal solver ready', 'ready');
      readyResolve();
    }).catch((error) => {
      setSolverStatus('Solver failed', 'error');
      readyReject(error);
    });
  } catch (error) {
    setSolverStatus('Solver failed', 'error');
    readyReject(error);
  }
}

function callSolver(type, payload = {}, onProgress = null) {
  if (!solverWorker) return Promise.reject(new Error('Solver worker is unavailable.'));
  const id = ++workerRequestId;
  return new Promise((resolve, reject) => {
    workerRequests.set(id, { resolve, reject, onProgress });
    solverWorker.postMessage({ type, id, ...payload });
  });
}

function handleWorkerMessage(event) {
  const data = event.data || {};
  const { type, id, message } = data;
  const request = workerRequests.get(id);
  if (!request) return;

  if (type === 'progress') {
    request.onProgress?.(data);
    return;
  }

  workerRequests.delete(id);
  if (type === 'error') request.reject(new Error(message || 'Solver error.'));
  else if (type === 'solution') request.resolve({
    algorithm: data.algorithm || '',
    optimalLength: data.optimalLength,
    quickLength: data.quickLength,
    nodes: data.nodes,
    elapsedMs: data.elapsedMs,
    searchedThrough: data.searchedThrough,
  });
  else request.resolve(true);
}

function setSolverStatus(text, statusClass) {
  dom.solverStatus.textContent = text;
  dom.solverStatus.className = `status-pill ${statusClass}`;
}

function renderSolution() {
  const solved = state.solution.length === 0;
  dom.solvedMessage.classList.toggle('hidden', !solved);
  dom.solutionPlayer.classList.toggle('hidden', solved);
  dom.moveCounter.textContent = solved ? '0 moves' : `${state.solution.length} move${state.solution.length === 1 ? '' : 's'}`;
  const meta = state.solutionMeta;
  if (meta && Number.isFinite(meta.nodes)) {
    const duration = formatDuration(meta.elapsedMs || 0);
    dom.optimalProof.textContent = `Shortest possible in HTM · ${formatInteger(meta.nodes)} nodes checked · ${duration}`;
  } else {
    dom.optimalProof.textContent = 'Shortest possible in the half-turn metric.';
  }
  dom.algorithmText.innerHTML = '';

  state.solution.forEach((token, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alg-token';
    button.textContent = token;
    button.addEventListener('click', () => setSolutionStep(index));
    dom.algorithmText.appendChild(button);
  });
  if (!solved) setSolutionStep(0);
}

function renderMoveNet() {
  dom.moveNet.innerHTML = '';
  ['U', 'L', 'F', 'R', 'B', 'D'].forEach((face) => {
    const element = document.createElement('div');
    element.className = 'mini-face';
    element.dataset.face = face;
    for (let i = 0; i < 9; i += 1) {
      const tile = document.createElement('i');
      tile.style.background = displayColor(face);
      element.appendChild(tile);
    }
    dom.moveNet.appendChild(element);
  });
}

function setSolutionStep(index) {
  if (!state.solution.length) return;
  state.solutionIndex = Math.max(0, Math.min(state.solution.length - 1, index));
  const token = state.solution[state.solutionIndex];
  const face = token[0];
  const suffix = token.slice(1);
  dom.movePosition.textContent = `Move ${state.solutionIndex + 1} of ${state.solution.length}`;
  dom.moveNotation.textContent = token;
  dom.moveInstruction.textContent = moveInstruction(face, suffix);
  dom.previousMoveButton.disabled = state.solutionIndex === 0;
  dom.nextMoveButton.textContent = state.solutionIndex === state.solution.length - 1 ? 'Finish' : 'Next move';
  document.querySelectorAll('.mini-face').forEach((element) => element.classList.toggle('active', element.dataset.face === face));
  document.querySelectorAll('.alg-token').forEach((element, tokenIndex) => element.classList.toggle('current', tokenIndex === state.solutionIndex));
  positionTurnArrow(face, suffix);
}

function nextSolutionStep() {
  if (state.solutionIndex >= state.solution.length - 1) {
    showToast('Done — your cube should now be solved.');
    return;
  }
  setSolutionStep(state.solutionIndex + 1);
}

function moveInstruction(face, suffix) {
  const name = FACE_META[face].name;
  if (suffix === '2') return `Turn the ${name} face 180 degrees`;
  if (suffix === "'") return `Turn the ${name} face counterclockwise`;
  return `Turn the ${name} face clockwise`;
}

function positionTurnArrow(face, suffix) {
  requestAnimationFrame(() => {
    const visual = document.querySelector('.move-visual-card');
    const active = dom.moveNet.querySelector(`.mini-face[data-face="${face}"]`);
    if (!visual || !active) return;
    const visualRect = visual.getBoundingClientRect();
    const faceRect = active.getBoundingClientRect();
    dom.turnArrow.style.left = `${faceRect.left - visualRect.left + faceRect.width / 2}px`;
    dom.turnArrow.style.top = `${faceRect.top - visualRect.top + faceRect.height / 2}px`;
    dom.turnArrow.style.width = `${Math.max(84, faceRect.width * 0.94)}px`;
    dom.turnArrow.classList.toggle('counter', suffix === "'");
    dom.turnArrow.classList.toggle('double', suffix === '2');
    dom.doubleBadge.classList.toggle('hidden', suffix !== '2');
  });
}

function displayColor(face) {
  const sample = state.faces[face]?.samples?.[4];
  return sample ? rgbCss(sample) : FACE_META[face].fallback;
}

function rgbCss({ r, g, b }) { return `rgb(${r}, ${g}, ${b})`; }

function saveState() {
  try {
    const compact = { faces: state.faces };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
    renderHomeState();
  } catch { /* Storage is optional. */ }
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved?.faces) return;
    FACE_ORDER.forEach((face) => {
      const value = saved.faces[face];
      if (value?.samples?.length !== 9) return;
      const labelsAreValid = value.labels?.length === 9 && value.labels.every((label) => FACE_ORDER.includes(label));
      state.faces[face] = {
        samples: value.samples,
        labels: labelsAreValid ? value.labels : null,
        confidence: labelsAreValid && value.confidence?.length === 9 ? value.confidence : null,
      };
    });
  } catch { localStorage.removeItem(STORAGE_KEY); }
}

function initInstallHandling() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (standalone) dom.installButton.classList.add('hidden');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    dom.installButton.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    dom.installButton.classList.add('hidden');
    showToast('CubeScan installed.');
  });
  dom.installButton.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showToast(isIOS ? 'In Safari, tap Share, then “Add to Home Screen”.' : 'Use your browser menu and choose “Install app” or “Add to Home screen”.');
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2800);
}

function formatInteger(value) {
  return new Intl.NumberFormat().format(Math.max(0, Math.round(value || 0)));
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
