export function relativeTime(value, now = Date.now()) {
  const elapsed = now - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "时间未知";
  if (elapsed < -60000) return "时间异常";
  if (elapsed < 60000) return "刚刚";
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前`;
  return `${Math.floor(elapsed / 86400000)} 天前`;
}

export function exactTime(value) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "时间未知";
  return time.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
