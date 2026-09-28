// Named SVG parts keep each motion tied to the object, never to child indexes.
const p = (d, part, extra = {}) => ["path", { d, ...(part ? { "data-part": part } : {}), ...extra }];
const r = (x, y, width, height, part, extra = {}) => ["rect", { x, y, width, height, rx: 1.5, ...(part ? { "data-part": part } : {}), ...extra }];
const c = (cx, cy, radius, part, extra = {}) => ["circle", { cx, cy, r: radius, ...(part ? { "data-part": part } : {}), ...extra }];
const g = (part, children, extra = {}) => ["g", { "data-part": part, ...extra }, children];
const effect = { opacity: 0, fill: "currentColor", stroke: "none" };
const fill = { fill: "currentColor", stroke: "none" };
const arrow = (direction) => g("arrow", [p(direction === "up" ? "M12 16V3m-5 5 5-5 5 5" : "M12 3v13m-5-5 5 5 5-5")]);
const tray = p("M3 15v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5", "tray");
const lens = [c(10.5, 10.5, 5.5), p("m15 15 5 5")];
const roundArrow = (reverse = false) => [g("rotor", [p(reverse ? "M3 10a9 9 0 1 1 1 8M3 4v6h6" : "M21 10a9 9 0 1 0-1 8m1-14v6h-6")])];
const chevron = (d) => [p(d, "arrow")];
const check = p("m6 12 4 4 8-8", "tick");
const layer = (y, part) => p(`m3 ${y} 9 5 9-5`, part);
const cube = (x, y, part) => g(part, [p(`m${x} ${y} 5 2.8v5.6l-5 2.8-5-2.8v-5.6Zm-5 2.8 5 2.8 5-2.8m-5 2.8v5.6`)]);

