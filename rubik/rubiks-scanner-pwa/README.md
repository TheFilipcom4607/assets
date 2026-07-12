# CubeScan PWA

An installable, offline-capable 3×3 Rubik's Cube scanner and solver. It uses the phone camera to sample nine sticker colors per face, balances the color assignment to exactly nine stickers per color, validates whether the state is physically possible, and generates a provably shortest move-by-move solution in a Web Worker.

## Run it locally

Camera access requires a secure context. `localhost` counts as secure.

```bash
cd rubiks-scanner-pwa
python3 -m http.server 8080
```

Open `http://localhost:8080` on the same computer. For a phone, deploy the folder to any HTTPS static host (GitHub Pages, Cloudflare Pages, Netlify, Vercel, or your own HTTPS server). Merely opening `index.html` as a file will not grant camera access.

## Scan orientation

The scanner uses plain color prompts and asks for the standard cube colors in this order: **white, red, green, yellow, orange, blue**. Keep the named neighboring center at the top of the camera frame:

- White face: blue center at top
- Red face: white center at top
- Green face: white center at top
- Yellow face: green center at top
- Orange face: white center at top
- Blue face: white center at top

Internally these map to the solver faces **U, R, F, D, L, B**, but those letters are no longer used in the scanning instructions. This assumes the standard Rubik's Cube color scheme.

This orientation is important because a face photographed upside down describes a different cube.

## Privacy and offline behavior

No full images are stored or transmitted. The app retains only 54 sampled RGB values plus your corrected face labels in local browser storage. After the first successful load, the service worker caches the app shell and solver so it can work offline; camera permission remains controlled by the browser.

## Solver and move metric

The app returns an **optimal solution in the half-turn metric (HTM)**: `R`, `R'`, and `R2` each count as one move. This is the metric in which every legal 3×3 position is known to require at most 20 moves.

The solver first uses the included `cubejs` 1.3.2 two-phase implementation to obtain a short upper bound. It then performs an exact increasing-depth search. Every shorter canonical move sequence is ruled out before a result is shown, so the displayed algorithm is not merely short—it is minimal in HTM.

Exact optimal search is dramatically more expensive than ordinary two-phase solving. Easy and moderately scrambled positions may finish quickly, while deep random positions can require a very large search and may take minutes, hours, or longer on a phone. Keep the page open. The **Cancel optimal search** button terminates the worker safely and rebuilds it for another attempt.

Everything still runs locally and offline. No cube state is sent to a server. The `cubejs` license is included in `THIRD_PARTY_LICENSES.md`.
