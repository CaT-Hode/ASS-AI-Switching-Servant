export const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
export const easeInOut = "cubic-bezier(0.65, 0, 0.35, 1)";
const pose = (part, values, duration = 300, delay = 0) => ({ part, frames: [values], duration, delay, easing: easeOut });
const sequence = (part, frames, duration = 460, loop = false, delay = 0) => ({ part, frames, duration, loop, delay, easing: easeInOut });
const shift = (part, transform, duration, delay) => pose(part, { transform }, duration, delay);
const alpha = (part, opacity) => pose(part, { opacity });
const stroke = (part) => sequence(part, [{ strokeDasharray: "1 1", strokeDashoffset: 1, opacity: .35 }, { strokeDasharray: "1 1", strokeDashoffset: 0, opacity: 1 }], 480);
const kick = (part, target, resting = "none", duration = 420) => sequence(part, [{ transform: target, offset: .36 }, { transform: resting }], duration);
const flash = (part, peak = 1, resting = 0, duration = 420) => sequence(part, [{ opacity: peak, offset: .28 }, { opacity: resting }], duration);
const pulse = (part, low, high, duration = 1600, delay = 0) => sequence(part, [{ opacity: low }, { opacity: high, offset: .35 }, { opacity: low, offset: .72 }, { opacity: low }], duration, true, delay);
const path = (part, points, duration = 1550) => ({ ...sequence(part, points.map(([x, y, opacity, offset]) => ({ transform: `translate(${x}px,${y}px)`, opacity, ...(offset == null ? {} : { offset }) })), duration, true), easing: "linear" });
const arrowFlow = (direction) => ({
  hover: [shift("arrow", `translateY(${direction * 3}px)`), alpha("edge", .9)],
  press: [sequence("arrow", [{ transform: `translateY(${direction * 7}px)`, opacity: 0, offset: .35 }, { transform: `translateY(${-direction * 6}px)`, opacity: 0, offset: .36 }, { transform: `translateY(${direction * 3}px)`, opacity: 1 }], 500), flash("edge", 1, .9)],
});
const turn = (part, degrees) => ({ hover: [shift(part, `rotate(${degrees}deg)`, 400)], press: [{ ...kick(part, `rotate(${degrees}deg)`, `rotate(${degrees}deg)`, 620), turn: Math.sign(degrees) * 360 }] });
const arrow = (delta, farther) => ({ hover: [shift("arrow", delta)], press: [kick("arrow", farther, delta)] });
const check = (ring) => ({ hover: [stroke("tick"), ...(ring ? [alpha(ring, .65)] : [])], press: [kick("tick", "scale(1.2)", "none", 300)] });