export const iconArt = {
  Activity: [p("M2 12h4l3-8 4 16 4-12 2 4h3", "trace"),
    g("signal", [c(0, 0, 2.8, null, { ...fill, opacity: .16 }), c(0, 0, 1.15, null, fill)], { opacity: 0 })],
  Monitor: [r(3, 3, 18, 14, "frame", { rx: 2 }), p("M8 21h8m-4-4v4"),
    g("picture", [p("m10 7 5 3-5 3Z", null, fill)], { opacity: 0 }),
    p("M6 14h12", "progress", { opacity: 0, strokeWidth: 1.3, style: { transformOrigin: "6px 14px" } })],
  LayoutGrid: [[3, 3], [14, 3], [3, 14], [14, 14]].flatMap(([x, y], i) => [r(x, y, 7, 7), r(x + 1, y + 1, 5, 5, "tile" + i, { ...effect, rx: .5 })]),
  Boxes: [cube(6.5, 10, "left"), cube(17.5, 10, "right"), cube(12, 1, "top")],
  Upload: [tray, arrow("up"), p("M8 21h8", "edge", { opacity: 0 })],
  Download: [tray, arrow("down"), p("M8 21h8", "edge", { opacity: 0 })],
  RefreshCw: [g("rotor", [p("M21 7v5h-5M3 17v-5h5M5.1 6a8 8 0 0 1 13.2-.8L21 8M3 16l2.7 2.8A8 8 0 0 0 18.9 18")])],
  RotateCw: roundArrow(), RotateCcw: roundArrow(true),
  Settings2: [p("M3 7h18M3 17h18", "rails", { opacity: .5 }), c(8, 7, 2.5, "upper", { fill: "currentColor" }), c(16, 17, 2.5, "lower", { fill: "currentColor" })],
  SlidersHorizontal: [p("M3 5h18M3 12h18M3 19h18", "rails", { opacity: .5 }),
    ...[[8, 5], [16, 12], [10, 19]].map(([x, y], i) => r(x - 1.5, y - 2, 3, 4, "knob" + i, { rx: 1, fill: "currentColor" }))],
  Trash2: [p("m5 7 1 14h12l1-14M10 10v7m4-7v7", "bin"),
    g("lid", [p("M3 6h18M9 6V3h6v3")], { style: { transformOrigin: "5px 6px" } })],
  Search: [g("lens", lens), p("M8 8h3", "glint", { opacity: 0, strokeWidth: 1.3 })],
  ScanSearch: [p("M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4"), g("lens", [c(10.5, 10.5, 3.5), p("m13 13 4 4")]),
    p("M6 7h12", "scan", { opacity: 0, strokeWidth: 1.2 })],
  Wallet: [g("card", [p("M6 7V3h11v4")], { opacity: 0 }),
    p("M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6"),
    g("clasp", [p("M21 12h-5v5h5"), c(18, 14.5, .6, null, fill)])],
  KeyRound: [g("key", [c(16.5, 7.5, 4.5), p("m13.3 10.7-10 10H3v-4l3-3h3v-3h3")], { style: { transformOrigin: "16.5px 7.5px" } })],
  LogIn: [p("M14 3h6v18h-6", "door"), g("arrow", [p("M3 12h12m-4-4 4 4-4 4")])],
  LogOut: [p("M9 3H3v18h6", "door"), g("arrow", [p("M10 12h11m-4-4 4 4-4 4")])],
  ExternalLink: [p("M10 4H4v16h16v-6", "frame"), p("M14 3h7v7m0-7L10 14", "arrow")],
  ArrowRightLeft: [p("M3 7h18m-4-4 4 4-4 4", "outbound"), p("M21 17H3m4-4-4 4 4 4", "inbound")],
  ArrowUpRight: chevron("M7 17 17 7M7 7h10v10"), ArrowDownLeft: chevron("M17 7 7 17M7 7v10h10"),
  ChevronRight: chevron("m9 5 7 7-7 7"), ChevronDown: chevron("m5 9 7 7 7-7"),
  Plus: [p("M4 12h16", "horizontal"), p("M12 4v16", "vertical")],
  X: [p("m6 6 12 12", "first"), p("M18 6 6 18", "second")],
  Folder: [p("M3 8V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11", "back"),
    p("M3 8h18l-2 12H5Z", "front", { style: { transformOrigin: "12px 20px" } }), p("M8 10h8", "paper", { opacity: 0 })],
  Terminal: [r(2, 3, 20, 18, "frame", { rx: 2 }), p("m6 8 3 3-3 3", "prompt"), p("M12 15h5", "cursor"), p("M12 10h4", "output", { opacity: 0 })],
  Play: [p("m8 4 12 8-12 8Z", "play"), p("M3 9v6", "wake", { opacity: 0, strokeWidth: 1.4 })],
  Square: [r(5, 5, 14, 14, "stop", { rx: 1.5 }), r(7, 7, 10, 10, "fill", effect)],
  Power: [p("M6 5a9 9 0 1 0 12 0", "ring"), p("M12 2v9", "switch"), c(12, 12, 5, "glow", effect)],
  Wrench: [g("tool", [p("M15 4a6 6 0 0 0-7 7l-6 6a3 3 0 0 0 5 5l6-6a6 6 0 0 0 7-8l-4 4-4-4 3-4Z")], { style: { transformOrigin: "15px 9px" } })],
  Zap: [p("m13 2-10 12h8l-1 8 11-12h-8Z", "bolt"), p("M3 5 1 4m20 15 2 1", "spark", { opacity: 0, fill: "none", strokeWidth: 1.3 })],
  UserRound: [c(12, 8, 4, "head"), p("M4 21v-2a8 8 0 0 1 16 0v2", "shoulders")],
  Unlink: [p("m9 8 2-2a5 5 0 0 1 7 7l-2 2", "upper"), p("m15 16-2 2a5 5 0 0 1-7-7l2-2", "lower"), p("M4 3v3H1m22 12h-3v3", "break")],
  MoreHorizontal: [c(5, 12, 1, "dot0", fill), c(12, 12, 1, "dot1", fill), c(19, 12, 1, "dot2", fill)],
  GripVertical: [0, 1, 2].flatMap((i) => [c(9, 5 + i * 7, 1, "left" + i, fill), c(15, 5 + i * 7, 1, "right" + i, fill)]),
  Layers: [p("m3 7 9-5 9 5-9 5Z", "top"), layer(12, "middle"), layer(17, "bottom")],
  Layers3: [p("m3 7 9-5 9 5-9 5Z", "top"), layer(12, "middle"), layer(17, "bottom")],
  Network: [p("M12 8v5m-7 4v-4h14v4", "wires"), r(9, 2, 6, 6, "source"), r(2, 17, 6, 5, "left"), r(16, 17, 6, 5, "right"), c(12, 9, 1, "packet", effect)],
  Check: [check], CheckCircle2: [c(12, 12, 9, "ring"), check],
  ShieldCheck: [p("m12 2 9 4v6c0 5-5 9-9 10-4-1-9-5-9-10V6Z", "shield"), p("m8 12 3 3 5-6", "tick")],
  BellRing: [g("bell", [p("M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"), p("M10 21h4", "clapper")], { style: { transformOrigin: "12px 3px" } }), p("M2 4v4m20-4v4", "echo", { opacity: .5 })],
  Info: [c(12, 12, 9), p("M12 11v6", "stem"), c(12, 7, .7, "dot", fill)],
  AlertCircle: [c(12, 12, 9), p("M12 6v7", "stem"), c(12, 17, .7, "dot", fill)],
  AlertTriangle: [p("m12 3 10 18H2Z"), p("M12 9v4", "stem"), c(12, 17, .7, "dot", fill)],
};
