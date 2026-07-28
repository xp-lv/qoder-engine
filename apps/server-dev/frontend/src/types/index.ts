/**
 * 前端核心类型定义——与后端契约（统一接口文档 §2）严格对齐。
 *
 * 解决兼容性待对齐项：
 *  - C-01/C-03：采用「服务端权威派生」方案，消费 status 消息与 effectiveStatus 字段。
 *  - C-03：历史类型独立 ReportRecord（含 id / createdAt），不复用 Instance。
 */
import type { QoderStatus } from './status';

/** 重新导出原始状态枚举，供组件直接从 '@/types' 引用 */
export type { QoderStatus } from './status';

/** 服务端派生的有效状态：原始 status 超过心跳阈值（30s）→ stale（离线） */
export type EffectiveStatus = QoderStatus | 'stale';

/** 实例最新状态（snapshot 数组元素 / report 单体，含服务端派生 effectiveStatus） */
export interface Instance {
  instanceId: string;
  hostname: string;
  qoderVersion: string;
  status: QoderStatus;
  effectiveStatus: EffectiveStatus;
  uptime: number | null;
  cpuUsage: number | null; // 0–100
  memUsage: number | null; // 0–100
  workspaceCount: number | null;
  reportedAt: string; // ISO8601
}

/** 历史记录条目（ReportDTO，独立于 Instance——C-03） */
export interface ReportRecord {
  id: number;
  instanceId: string;
  hostname: string;
  qoderVersion: string;
  status: QoderStatus;
  uptime: number | null;
  cpuUsage: number | null;
  memUsage: number | null;
  workspaceCount: number | null;
  reportedAt: string; // ISO8601
  createdAt: string; // ISO8601 服务器接收时间
}

/** GET /api/instances/:id/history 响应（HistoryPageDTO） */
export interface HistoryResponse {
  items: ReportRecord[];
  total: number;
  page: number;
}

/** 后端统一错误信封 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** WS status 消息载荷（统一接口文档 §2.4，effectiveStatus 变化通知） */
export interface StatusMessageData {
  instanceId: string;
  effectiveStatus: EffectiveStatus;
  reportedAt: string;
}

/** WebSocket 入站消息联合类型（消费后端 snapshot / report / status 三类消息——C-01） */
export type WsMessage =
  | { type: 'snapshot'; data: Instance[] }
  | { type: 'report'; data: Instance }
  | { type: 'status'; data: StatusMessageData };

/** 历史查询分页参数（前端约束 limit ∈ [1, 200]——R-003） */
export interface HistoryQuery {
  page: number;
  limit: number;
}
