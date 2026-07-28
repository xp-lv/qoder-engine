/**
 * 共享状态枚举类型 —— 跨领域共享（modules → shared，绝不反向）
 *
 * 来源：后端设计 §2.2.1 / 统一接口文档 §2。
 * QoderStatus 为 Ext 上报的原始状态（字符串，与 report_status 查找表 code 对齐）；
 * EffectiveStatus 为服务器端派生（追加 stale，解决红队 R-002）。
 */

/** Ext 上报的原始运行状态（与 report_status.code 一致） */
export type QoderStatus = 'running' | 'idle' | 'error';

/** 服务器端派生状态：超过心跳阈值未上报 → "stale"（不入库、不改 DB 枚举） */
export type EffectiveStatus = QoderStatus | 'stale';

/** 状态码白名单（用于运行时断言/校验） */
export const QODER_STATUS_VALUES: readonly QoderStatus[] = [
  'running',
  'idle',
  'error',
] as const;

/**
 * 类型守卫：字符串是否为合法 QoderStatus
 */
export function isQoderStatus(value: string): value is QoderStatus {
  return (QODER_STATUS_VALUES as readonly string[]).includes(value);
}
