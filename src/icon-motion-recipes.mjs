export const easeOut = "cubic-bezier(0.23, 1, 0.32, 1)";
export const easeInOut = "cubic-bezier(0.77, 0, 0.175, 1)";
const track = (part, frames, duration = 280, delay = 0, easing = easeInOut) => ({ part, frames, duration, delay, easing });
const move = (part, transform, duration = 280, delay = 0) => track(part, [{ transform: "none" }, { transform, offset: .45 }, { transform: "none" }], duration, delay);
const glow = (part, peak = .3, duration = 280, delay = 0) => track(part, [{ opacity: 0 }, { opacity: peak, offset: .35 }, { opacity: 0 }], duration, delay);
const fade = (part, opacity = .5, duration = 280, delay = 0) => track(part, [{ opacity: 1 }, { opacity, offset: .4 }, { opacity: 1 }], duration, delay);
const flow = (delta) => [move("arrow", `translateY(${delta}px)`, 280), glow("edge", .8, 220, 50)];
const tick = () => [track("tick", [{ opacity: 1, transform: "none" }, { opacity: .35, transform: "translate(-1px, 1px)" }, { opacity: 1, transform: "none" }], 240)];

// Only the tiny ECG/display illustrations use a longer single pass. Buttons
// respond immediately; no navigation, network operation or confirmation waits.
export const iconMotion = {
  Activity: [fade("trace", .35, 560), track("signal", [
    { transform: "translate(2px,12px)", opacity: 0 }, { transform: "translate(6px,12px)", opacity: 1, offset: .2 },
    { transform: "translate(9px,4px)", opacity: 1, offset: .35 }, { transform: "translate(13px,20px)", opacity: 1, offset: .55 },
    { transform: "translate(17px,8px)", opacity: 1, offset: .75 }, { transform: "translate(19px,12px)", opacity: 1, offset: .88 },
    { transform: "translate(22px,12px)", opacity: 0 }], 560, 0, "linear")],
  Monitor: [glow("picture", 1, 480), track("progress", [
    { transform: "scaleX(.1)", opacity: 0 }, { transform: "scaleX(.2)", opacity: .65, offset: .16 },
    { transform: "scaleX(1)", opacity: .65, offset: .85 }, { transform: "scaleX(1)", opacity: 0 }], 480, 0, "linear")],
  LayoutGrid: [0, 1, 3, 2].map((i, order) => glow("tile" + i, .32, 180, order * 32)),
  Boxes: [move("top", "translateY(1.2px)", 240), move("left", "translate(.6px,-.6px)", 220, 30), move("right", "translate(-.6px,-.6px)", 220, 60)],
  Upload: flow(-2.5), Download: flow(2.5),
  RefreshCw: [track("rotor", [{ transform: "rotate(0deg)" }, { transform: "rotate(180deg)" }], 280, 0, easeOut)],
  RotateCw: [track("rotor", [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], 280, 0, easeOut)],
  RotateCcw: [track("rotor", [{ transform: "rotate(0deg)" }, { transform: "rotate(-360deg)" }], 280, 0, easeOut)],
  Settings2: [move("upper", "translateX(5px)"), move("lower", "translateX(-5px)")],
  SlidersHorizontal: [move("knob0", "translateX(4px)", 250), move("knob1", "translateX(-5px)", 250, 15), move("knob2", "translateX(3px)", 250, 30)],
  Trash2: [move("lid", "translateY(-1.5px) rotate(-14deg)")],
  Search: [move("lens", "translate(-.8px,-.8px)"), glow("glint", .8)],
  ScanSearch: [track("scan", [{ transform: "translateY(0px)", opacity: 0 }, { transform: "translateY(1px)", opacity: .8, offset: .15 }, { transform: "translateY(10px)", opacity: 0 }], 280, 0, "linear"), fade("lens", .55)],
  Wallet: [track("card", [{ transform: "translateY(3px)", opacity: 0 }, { transform: "translateY(0px)", opacity: .7, offset: .45 }, { transform: "translateY(3px)", opacity: 0 }]), move("clasp", "translateX(1px)")],
  KeyRound: [move("key", "rotate(-18deg)")],
  LogIn: [move("arrow", "translateX(2.5px)"), fade("door", .6)], LogOut: [move("arrow", "translateX(2.5px)"), fade("door", .35)],
  ExternalLink: [move("arrow", "translate(1.5px,-1.5px)")],
  ArrowRightLeft: [move("outbound", "translateX(2px)"), move("inbound", "translateX(-2px)", 240, 40)],
  ArrowUpRight: [move("arrow", "translate(1.5px,-1.5px)")], ArrowDownLeft: [move("arrow", "translate(-1.5px,1.5px)")],
  ChevronRight: [move("arrow", "translateX(1.5px)", 180)], ChevronDown: [move("arrow", "translateY(1.5px)", 180)],
  Plus: [move("horizontal", "scaleX(.7)", 200), move("vertical", "scaleY(.7)", 200, 40)],
  X: [move("first", "scale(.82)", 180), move("second", "scale(.82)", 180, 30)],
  Folder: [move("front", "skewX(-5deg) scaleY(.88)"), glow("paper", .75)],
  Terminal: [move("prompt", "translateX(1.5px)", 240), fade("cursor", .05, 180, 60), glow("output", .7, 200, 80)],
  Play: [move("play", "translateX(1.4px)", 220), glow("wake", .45, 220)],
  Square: [glow("fill", .18, 160)], Power: [move("switch", "translateY(1.5px)", 220), glow("glow", .12, 260)],
  Wrench: [track("tool", [{ transform: "rotate(0deg)" }, { transform: "rotate(-13deg)", offset: .35 }, { transform: "rotate(5deg)", offset: .75 }, { transform: "rotate(0deg)" }])],
  Zap: [fade("bolt", .4, 160), glow("spark", .8, 240)],
  UserRound: [move("head", "translateY(.7px)", 220), fade("shoulders", .6, 260)],
  Unlink: [move("upper", "translate(1px,-1px)"), move("lower", "translate(-1px,1px)"), fade("break", .3)],
  MoreHorizontal: [0, 1, 2].map((i) => move("dot" + i, "translateY(-2px)", 180, i * 40)),
  GripVertical: [0, 1, 2].flatMap((i) => [move("left" + i, "translateX(-.8px)", 190, i * 30), move("right" + i, "translateX(.8px)", 190, i * 30)]),
  Layers: [move("top", "translateY(-1px)"), move("bottom", "translateY(1px)")],
  Layers3: [move("top", "translateY(1px)", 220), move("middle", "translateY(.7px)", 220, 30), fade("bottom", .45, 220, 60)],
  Network: [track("packet", [{ transform: "translate(0px,0px)", opacity: 0 }, { transform: "translate(0px,4px)", opacity: 1, offset: .35 }, { transform: "translate(7px,4px)", opacity: 1, offset: .8 }, { transform: "translate(7px,8px)", opacity: 0 }], 280, 0, "linear"), fade("source", .5, 180), fade("left", .4, 180, 50), fade("right", .4, 180, 100)],
  Check: tick(), CheckCircle2: [...tick(), fade("ring", .7)], ShieldCheck: [...tick(), fade("shield", .7)],
  BellRing: [track("bell", [{ transform: "rotate(0deg)" }, { transform: "rotate(-12deg)", offset: .2 }, { transform: "rotate(10deg)", offset: .5 }, { transform: "rotate(-4deg)", offset: .8 }, { transform: "rotate(0deg)" }]), track("echo", [{ opacity: .5 }, { opacity: 1 }, { opacity: .5 }])],
  Info: [fade("dot", .2, 200)], AlertCircle: [fade("dot", .35, 200)], AlertTriangle: [fade("dot", .35, 220)],
};
