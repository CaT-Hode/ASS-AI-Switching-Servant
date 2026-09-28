import React, { forwardRef } from "react";
import { iconArt } from "./icon-art.mjs";
export { Loader2 } from "lucide-react";

const aliases = { Settings2: "settings2", Trash2: "trash2", MoreHorizontal: "ellipsis", Layers3: "layers-3", CheckCircle2: "circle-check", AlertCircle: "circle-alert", AlertTriangle: "triangle-alert" };
const draw = ([tag, attrs, children], key) => React.createElement(tag, { ...attrs, key }, children?.map(draw));
function icon(name) {
  const content = iconArt[name].map(draw);
  const className = aliases[name] || name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const Component = forwardRef(({ size = 24, strokeWidth = 2, absoluteStrokeWidth, color = "currentColor", className: extra = "", children, ...props }, ref) =>
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" className={`lucide lucide-${className} ass-icon ${extra}`} data-motion-icon={name} {...props}>{content}{children}</svg>);
  Component.displayName = name;
  return Component;
}
export const Activity = icon("Activity"), Monitor = icon("Monitor"), LayoutGrid = icon("LayoutGrid"), Boxes = icon("Boxes"),
  Upload = icon("Upload"), Download = icon("Download"), RefreshCw = icon("RefreshCw"), RotateCw = icon("RotateCw"), RotateCcw = icon("RotateCcw"),
  Settings2 = icon("Settings2"), SlidersHorizontal = icon("SlidersHorizontal"), Trash2 = icon("Trash2"), Search = icon("Search"), ScanSearch = icon("ScanSearch"),
  Wallet = icon("Wallet"), KeyRound = icon("KeyRound"), LogIn = icon("LogIn"), LogOut = icon("LogOut"), ExternalLink = icon("ExternalLink"), ArrowRightLeft = icon("ArrowRightLeft"),
  ArrowUpRight = icon("ArrowUpRight"), ArrowDownLeft = icon("ArrowDownLeft"), ChevronRight = icon("ChevronRight"), ChevronDown = icon("ChevronDown"),
  Plus = icon("Plus"), X = icon("X"), Folder = icon("Folder"), Terminal = icon("Terminal"), Play = icon("Play"), Square = icon("Square"), Power = icon("Power"),
  Wrench = icon("Wrench"), Zap = icon("Zap"), UserRound = icon("UserRound"), Unlink = icon("Unlink"), MoreHorizontal = icon("MoreHorizontal"), GripVertical = icon("GripVertical"),
  Layers = icon("Layers"), Layers3 = icon("Layers3"), Network = icon("Network"), Check = icon("Check"), CheckCircle2 = icon("CheckCircle2"), ShieldCheck = icon("ShieldCheck"),
  BellRing = icon("BellRing"), Info = icon("Info"), AlertCircle = icon("AlertCircle"), AlertTriangle = icon("AlertTriangle");
