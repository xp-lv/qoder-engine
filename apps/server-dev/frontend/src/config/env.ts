/**
 * 集中配置（配置即代码）。
 * API_BASE_URL 使用后端实现报告中的端口（3000），WS 路径 /ws。
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:3000';

export const config = {
  apiBaseUrl: API_BASE_URL,
  wsUrl: `${WS_BASE_URL}/ws`,
  /** WebSocket 重连参数（红队 R-004） */
  wsReconnect: {
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    multiplier: 2,
    maxAttempts: Infinity, // 监控系统需持续恢复，封顶间隔即可
  },
  /** 分页约束（红队 R-003：limit ∈ [1, 200]） */
  history: {
    defaultPage: 1,
    defaultLimit: 50,
    minLimit: 1,
    maxLimit: 200,
  },
} as const;

/** 把 limit 截断到合法区间 [1, 200]，返回截断后的值与是否被截断（C-01/R-003） */
export function clampLimit(limit: number): { value: number; clamped: boolean } {
  const { minLimit, maxLimit } = config.history;
  if (limit < minLimit) return { value: minLimit, clamped: true };
  if (limit > maxLimit) return { value: maxLimit, clamped: true };
  return { value: limit, clamped: false };
}
