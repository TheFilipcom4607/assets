/*
 * Super Slide — level ladder.
 *
 * Generated and verified by tooling: every layout uses the exact physical
 * piece inventory (one 2x2, five 1x2, four 1x1), is solvable, and `par` is
 * the breadth-first minimum number of moves, where a move is one continuous
 * gesture with a single piece. `steps` is the cell count along that solution.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SlideLevels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return [
  { id: "L01", name: "First Slide", par: 3, steps: 3, rows: ["ABBC", "ADEF", "GDEF", ".HII", ".JII"] },
  { id: "L02", name: "Warm Up", par: 4, steps: 6, rows: ["ABC.", "ABC.", "DDEF", "GGEH", "GGIJ"] },
  { id: "L03", name: "Loosen Up", par: 5, steps: 7, rows: ["ABCD", "AECD", "FG.H", "FGII", ".JII"] },
  { id: "L04", name: "Side Step", par: 6, steps: 10, rows: ["AAB.", "CD.E", "CFGE", "HFII", "HJII"] },
  { id: "L05", name: "Shuffle", par: 7, steps: 7, rows: ["AAB.", "CCBD", ".EED", "FEEG", "FHIJ"] },
  { id: "L06", name: "Two Step", par: 8, steps: 10, rows: ["AAB.", "C.BD", "EFFD", "GGHI", "GGHJ"] },
  { id: "L07", name: "Open Road", par: 9, steps: 9, rows: [".ABB", "CCDE", "FGHE", "FIJJ", ".IJJ"] },
  { id: "L08", name: "Short Fuse", par: 10, steps: 13, rows: ["..AB", "CDAE", "CFFE", "GGHH", "IJHH"] },
  { id: "L09", name: "Crosstown", par: 11, steps: 17, rows: ["..AB", "CCAB", "DDEE", "FGEE", "HGIJ"] },
  { id: "L10", name: "Detour", par: 12, steps: 15, rows: ["ABCC", "ADEE", ".DF.", "GGFH", "GGIJ"] },
  { id: "L11", name: "Elbow Room", par: 14, steps: 23, rows: ["A.BC", "ADBE", ".DFE", "GGFH", "GGIJ"] },
  { id: "L12", name: "Tight Fit", par: 16, steps: 21, rows: ["ABCC", ".B.D", "EEFG", "HHFG", "HHIJ"] },
  { id: "L13", name: "Switchback", par: 18, steps: 20, rows: ["ABCD", "AEEF", "GG.F", "GGHI", "J.HI"] },
  { id: "L14", name: "Bottleneck", par: 20, steps: 30, rows: ["AABB", "CCBB", "D.EF", "GHEF", "GI.J"] },
  { id: "L15", name: "Traffic", par: 22, steps: 32, rows: ["AAB.", "CC.D", "CCED", "FGHI", "JGHI"] },
  { id: "L16", name: "Gridlock", par: 24, steps: 35, rows: ["AABB", "AACC", "DDEE", ".FFG", ".HIJ"] },
  { id: "L17", name: "Squeeze Play", par: 26, steps: 36, rows: ["AABB", "CDBB", "EDFG", "EHFG", ".I.J"] },
  { id: "L18", name: "Pinch Point", par: 28, steps: 42, rows: ["AB.C", "ADEF", "GDE.", "GHII", "JJII"] },
  { id: "L19", name: "Logjam", par: 31, steps: 44, rows: ["AABB", "CCDE", "CCFE", "GGH.", ".IHJ"] },
  { id: "L20", name: "Deadlock", par: 34, steps: 49, rows: ["AABB", ".CDE", "FGH.", "FGII", "JJII"] },
  { id: "L21", name: "Roundabout", par: 37, steps: 51, rows: [".AAB", "CD.B", "CEEF", "GEEH", "IIJH"] },
  { id: "L22", name: "Long Way Round", par: 40, steps: 52, rows: [".AA.", "BCDE", "BFDG", "HHIG", "HHJJ"] },
  { id: "L23", name: "The Gauntlet", par: 43, steps: 52, rows: ["ABBC", "ADDE", "FDDE", "FGG.", ".HIJ"] },
  { id: "L24", name: "Chokehold", par: 46, steps: 55, rows: ["AABC", "AADD", "EFGH", "EI.H", ".IJJ"] },
  { id: "L25", name: "Stonewall", par: 49, steps: 64, rows: ["AABC", ".DB.", "EDFG", "HHII", "JJII"] },
  { id: "L26", name: "Iron Gate", par: 52, steps: 76, rows: [".ABB", "CABB", ".DEF", "GDHI", "JJHI"] },
  { id: "L27", name: "Siege", par: 55, steps: 78, rows: ["AA..", "AABB", "CCDE", "FGDE", "FHIJ"] },
  { id: "L28", name: "Blockade", par: 58, steps: 78, rows: ["AABB", "C.BB", "CDEE", ".FFG", "HIJJ"] },
  { id: "L29", name: "Labyrinth", par: 62, steps: 87, rows: ["A.BC", "DD.E", "DDFE", "GGHH", "IIJJ"] },
  { id: "L30", name: "The Long March", par: 66, steps: 95, rows: ["AABC", "AABC", "DD.E", ".FGE", "HIGJ"] },
  { id: "L31", name: "No Quarter", par: 70, steps: 106, rows: ["AB..", "CBDD", "CEFF", "GEFF", "HIJJ"] },
  { id: "L32", name: "Hard Passage", par: 74, steps: 110, rows: [".AAB", ".CCB", "DCCE", "FGHI", "JJHI"] },
  { id: "L33", name: "Stalemate", par: 78, steps: 106, rows: ["AABC", "AA.C", "D.EF", "DGHF", "IIJJ"] },
  { id: "L34", name: "The Vice", par: 84, steps: 110, rows: [".ABB", "CABB", "DDE.", "FGEH", "IIJH"] },
  { id: "L35", name: "Endgame", par: 90, steps: 125, rows: ["AABC", "AABC", "DD.E", "FFGE", "H.IJ"] },
  { id: "L36", name: "Last Stand", par: 96, steps: 126, rows: ["ABB.", "CBBD", "EFFG", "EHHG", "IIJ."] },
  { id: "L37", name: "The Long Game", par: 104, steps: 137, rows: ["AAB.", "AACD", "EEFD", "G.FH", "IIJH"] },
  { id: "L38", name: "Grandmaster", par: 108, steps: 140, rows: ["AABC", "AADC", "EE.F", ".GHF", "IIHJ"] },
  { id: "L39", name: "Heng Dao Li Ma", par: 81, steps: 118, rows: ["BAAC", "BAAC", "DEEF", "DGHF", "I..J"], tag: "横刀立马", classic: true }
  ];
});
