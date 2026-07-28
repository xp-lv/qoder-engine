/**
 * DataRetentionJob —— 后台数据保留清理任务（解决红队 R-004）
 *
 * 后端设计 §4.5：append-only 模型在 100 实例 × 6 次/分场景下约 86.4 万条/天，
 * 无清理将导致历史查询退化与磁盘耗尽。本任务周期性软删除保留窗口外的明细记录。
 *
 * 清理策略（统一接口文档 C-02 决策：统一为软删除方案）：
 * - 默认保留最近 30 天明细（RETENTION_DAYS=30），超期按 reportedAt 软删除（设置 deletedAt）；
 * - 通过 QoderReportRepository.softDeleteBefore 抽象接口调用（依赖倒置），不直接操作 Prisma；
 * - RETENTION_DAYS=0 表示禁用自动清理（交由运维手动管理），任务跳过执行并打印告警日志。
 *
 * 依赖抽象接口（依赖倒置），具体 SQL/索引由数据层配合。
 */
import type { QoderReportRepository } from '../../../db';
import { logger } from '../../shared/logger';

export interface DataRetentionDeps {
  /** 数据层 Repository 接口（非 Prisma 实现类） */
  repo: QoderReportRepository;
  /** 保留天数（0 = 禁用自动清理，交由运维手动管理） */
  retentionDays: number;
  /** 扫描间隔 ms（默认每日一次 = 24 * 60 * 60 * 1000） */
  cronIntervalMs: number;
}

export class DataRetentionJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DataRetentionDeps) {}

  /** 启动后台定时清理，返回定时器句柄；RETENTION_DAYS<=0 时禁用并返回 null */
  start(): NodeJS.Timeout | null {
    // 可关闭：RETENTION_DAYS=0 表示禁用自动清理（交由运维手动管理）
    if (this.deps.retentionDays <= 0) {
      logger.warn(
        { retentionDays: this.deps.retentionDays },
        '数据保留清理已禁用（RETENTION_DAYS<=0），交由运维手动管理。append-only 表将无限增长，请定期运维清理。',
      );
      return null;
    }
    if (this.timer) {
      return this.timer;
    }
    this.timer = setInterval(() => {
      this.tick().catch((e) =>
        logger.error({ err: e }, '数据保留清理异常'),
      );
    }, this.deps.cronIntervalMs);
    return this.timer;
  }

  /** 停止后台清理 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 单次清理：软删除保留窗口外的记录（设置 deletedAt） */
  private async tick(): Promise<void> {
    const before = new Date(
      Date.now() - this.deps.retentionDays * 24 * 60 * 60 * 1000,
    );
    const { count } = await this.deps.repo.softDeleteBefore(before);
    logger.info(
      { deleted: count, retentionDays: this.deps.retentionDays, before: before.toISOString() },
      '数据保留清理完成',
    );
  }
}
