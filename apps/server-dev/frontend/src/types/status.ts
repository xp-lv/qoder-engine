/** qoder 运行状态枚举（与后端 report_status.code 一致） */
export type QoderStatus = 'running' | 'idle' | 'error';

/** QoderStatus 类型守卫 */
export function isQoderStatus(value: unknown): value is QoderStatus {
  return value === 'running' || value === 'idle' || value === 'error';
}