// Hover has a sustained pose or an explicit story loop. Press is a different
// action, and exit is handled from the live presentation by the player.
export const iconMotion = {
  Activity: {
    hover: [alpha("trace", .38), { ...sequence("trail", [{ opacity: 0, strokeDashoffset: 1 }, { opacity: 1, strokeDashoffset: .7, offset: .2 }, { opacity: 1, strokeDashoffset: -.15, offset: .72 }, { opacity: 0, strokeDashoffset: -.3, offset: .84 }, { opacity: 0, strokeDashoffset: -.3 }], 1650, true), easing: "linear" },
      path("signal", [[2,12,0,0],[6,12,1,.16],[9,4,1,.28],[13,20,1,.44],[17,8,1,.6],[19,12,1,.7],[22,12,0,.8],[22,12,0,1]], 1650)],
    press: [flash("trace", 1, .38, 340), flash("trail", 1, 0, 340)],
  },
  Monitor: {
    hover: [alpha("picture", .8), sequence("progress", [{ transform: "scaleX(.05)", opacity: .9 }, { transform: "scaleX(1)", opacity: .9, offset: .78 }, { transform: "scaleX(1)", opacity: 0, offset: .9 }, { transform: "scaleX(.05)", opacity: 0 }], 2000, true)],
    press: [alpha("picture", 0, 120), ...[0,1,2,3].map((i) => sequence("bar" + i, [{ transform: `scaleY(${[.35,.85,.55,1][i]})`, opacity: .85, offset: .15 }, { transform: `scaleY(${[.9,.4,1,.55][i]})`, opacity: .85, offset: .55 }, { transform: "scaleY(.15)", opacity: 0 }], 650))],
  },
  LayoutGrid: {
    hover: [0,1,3,2].map((i, order) => pulse("tile" + i, .15, .85, 1800, order * 180)),
    press: [0,1,2,3].map((i) => sequence("tile" + i, [{ transform: `translate(${i % 2 ? 1 : -1}px,${i < 2 ? -1 : 1}px) scale(.8)`, opacity: 1, offset: .3 }, { transform: "none", opacity: .4 }], 380)),
  },
  Boxes: { hover: [shift("top", "translateY(-2.5px)"), shift("left", "translate(-1.8px,1.5px)", 300, 45), shift("right", "translate(1.8px,1.5px)", 300, 90)], press: [kick("top", "translateY(1px)", "translateY(-2.5px)"), kick("left", "translate(1px,-1px)", "translate(-1.8px,1.5px)"), kick("right", "translate(-1px,-1px)", "translate(1.8px,1.5px)")] },
  Upload: arrowFlow(-1), Download: arrowFlow(1), RefreshCw: turn("rotor", 90), RotateCw: turn("rotor", 55), RotateCcw: turn("rotor", -55),
  Settings2: { hover: [shift("upper", "translateX(6px)"), shift("lower", "translateX(-6px)", 330, 70)], press: [kick("upper", "translateX(-2px)", "translateX(6px)"), kick("lower", "translateX(2px)", "translateX(-6px)")] },
  SlidersHorizontal: { hover: [shift("knob0", "translateX(6px)"), shift("knob1", "translateX(-8px)", 300, 50), shift("knob2", "translateX(5px)", 300, 100)], press: [kick("knob0", "translateX(-2px)", "translateX(6px)"), kick("knob1", "translateX(2px)", "translateX(-8px)"), kick("knob2", "translateX(-3px)", "translateX(5px)")] },
  Trash2: { hover: [shift("lid", "translateY(-2px) rotate(-30deg)")], press: [kick("lid", "translateY(-3px) rotate(-42deg)", "translateY(-2px) rotate(-30deg)"), sequence("paper", [{ opacity: 1, transform: "translateY(-3px)", offset: .1 }, { opacity: 1, transform: "translateY(7px) scale(.7)", offset: .7 }, { opacity: 0, transform: "translateY(9px) scale(.5)" }], 450)] },
  Search: { hover: [shift("lens", "translate(1.4px,-1.4px) rotate(-8deg)"), alpha("glint", 1)], press: [sequence("focus", [{ transform: "scale(1.7)", opacity: .1, offset: .1 }, { transform: "scale(.8)", opacity: 1, offset: .55 }, { transform: "scale(1)", opacity: 0 }], 470)] },
  ScanSearch: { hover: [sequence("scan", [{ transform: "translateY(-1px)", opacity: 0 }, { transform: "translateY(0px)", opacity: 1, offset: .12 }, { transform: "translateY(10px)", opacity: 1, offset: .72 }, { transform: "translateY(11px)", opacity: 0, offset: .86 }, { transform: "translateY(-1px)", opacity: 0 }], 1500, true), alpha("lens", .55)], press: [kick("lens", "scale(1.2)", "none"), flash("scan")] },
  Wallet: { hover: [pose("card", { transform: "translateY(-2px)", opacity: 1 }), shift("clasp", "translateX(1.5px)")], press: [sequence("card", [{ transform: "translateY(-4px)", opacity: 1, offset: .35 }, { transform: "translateY(3px)", opacity: .3, offset: .7 }, { transform: "translateY(-2px)", opacity: 1 }], 520), kick("clasp", "translateX(3px)", "translateX(1.5px)")] },
  KeyRound: { hover: [shift("key", "rotate(-32deg)")], press: [kick("key", "rotate(25deg)", "rotate(-32deg)", 480)] },
  LogIn: { hover: [shift("arrow", "translateX(3px)"), alpha("door", .65)], press: [sequence("arrow", [{ transform: "translateX(8px)", opacity: 0, offset: .42 }, { transform: "translateX(-4px)", opacity: 0, offset: .43 }, { transform: "translateX(3px)", opacity: 1 }], 500)] },
  LogOut: { hover: [shift("arrow", "translateX(2px)"), alpha("door", .65)], press: [sequence("arrow", [{ transform: "translateX(7px)", opacity: 0, offset: .5 }, { transform: "translateX(-2px)", opacity: 0, offset: .51 }, { transform: "translateX(2px)", opacity: 1 }], 500)] },
  ExternalLink: arrow("translate(2px,-2px)", "translate(4px,-4px)"), ArrowUpRight: arrow("translate(2px,-2px)", "translate(4px,-4px)"), ArrowDownLeft: arrow("translate(-2px,2px)", "translate(-4px,4px)"),
  ArrowRightLeft: { hover: [shift("outbound", "translateX(2px)"), shift("inbound", "translateX(-2px)")], press: [kick("outbound", "translateX(-3px)", "translateX(2px)", 480), kick("inbound", "translateX(3px)", "translateX(-2px)", 480)] },
  ChevronRight: arrow("translateX(3px)", "translateX(5px)"), ChevronDown: arrow("translateY(3px)", "translateY(5px)"),
  Plus: { hover: [shift("horizontal", "scaleX(1.15)"), shift("vertical", "scaleY(1.15)")], press: [kick("horizontal", "rotate(90deg) scaleX(.7)", "rotate(180deg) scaleX(1.15)", 400), kick("vertical", "rotate(90deg) scaleY(.7)", "rotate(180deg) scaleY(1.15)", 400)] },
  X: { hover: [shift("first", "rotate(8deg) scale(1.12)"), shift("second", "rotate(-8deg) scale(1.12)")], press: [kick("first", "scale(.6)", "rotate(8deg) scale(1.12)", 300), kick("second", "scale(.6)", "rotate(-8deg) scale(1.12)", 300)] },
  Folder: { hover: [shift("front", "skewX(-9deg) scaleY(.78)"), alpha("paper", 1)], press: [kick("front", "skewX(-14deg) scaleY(.6)", "skewX(-9deg) scaleY(.78)"), kick("paper", "translateY(-3px)")] },
  Terminal: { hover: [shift("prompt", "translateX(1.5px)"), pulse("cursor", .1, 1, 1000), sequence("output", [{ opacity: 0, transform: "scaleX(.1)" }, { opacity: 1, transform: "scaleX(1)", offset: .45 }, { opacity: 1, transform: "scaleX(1)", offset: .8 }, { opacity: 0, transform: "scaleX(1)" }], 2000, true)], press: [kick("prompt", "translateX(4px)", "translateX(1.5px)"), flash("output")] },
  Play: { hover: [shift("play", "translateX(2px)"), alpha("wake", .7)], press: [kick("play", "translateX(4px) scale(.8)", "translateX(2px)"), flash("wake", 1, .7)] },
  Square: { hover: [alpha("fill", .35)], press: [sequence("fill", [{ opacity: 1, transform: "scale(.8)", offset: .3 }, { opacity: .35, transform: "none" }], 320)] },
  Power: { hover: [shift("switch", "translateY(2px)"), alpha("glow", .3)], press: [kick("switch", "translateY(4px)", "translateY(2px)"), flash("glow", .85, .3)] },
  Wrench: { hover: [shift("tool", "rotate(-25deg)")], press: [sequence("tool", [{ transform: "rotate(18deg)", offset: .4 }, { transform: "rotate(-30deg)", offset: .78 }, { transform: "rotate(-25deg)" }], 500)] },
  Zap: { hover: [alpha("charge", .3), pulse("spark", .25, 1, 1200)], press: [flash("charge", 1, .3, 400), sequence("spark", [{ transform: "scale(.85)", opacity: 1, offset: .1 }, { transform: "scale(1.8)", opacity: 0 }], 440)] },
  UserRound: { hover: [shift("head", "translateY(1.5px)"), shift("shoulders", "scaleX(1.08)")], press: [kick("head", "translateY(-1.5px)", "translateY(1.5px)", 460), kick("shoulders", "scaleX(.94)", "scaleX(1.08)")] },
  Unlink: { hover: [shift("upper", "translate(2px,-2px)"), shift("lower", "translate(-2px,2px)"), alpha("break", .5)], press: [kick("upper", "translate(4px,-4px)", "translate(2px,-2px)"), kick("lower", "translate(-4px,4px)", "translate(-2px,2px)")] },
  MoreHorizontal: { hover: [0,1,2].map((i) => sequence("dot"+i, [{ transform: "none" }, { transform: "translateY(-3px)", offset: .25 }, { transform: "none", offset: .5 }, { transform: "none" }], 1300, true, i*130)), press: [0,1,2].map((i) => kick("dot"+i, `translateX(${(1-i)*4}px)`, "none", 380)) },
  GripVertical: { hover: [0,1,2].flatMap((i) => [shift("left"+i, "translateX(-1.5px)", 260, i*35), shift("right"+i, "translateX(1.5px)", 260, i*35)]), press: [0,1,2].flatMap((i) => [kick("left"+i,"translateX(1px)","translateX(-1.5px)"), kick("right"+i,"translateX(-1px)","translateX(1.5px)")]) },
  Layers: { hover: [shift("top", "translateY(-2.5px)"), shift("bottom", "translateY(2px)")], press: [kick("top", "translateY(2px)", "translateY(-2.5px)"), kick("bottom", "translateY(-2px)", "translateY(2px)")] },
  Layers3: { hover: [shift("top", "translateY(-2.5px)"), shift("middle", "translateY(-.5px)", 300, 60), shift("bottom", "translateY(1.5px)", 300, 120)], press: [kick("top", "translateY(2px)", "translateY(-2.5px)"), kick("middle", "translateY(1px)", "translateY(-.5px)"), kick("bottom", "translateY(-2px)", "translateY(1.5px)")] },
  Network: { hover: [alpha("wires", .5), path("packet", [[0,0,0,0],[0,4,1,.25],[7,4,1,.55],[7,9,0,.72],[7,9,0,1]]), path("packetLeft", [[0,0,0,0],[0,4,1,.25],[-7,4,1,.55],[-7,9,0,.72],[-7,9,0,1]])], press: [kick("source", "scale(1.15)"), flash("wires", 1, .5)] },
  Check: check(), CheckCircle2: check("ring"), ShieldCheck: check("shield"),
  BellRing: { hover: [sequence("bell", [{ transform: "none" }, { transform: "rotate(-18deg)", offset: .12 }, { transform: "rotate(16deg)", offset: .24 }, { transform: "rotate(-8deg)", offset: .34 }, { transform: "none", offset: .45 }, { transform: "none" }], 1800, true), pulse("echo", .25, 1, 1800)], press: [kick("bell", "rotate(-25deg)"), flash("echo",1,.5)] },
  Info: { hover: [shift("stem", "scaleY(1.15)"), shift("dot", "translateY(-1px)")], press: [kick("dot", "translateY(2px)", "translateY(-1px)")] },
  AlertCircle: { hover: [shift("stem", "translateY(-1px)"), shift("dot", "scale(1.5)")], press: [kick("stem", "translateY(2px)", "translateY(-1px)")] },
  AlertTriangle: { hover: [shift("stem", "translateY(-1px)"), shift("dot", "scale(1.5)")], press: [kick("stem", "translateY(2px)", "translateY(-1px)")] },
  BrandOpenai: { hover: [{ ...sequence("orbit", [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], 3600, true), easing: "linear" }], press: [kick("orbit", "rotate(180deg) scale(.88)", "rotate(180deg)", 520)] },
  BrandAnthropic: { hover: [sequence("rays", [{ transform: "scale(.88)", opacity: .2 }, { transform: "scale(1.04)", opacity: 1, offset: .4 }, { transform: "scale(.88)", opacity: .2 }], 2000, true)], press: [kick("rays", "scale(1.25)", "scale(1)")] },
  BrandDeepseek: { hover: [sequence("wave0", [{ transform: "translateX(-2px)", opacity: .25 }, { transform: "translateX(2px)", opacity: 1, offset: .5 }, { transform: "translateX(-2px)", opacity: .25 }], 2200, true), sequence("wave1", [{ transform: "translateX(2px)", opacity: 1 }, { transform: "translateX(-2px)", opacity: .25, offset: .5 }, { transform: "translateX(2px)", opacity: 1 }], 2200, true)], press: [kick("wave0", "translateY(-2px)"), kick("wave1", "translateY(2px)")] },
  BrandOpencode: { hover: [pulse("cursor", .05, 1, 1100), sequence("line", [{ transform: "scaleX(.1)" }, { transform: "scaleX(1)", offset: .65 }, { transform: "scaleX(1)" }], 1900, true)], press: [kick("line", "translateY(-2px)", "none"), flash("cursor")] },
  BrandKimi: { hover: [shift("corners", "scale(1.1)"), sequence("scan", [{ transform: "translate(-3px,-3px)", opacity: 0 }, { transform: "none", opacity: .85, offset: .5 }, { transform: "translate(3px,3px)", opacity: 0 }], 1800, true)], press: [kick("corners", "scale(.88)", "scale(1.1)")] },
  BrandZai: { hover: [sequence("scan", [{ transform: "translateY(0px)", opacity: 0 }, { transform: "translateY(3px)", opacity: .8, offset: .2 }, { transform: "translateY(18px)", opacity: 0 }], 1700, true), alpha("corners", .6)], press: [kick("corners", "scale(.88)")] },
  BrandProvider: { hover: [shift("corners", "scale(1.08)"), pulse("dot", .3, 1, 1400)], press: [kick("corners", "scale(.82)", "scale(1.08)")] },
};
