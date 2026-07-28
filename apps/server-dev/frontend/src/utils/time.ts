/**
 * 时间格式化工具。
 * 后端 reportedAt / createdAt 均为 ISO8601（UTC 存储）。
 */

/** 解析 ISO8601 为时间戳（毫秒），失败返回 NaN */
export function parseIsoToTs(iso: string): number {
  const ts = Date.parse(iso);
  return ts;
}

/** 把秒数格式化为人类可读时长，如 "2h 3m"、"5m 10s"、"45s" */
export function formatUptime(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  if (seconds < 0) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** 把 ISO8601 格式化为本地时间 "YYYY-MM-DD HH:mm:ss" */
export function formatDateTime(iso: string): string {
  const ts = parseIsoToTs(iso);
  if (Number.isNaN(ts)) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 计算 reportedAt 距今的相对时间文案，如 "刚刚"、"3s 前"、"2m 前"、"1h 前" */
export function formatRelative(iso: string, nowTs: number = Date.now()): string {
  const ts = parseIsoToTs(iso);
  if (Number.isNaN(ts)) return '—';
  const diff = Math.max(0, nowTs - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return '刚刚';
  if (sec < 60) return `${sec}s 前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m 前`;
  const hr = Math.floor(min / 60);
  return `${hr}h 前`;
}
