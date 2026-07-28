/**
 * Instance 领域 DTO + zod schema —— 遵循质量原则第 3 原则（DTO 与领域模型分离）
 *
 * 来源：后端设计 §2.2.2/§2.2.3/§2.2.4 / 统一接口文档 §2.2/§2.3。
 */
import { z } from 'zod';
import type { EffectiveStatus, QoderStatus } from '../../shared/types/status';

/** 历史记录条目（ReportDTO，统一接口文档 §2.3） */
export interface ReportDTO {
  id: number;
  instanceId: string;
  hostname: string;
  qoderVersion: string;
  status: QoderStatus; // 原始上报状态
  uptime: number | null;
  cpuUsage: number | null;
  memUsage: number | null;
  workspaceCount: number | null;
  reportedAt: string; // ISO8601（Ext 上报时间）
  createdAt: string; // ISO8601（服务器接收时间）
}

/** 实例最新状态（含服务器派生 effectiveStatus，统一接口文档 §2.2） */
export interface InstanceDTO {
  instanceId: string;
  hostname: string;
  qoderVersion: string;
  status: QoderStatus; // 最近一次上报的原始 status
  effectiveStatus: EffectiveStatus; // 派生：超过心跳阈值 → "stale"
  uptime: number | null;
  cpuUsage: number | null;
  memUsage: number | null;
  workspaceCount: number | null;
  reportedAt: string; // 最近一次上报时间
}

/** 历史分页响应（HistoryPageDTO，统一接口文档 §2.3） */
export interface HistoryPageDTO {
  items: ReportDTO[];
  total: number; // 该实例历史记录总数
  page: number; // 当前页码
}

/**
 * 历史查询参数 zod schema（响应红队 R-003）
 *
 * - page：整数 ≥ 1，默认 1
 * - limit：整数 ∈ [1, 200]，默认 50，超出 → 400 QUERY_VALIDATION_ERROR
 *
 * 使用 coerce 将 query string 自动转为数字。
 */
export const historyQuerySchema = z.object({
  page: z.coerce.number().int('page 必须是整数').min(1, 'page 必须 ≥ 1').default(1),
  limit: z
    .coerce.number()
    .int('limit 必须是整数')
    .min(1, 'limit 必须 ≥ 1')
    .max(200, 'limit 必须 ≤ 200')
    .default(50),
});
