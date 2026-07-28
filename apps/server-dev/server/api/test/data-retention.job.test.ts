/**
 * DataRetentionJob 单元测试 —— Mock Repository（覆盖 R-004 数据保留清理）
 *
 * 被测对象：server/api/modules/instance/data-retention.job.ts
 * 覆盖：
 *   - RETENTION_DAYS <= 0 → start() 返回 null（禁用自动清理，交由运维）
 *   - RETENTION_DAYS > 0 → start() 返回定时器句柄，stop() 清理
 *   - 重复 start() 不应创建新定时器（幂等）
 *
 * 不实际等待 cron 间隔（默认 24h），仅验证启停与禁用分支的控制流。
 */
import { describe, it, expect, vi } from 'vitest';
import { DataRetentionJob } from '../modules/instance/data-retention.job';
import type { QoderReportRepository } from '../../db';

function makeRepo(
  overrides: Partial<QoderReportRepository> = {},
): QoderReportRepository {
  return {
    create: vi.fn(),
    findLatestByInstance: vi.fn(),
    findAllLatest: vi.fn(),
    findHistoryByInstance: vi.fn(),
    findOfflineInstances: vi.fn(),
    softDeleteBefore: vi.fn().mockResolvedValue({ count: 0 }),
    ...overrides,
  } as QoderReportRepository;
}

describe('DataRetentionJob', () => {
  it('RETENTION_DAYS <= 0 时 start() 应返回 null 且不创建定时器（禁用自动清理）', () => {
    // Arrange
    const repo = makeRepo();
    const job = new DataRetentionJob({
      repo,
      retentionDays: 0,
      cronIntervalMs: 1000,
    });

    // Act
    const handle = job.start();

    // Assert
    expect(handle).toBeNull();
  });

  it('RETENTION_DAYS > 0 时 start() 应返回定时器句柄', () => {
    // Arrange
    const repo = makeRepo();
    const job = new DataRetentionJob({
      repo,
      retentionDays: 30,
      cronIntervalMs: 1000,
    });

    // Act
    const handle = job.start();

    // Assert
    expect(handle).not.toBeNull();
    // 清理：避免定时器泄漏影响后续测试
    job.stop();
  });

  it('重复 start() 应返回同一定时器句柄（幂等，不创建多个）', () => {
    // Arrange
    const repo = makeRepo();
    const job = new DataRetentionJob({
      repo,
      retentionDays: 30,
      cronIntervalMs: 1000,
    });

    // Act
    const h1 = job.start();
    const h2 = job.start();

    // Assert
    expect(h1).toBe(h2);
    job.stop();
  });

  it('stop() 后内部定时器应被清理，再次 start() 可重建', () => {
    // Arrange
    const repo = makeRepo();
    const job = new DataRetentionJob({
      repo,
      retentionDays: 30,
      cronIntervalMs: 1000,
    });
    const h1 = job.start();

    // Act
    job.stop();
    const h2 = job.start();

    // Assert：stop 后重建得到新句柄
    expect(h2).not.toBe(h1);
    expect(h2).not.toBeNull();
    job.stop();
  });
});
