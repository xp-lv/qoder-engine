/**
 * Report 领域 DTO + zod schema —— 遵循质量原则第 3 原则（接口即契约 → DTO 与领域模型分离）
 *
 * 来源：后端设计 §2.2.1 / 统一接口文档 §2.1。
 * CreateReportDTO 是 POST /api/reports 的请求体契约（对外契约，与 Prisma Model 解耦）。
 */
import { z } from 'zod';
import type { QoderStatus } from '../../shared/types/status';

/** POST /api/reports 请求体契约 */
export interface CreateReportDTO {
  instanceId: string; // UUID，必填；同一 qoder 安装固定不变
  hostname: string; // 必填，长度 ≤ 255
  qoderVersion: string; // 必填，长度 ≤ 50（如 "1.4.0"）
  status: QoderStatus; // 必填，枚举
  uptime?: number | null; // 可选，≥ 0（秒）
  cpuUsage?: number | null; // 可选，0–100（%）
  memUsage?: number | null; // 可选，0–100（%）
  workspaceCount?: number | null; // 可选，≥ 0
  reportedAt: string; // 必填，ISO8601（Ext 端上报时间）
}

/**
 * zod 校验 schema（统一接口文档 §7）
 *
 * - 缺 instanceId / 非法 status / 数值越界 / 非法 ISO8601 → 422 VALIDATION_ERROR
 * - 数值可空字段允许 null 或缺失
 */
export const createReportSchema = z.object({
  instanceId: z
    .string()
    .length(36, 'instanceId 必须是 36 字符 UUID'),
  hostname: z.string().min(1).max(255),
  qoderVersion: z.string().min(1).max(50),
  status: z.enum(['running', 'idle', 'error']),
  uptime: z.number().nonnegative().nullable().optional(),
  cpuUsage: z.number().min(0).max(100).nullable().optional(),
  memUsage: z.number().min(0).max(100).nullable().optional(),
  workspaceCount: z.number().nonnegative().nullable().optional(),
  reportedAt: z.string().datetime({ message: 'reportedAt 必须是合法 ISO8601 字符串' }),
});
