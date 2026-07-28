/**
 * InstanceService —— 实例领域业务逻辑（依赖倒置 + Result + effectiveStatus 派生）
 *
 * 遵循质量原则第 2 原则：依赖 QoderReportRepository 抽象接口（数据层），不直接 import Prisma 实现。
 * 遵循质量红线：Service 不返回 HTTP 状态码，返回 Result；不直接操作数据库。
 *
 * 解决红队 R-002：在服务器端派生 effectiveStatus（超过心跳阈值未上报 → "stale"），
 * 不入库、不改 DB 枚举，纯计算；通过 REST effectiveStatus 字段 + WS status 消息对外暴露。
 *
 * 系统异常（DB 连接失败等）以 throw 形式上抛，由全局错误中间件兜底（质量原则第 5 原则）。
 */
import type { QoderReport, QoderReportRepository } from '../../../db';
import type { AppError } from '../../shared/types/errors';
import { ErrorCode } from '../../shared/types/errors';
import { err, ok, type Result } from '../../shared/types/result';
import type {
  EffectiveStatus,
  QoderStatus,
} from '../../shared/types/status';
import { isQoderStatus } from '../../shared/types/status';
import type { HistoryPageDTO, InstanceDTO, ReportDTO } from './instance.dto';

/** Instance 领域服务抽象接口（Controller / Gateway 依赖此接口） */
export interface IInstanceService {
  /** 全量实例最新状态（HTTP 兜底 + WS snapshot） */
  listLatest(): Promise<InstanceDTO[]>;
  /** 某实例最新状态（WS report 推送用） */
  getLatest(instanceId: string): Promise<InstanceDTO | null>;
  /** 某实例历史上报（分页倒序） */
  getHistory(
    instanceId: string,
    page: number,
    limit: number,
  ): Promise<Result<HistoryPageDTO, AppError>>;
}

export class InstanceService implements IInstanceService {
  constructor(
    /** 依赖抽象：数据层 Repository 接口（非 Prisma 实现类） */
    private readonly repo: QoderReportRepository,
    /** 离线检测阈值（默认 30_000ms，解决 R-002） */
    private readonly staleThresholdMs: number,
  ) {}

  async listLatest(): Promise<InstanceDTO[]> {
    const rows = await this.repo.findAllLatest();
    const now = Date.now();
    return rows.map((r) => this.toInstanceDTO(r, now));
  }

  async getLatest(instanceId: string): Promise<InstanceDTO | null> {
    const row = await this.repo.findLatestByInstance(instanceId);
    if (!row) {
      return null;
    }
    return this.toInstanceDTO(row, Date.now());
  }

  async getHistory(
    instanceId: string,
    page: number,
    limit: number,
  ): Promise<Result<HistoryPageDTO, AppError>> {
    // ★ R-001 决策（后端设计 §2.4 + 统一接口文档 §2.3）：删除 404 分支。
    // 无论 instanceId 是否曾上报过，统一返回 200；从未上报或当前页越界页 → { items: [], total, page }。
    // 分页参数二次防御（中间件已拦截 limit ∈ [1,200]，此处兜底直接调用场景）。
    if (page < 1 || limit < 1 || limit > 200) {
      return err({
        code: ErrorCode.QUERY_VALIDATION_ERROR,
        message: '分页参数越界（page ≥ 1，limit ∈ [1, 200]）',
      });
    }

    const { items, total } = await this.repo.findHistoryByInstance(
      instanceId,
      page,
      limit,
    );

    return ok({
      items: items.map(toReportDTO),
      total,
      page,
    });
  }

  /**
   * 领域实体 → InstanceDTO（派生 effectiveStatus）
   *
   * 超过心跳阈值未上报 → effectiveStatus = "stale"（不改 DB 枚举，纯计算）。
   */
  private toInstanceDTO(row: QoderReport, now: number): InstanceDTO {
    const status = toQoderStatus(row.status);
    const isStale = now - row.reportedAt.getTime() > this.staleThresholdMs;
    const effectiveStatus: EffectiveStatus = isStale ? 'stale' : status;
    return {
      instanceId: row.instanceId,
      hostname: row.hostname,
      qoderVersion: row.qoderVersion,
      status,
      effectiveStatus,
      uptime: row.uptime,
      cpuUsage: row.cpuUsage,
      memUsage: row.memUsage,
      workspaceCount: row.workspaceCount,
      reportedAt: row.reportedAt.toISOString(),
    };
  }
}

/** 领域实体 → ReportDTO（历史记录条目） */
function toReportDTO(row: QoderReport): ReportDTO {
  return {
    id: row.id,
    instanceId: row.instanceId,
    hostname: row.hostname,
    qoderVersion: row.qoderVersion,
    status: toQoderStatus(row.status),
    uptime: row.uptime,
    cpuUsage: row.cpuUsage,
    memUsage: row.memUsage,
    workspaceCount: row.workspaceCount,
    reportedAt: row.reportedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** 状态码字符串 → QoderStatus（防御未知值） */
function toQoderStatus(raw: string): QoderStatus {
  return isQoderStatus(raw) ? raw : 'error';
}
