/**
 * ReportService 单元测试 —— Mock Repository + Mock EventBus（质量原则第 2/5 原则）
 *
 * 被测对象：server/api/modules/report/report.service.ts → ReportService.ingest
 * 覆盖：
 *   - 正常路径：有效上报持久化 → 返回 ok({id}) + 发布 report.received 事件
 *   - 可空字段归一化：缺失的可空字段传入 Repository 时为 null
 *   - 依赖失败：Repository 系统异常自然上抛（不被 catch 包装为业务错误，红队 BI-001）
 *   - 边界：status=error 原样透传
 *
 * Service 经类型导入依赖 QoderReportRepository 接口（不触发 Prisma 运行时加载），
 * 测试用 vi.fn() 构造 Mock Repository，隔离业务逻辑（质量原则第 5：Mock 适度）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportService } from '../modules/report/report.service';
import { EventTopic } from '../shared/events/event-bus';
import type { IEventBus } from '../shared/events/event-bus';
import type { QoderReport, QoderReportRepository } from '../../db';
import type { CreateReportDTO } from '../modules/report/report.dto';

// ============================================================
// 工厂：构造合法 DTO / Mock Repository / Mock EventBus
// ============================================================

function validInput(overrides: Partial<CreateReportDTO> = {}): CreateReportDTO {
  return {
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    hostname: 'workstation-01',
    qoderVersion: '1.4.0',
    status: 'running',
    uptime: 120,
    cpuUsage: 45.5,
    memUsage: 60.2,
    workspaceCount: 3,
    reportedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepo(
  overrides: Partial<QoderReportRepository> = {},
): QoderReportRepository {
  return {
    create: vi.fn(),
    findLatestByInstance: vi.fn(),
    findAllLatest: vi.fn(),
    findHistoryByInstance: vi.fn(),
    findOfflineInstances: vi.fn(),
    softDeleteBefore: vi.fn(),
    ...overrides,
  } as QoderReportRepository;
}

function makeBus(overrides: Partial<IEventBus> = {}): IEventBus {
  return {
    publish: vi.fn(),
    subscribe: vi.fn(),
    ...overrides,
  } as IEventBus;
}

function makeSaved(overrides: Partial<QoderReport> = {}): QoderReport {
  return {
    id: 42,
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    hostname: 'workstation-01',
    qoderVersion: '1.4.0',
    status: 'running',
    uptime: 120,
    cpuUsage: 45.5,
    memUsage: 60.2,
    workspaceCount: 3,
    reportedAt: new Date('2026-07-26T00:00:00.000Z'),
    createdAt: new Date('2026-07-26T00:00:01.000Z'),
    ...overrides,
  };
}

// ============================================================
// 测试
// ============================================================

describe('ReportService.ingest', () => {
  let repo: QoderReportRepository;
  let bus: IEventBus;

  beforeEach(() => {
    repo = makeRepo();
    bus = makeBus();
  });

  it('有效上报应持久化并返回 ok({id})', async () => {
    // Arrange
    repo.create = vi.fn().mockResolvedValue(makeSaved({ id: 42 }));
    const service = new ReportService(repo, bus);

    // Act
    const result = await service.ingest(validInput());

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: 42 });
    }
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'running',
        reportedAt: new Date('2026-07-26T00:00:00.000Z'),
      }),
    );
  });

  it('持久化成功后应发布 report.received 事件（解耦实时推送）', async () => {
    // Arrange
    const createdAt = new Date('2026-07-26T00:00:01.000Z');
    repo.create = vi.fn().mockResolvedValue(makeSaved({ id: 7, createdAt }));
    const service = new ReportService(repo, bus);

    // Act
    await service.ingest(validInput());

    // Assert
    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect(bus.publish).toHaveBeenCalledWith(EventTopic.REPORT_RECEIVED, {
      instanceId: '550e8400-e29b-41d4-a716-446655440000',
      reportId: 7,
      createdAt,
    });
  });

  it('可空字段缺失时应归一化为 null 传入 Repository', async () => {
    // Arrange
    repo.create = vi.fn().mockResolvedValue(makeSaved({ id: 1 }));
    const service = new ReportService(repo, bus);
    const input = validInput({
      uptime: undefined,
      cpuUsage: undefined,
      memUsage: undefined,
      workspaceCount: undefined,
    });

    // Act
    await service.ingest(input);

    // Assert
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        uptime: null,
        cpuUsage: null,
        memUsage: null,
        workspaceCount: null,
      }),
    );
  });

  it('可空字段显式为 null 时应保持 null 传入 Repository', async () => {
    // Arrange
    repo.create = vi.fn().mockResolvedValue(makeSaved({ id: 1 }));
    const service = new ReportService(repo, bus);

    // Act
    await service.ingest(validInput({ cpuUsage: null, memUsage: null }));

    // Assert
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ cpuUsage: null, memUsage: null }),
    );
  });

  it('Repository 系统异常应自然上抛，不被包装为业务错误（BI-001：不泄露 details）', async () => {
    // Arrange
    const dbError = new Error('connection refused');
    repo.create = vi.fn().mockRejectedValue(dbError);
    const service = new ReportService(repo, bus);

    // Act + Assert
    await expect(service.ingest(validInput())).rejects.toThrow('connection refused');
    // 异常路径不应发布事件
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('status=error 应原样透传给 Repository（不在此层改写状态）', async () => {
    // Arrange
    repo.create = vi.fn().mockResolvedValue(makeSaved({ id: 1 }));
    const service = new ReportService(repo, bus);

    // Act
    await service.ingest(validInput({ status: 'error' }));

    // Assert
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('reportedAt 字符串应转换为 Date 对象传入 Repository', async () => {
    // Arrange
    repo.create = vi.fn().mockResolvedValue(makeSaved({ id: 1 }));
    const service = new ReportService(repo, bus);

    // Act
    await service.ingest(validInput({ reportedAt: '2026-01-15T08:30:00.000Z' }));

    // Assert
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reportedAt: new Date('2026-01-15T08:30:00.000Z'),
      }),
    );
  });
});
