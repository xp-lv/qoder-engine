/**
 * ReportService —— 报告领域业务逻辑（依赖倒置 + Result 类型）
 *
 * 遵循质量原则第 2 原则：依赖抽象接口（QoderReportRepository / IEventBus），不直接 import Prisma 实现。
 * 遵循质量红线：Service 不返回 HTTP 状态码，返回 Result<T, AppError>；不直接操作数据库（通过 Repository 接口）。
 *
 * 职责：接收 Ext 上报 → 持久化（append-only）→ 发布领域事件（解耦实时推送）。
 *
 * 错误处理（质量原则第 5 原则）：
 * - 业务错误用 Result 表达（本接口持久化路径无业务可失败分支——字段校验已由 Controller 前置 zod 完成，
 *   故正常路径恒返回 ok）；
 * - 系统异常（DB 连接失败/约束冲突等）以 throw 形式自然上抛，由 asyncHandler → 全局 errorHandler 统一兜底
 *   （记录完整堆栈 + 返回脱敏 500 INTERNAL_ERROR，绝不向客户端泄露内部细节）。
 */
import type { QoderReportRepository } from '../../../db';
import type { IEventBus } from '../../shared/events/event-bus';
import { EventTopic } from '../../shared/events/event-bus';
import type { AppError } from '../../shared/types/errors';
import { ok, type Result } from '../../shared/types/result';
import type { CreateReportDTO } from './report.dto';

/** Report 领域服务抽象接口（Controller 依赖此接口） */
export interface IReportService {
  /** 接收并持久化一条上报 */
  ingest(input: CreateReportDTO): Promise<Result<{ id: number }, AppError>>;
}

export class ReportService implements IReportService {
  constructor(
    /** 依赖抽象：数据层 Repository 接口（非 Prisma 实现类） */
    private readonly repo: QoderReportRepository,
    /** 进程内事件总线（解耦 report → instance 实时推送） */
    private readonly eventBus: IEventBus,
  ) {}

  async ingest(
    input: CreateReportDTO,
  ): Promise<Result<{ id: number }, AppError>> {
    // 1. 持久化（append-only）；status code → status_id 映射由 Repository 层完成
    //    系统异常（DB 连接失败等）自然 throw，由全局 errorHandler 兜底脱敏（质量原则第 5），
    //    绝不在此处 catch 包装为带 details 的 AppError（避免泄露表名/SQL/连接串等内部信息，红队 BI-001）。
    const saved = await this.repo.create({
      instanceId: input.instanceId,
      hostname: input.hostname,
      qoderVersion: input.qoderVersion,
      status: input.status,
      uptime: input.uptime ?? null,
      cpuUsage: input.cpuUsage ?? null,
      memUsage: input.memUsage ?? null,
      workspaceCount: input.workspaceCount ?? null,
      reportedAt: new Date(input.reportedAt),
    });

    // 2. 发布领域事件：report 不关心谁在听（instance 领域订阅以驱动实时推送）
    this.eventBus.publish(EventTopic.REPORT_RECEIVED, {
      instanceId: input.instanceId,
      reportId: saved.id,
      createdAt: saved.createdAt,
    });

    return ok({ id: saved.id });
  }
}
