# planemat

Turns a Google Earth screenshot into a print-ready **1:400 airport mat** PDF.

Open `index.html` in a browser. Nothing is installed, nothing is uploaded — it all runs
locally in the page, and the PDF is written by hand in JavaScript.

## How it works

1. **Load** a screenshot (drag & drop or the file picker).
2. **Measure the scale bar.** Drag a line from the left tick of Google Earth's scale bar to
   its right tick, then type the number printed next to it (m, ft, km or mi). That single
   measurement is what converts screen pixels into metres.
3. **Frame the crop.** Drag to move, the orange dot to rotate (handy for lining a runway up
   with the sheet edge).
   - **Locked** — the frame is pinned to exactly one A4 sheet's worth of ground and cannot be
     resized. This is what guarantees true 1:400: at that scale one A4 landscape sheet is
     **118.8 × 84 m** of real ground (297 mm × 400 = 118.8 m).
   - **Free** — resize the frame and it tiles across as many A4 sheets as it needs. Snapping
     keeps the crop on whole-sheet boundaries so no paper is wasted.
4. **Export** a PDF whose page box is exactly 297 × 210 mm.

## Printing

Print at **Actual size / 100% / Scale: none**. "Fit to page" silently rescales the mat and
the 1:400 is gone.

Most printers can't print to the paper edge, so each sheet carries thin corner and
mid-edge trim marks showing where the true 297 × 210 mm boundary is. Trim to them and the
sheets butt together with no overlap and no seam gap.

## Getting a good screenshot

- Look **straight down** — no tilt. A tilted view has no single scale and cannot be fixed
  afterwards.
- North up, 3D buildings and terrain off.
- Keep the scale bar in the shot.
- Zoom in as far as you can while still covering the area you want. The sidebar reports
  **Detail at 1:400** in DPI; below ~150 the print will be soft, and exporting at a higher
  DPI cannot add detail that the screenshot never had.

## Accuracy notes

- Calibration is only as good as the line you drag. Zoom right into the scale bar first;
  arrow keys nudge a grabbed endpoint one pixel at a time.
- Google Earth's scale bar is exact at the centre of the view. Across an airport-sized area
  the Web Mercator distortion is well under 0.1%, so it doesn't matter here.
