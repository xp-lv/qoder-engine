/**
 * StaleDetectorJob —— 后台离线检测任务（解决红队 R-002）
 *
 * 后端设计 §4.4：每 intervalMs 扫描一次全部实例最新上报；
 * 当实例最近上报时间超过阈值（跨过阈值进入 stale，或新上报恢复）导致 effectiveStatus 变化时，
 * 发布 instance.stale-changed 事件 → RealtimeGateway 广播 {type:"status"} 消息。
 *
 * 派生状态不入库、不改 DB 枚举，纯服务器端计算。
 */
import type { QoderReportRepository } from '../../../db';
import type { IEventBus } from '../../shared/events/event-bus';
import { EventTopic } from '../../shared/events/event-bus';
import type { EffectiveStatus, QoderStatus } from '../../shared/types/status';
import { isQoderStatus } from '../../shared/types/status';
import { logger } from '../../shared/logger';

/**
 * 状态码字符串 → QoderStatus（防御未知值，与 InstanceService.toInstanceDTO 一致）
 *
 * 保证离线检测派生的 effectiveStatus 与 InstanceService 口径一致：
 * 未超阈值时取实例真实状态（running/idle/error），而非硬编码 running。
 */
function toQoderStatus(raw: string): QoderStatus {
  return isQoderStatus(raw) ? raw : 'error';
}

export interface StaleDetectorDeps {
  repo: QoderReportRepository;
  eventBus: IEventBus;
  /** 离线检测阈值 ms（默认 30_000） */
  thresholdMs: number;
  /** 扫描间隔 ms（默认 10_000） */
  intervalMs: number;
}

export class StaleDetectorJob {
  private timer: NodeJS.Timeout | null = null;
  /** 记录上次派生的 effectiveStatus，仅状态变化时发布事件 */
  private readonly lastStatus = new Map<string, EffectiveStatus>();

  constructor(private readonly deps: StaleDetectorDeps) {}

  /** 启动后台定时扫描，返回定时器句柄 */
  start(): NodeJS.Timeout {
    if (this.timer) {
      return this.timer;
    }
    this.timer = setInterval(() => {
      this.tick().catch((e) =>
        logger.error({ err: e }, '离线检测扫描异常'),
      );
    }, this.deps.intervalMs);
    return this.timer;
  }

  /** 停止后台扫描 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 单次扫描：检测 effectiveStatus 变化并发布事件 */
  private async tick(): Promise<void> {
    const rows = await this.deps.repo.findAllLatest();
    const now = Date.now();
    const currentIds = new Set<string>();

    for (const row of rows) {
      currentIds.add(row.instanceId);
      const effectiveStatus = this.computeEffective(
        row.reportedAt.getTime(),
        now,
        row.status,
      );
      this.maybePublishChange(row.instanceId, effectiveStatus, row.reportedAt.toISOString());
    }

    // 对已消失实例（软删除等）清理状态缓存
    this.cleanupStaleCache(currentIds);
  }

  /**
   * 计算单个实例的派生 effectiveStatus
   *
   * 超过心跳阈值未上报 → "stale"；
   * 否则取实例真实上报状态（running/idle/error），与 InstanceService.toInstanceDTO 口径一致。
   */
  private computeEffective(
    reportedAtMs: number,
    now: number,
    rawStatus: string,
  ): EffectiveStatus {
    if (now - reportedAtMs > this.deps.thresholdMs) {
      return 'stale';
    }
    return toQoderStatus(rawStatus);
  }

  /** 仅在 effectiveStatus 变化时发布 instance.stale-changed 事件 */
  private maybePublishChange(
    instanceId: string,
    current: EffectiveStatus,
    reportedAt: string,
  ): void {
    const prev = this.lastStatus.get(instanceId);
    if (prev === current) {
      return;
    }
    this.lastStatus.set(instanceId, current);
    // 首次发现不视为「变化」（避免启动风暴），仅在后续变化时推送
    if (prev === undefined) {
      return;
    }
    this.deps.eventBus.publish(EventTopic.INSTANCE_STALE_CHANGED, {
      instanceId,
      effectiveStatus: current,
      reportedAt,
    });
  }

  /** 清理已消失实例的状态缓存 */
  private cleanupStaleCache(currentIds: Set<string>): void {
    for (const id of this.lastStatus.keys()) {
      if (!currentIds.has(id)) {
        this.lastStatus.delete(id);
      }
    }
  }
}
