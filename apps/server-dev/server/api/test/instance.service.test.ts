/**
 * InstanceService 单元测试 —— Mock Repository（质量原则第 2/5 原则）
 *
 * 被测对象：server/api/modules/instance/instance.service.ts
 * 覆盖：
 *   - listLatest：行映射 + effectiveStatus 派生（R-002：超过心跳阈值 → "stale"）
 *   - getLatest：repo 返回 null → 返回 null；返回行 → 返回 DTO
 *   - getHistory：返回 ok({items,total,page})；从未上报统一 200（R-001：无 404）
 *   - 分页二次防御：page<1 / limit<1 / limit>200 → err QUERY_VALIDATION_ERROR
 *   - 边界：未知 status 字符串 → 防御性降级为 "error"
 *
 * effectiveStatus 派生逻辑是纯计算（不入库），测试用构造不同 reportedAt 时间戳验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstanceService } from '../modules/instance/instance.service';
import { ErrorCode } from '../shared/types/errors';
import type {
  PaginatedResult,
  QoderReport,
  QoderReportRepository,
} from '../../db';

// ============================================================
// 工厂
// ============================================================

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

function makeReport(overrides: Partial<QoderReport> = {}): QoderReport {
  return {
    id: 1,
    instanceId: 'inst-1',
    hostname: 'host-1',
    qoderVersion: '1.4.0',
    status: 'running',
    uptime: 100,
    cpuUsage: 50,
    memUsage: 50,
    workspaceCount: 2,
    reportedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

const STALE_THRESHOLD_MS = 30_000;

// ============================================================
// 测试
// ============================================================

describe('InstanceService.listLatest', () => {
  it('应将 Repository 行映射为 InstanceDTO 并保留原始 status', async () => {
    // Arrange：上报时间在阈值内（fresh）→ effectiveStatus = status
    const fresh = makeReport({ reportedAt: new Date(Date.now() - 1000) });
    const repo = makeRepo({ findAllLatest: vi.fn().mockResolvedValue([fresh]) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const items = await service.listLatest();

    // Assert
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      instanceId: 'inst-1',
      status: 'running',
      effectiveStatus: 'running',
      hostname: 'host-1',
    });
    expect(typeof items[0].reportedAt).toBe('string'); // ISO8601
  });

  it('超过心跳阈值未上报应派生 effectiveStatus="stale"（R-002）', async () => {
    // Arrange：上报时间在 60s 前，超过 30s 阈值
    const stale = makeReport({
      status: 'running',
      reportedAt: new Date(Date.now() - 60_000),
    });
    const repo = makeRepo({ findAllLatest: vi.fn().mockResolvedValue([stale]) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const items = await service.listLatest();

    // Assert
    expect(items[0].effectiveStatus).toBe('stale');
    // 原始 status 仍保留为 running（effectiveStatus 是派生，不改原始）
    expect(items[0].status).toBe('running');
  });

  it('略低于阈值（28s）应视为非 stale（> 严格大于，留 2s 安全裕度避免时钟抖动）', async () => {
    // Arrange：28s 前，低于 30s 阈值（用 2s 裕度吸收构造 reportedAt 与 Service 内 Date.now() 之间的耗时）
    const edge = makeReport({ reportedAt: new Date(Date.now() - (STALE_THRESHOLD_MS - 2000)) });
    const repo = makeRepo({ findAllLatest: vi.fn().mockResolvedValue([edge]) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const items = await service.listLatest();

    // Assert：低于阈值 → 非 stale（严格 > 才触发）
    expect(items[0].effectiveStatus).toBe('running');
  });

  it('Repository 返回空数组应映射为空 InstanceDTO[]', async () => {
    // Arrange
    const repo = makeRepo({ findAllLatest: vi.fn().mockResolvedValue([]) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const items = await service.listLatest();

    // Assert
    expect(items).toEqual([]);
  });

  it('未知 status 字符串应防御性降级为 "error"', async () => {
    // Arrange：模拟脏数据（status 不在白名单）
    const dirty = makeReport({ status: 'unknown-xyz', reportedAt: new Date() });
    const repo = makeRepo({ findAllLatest: vi.fn().mockResolvedValue([dirty]) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const items = await service.listLatest();

    // Assert
    expect(items[0].status).toBe('error');
    expect(items[0].effectiveStatus).toBe('error');
  });
});

describe('InstanceService.getLatest', () => {
  it('Repository 返回 null 应返回 null', async () => {
    // Arrange
    const repo = makeRepo({ findLatestByInstance: vi.fn().mockResolvedValue(null) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const result = await service.getLatest('never-reported');

    // Assert
    expect(result).toBeNull();
  });

  it('Repository 返回行应返回映射后的 InstanceDTO', async () => {
    // Arrange
    const row = makeReport({ instanceId: 'inst-9', reportedAt: new Date() });
    const repo = makeRepo({ findLatestByInstance: vi.fn().mockResolvedValue(row) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const result = await service.getLatest('inst-9');

    // Assert
    expect(result).not.toBeNull();
    expect(result!.instanceId).toBe('inst-9');
    expect(result!.effectiveStatus).toBe('running');
  });
});

describe('InstanceService.getHistory', () => {
  it('应返回 ok({items, total, page}) 且 items 经 ReportDTO 映射', async () => {
    // Arrange
    const page: PaginatedResult<QoderReport> = {
      items: [
        makeReport({ id: 10, instanceId: 'inst-1', createdAt: new Date('2026-07-26T00:00:01Z') }),
      ],
      total: 1,
      page: 1,
    };
    const repo = makeRepo({ findHistoryByInstance: vi.fn().mockResolvedValue(page) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const result = await service.getHistory('inst-1', 1, 50);

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.page).toBe(1);
      expect(result.value.total).toBe(1);
      expect(result.value.items).toHaveLength(1);
      expect(result.value.items[0]).toMatchObject({ id: 10, instanceId: 'inst-1' });
      expect(typeof result.value.items[0].createdAt).toBe('string'); // ReportDTO 暴露 createdAt
    }
  });

  it('从未上报的实例应返回 ok + 空数组（R-001：无 404 分支）', async () => {
    // Arrange：Repository 对从未上报实例返回空分页
    const empty: PaginatedResult<QoderReport> = { items: [], total: 0, page: 1 };
    const repo = makeRepo({ findHistoryByInstance: vi.fn().mockResolvedValue(empty) });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const result = await service.getHistory('never-existed', 1, 50);

    // Assert：必须是 ok（200），不是 err（404）
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toEqual([]);
      expect(result.value.total).toBe(0);
    }
  });

  it('page < 1 应返回 err QUERY_VALIDATION_ERROR（二次防御）', async () => {
    // Arrange
    const repo = makeRepo();
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const result = await service.getHistory('inst-1', 0, 50);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.QUERY_VALIDATION_ERROR);
    }
    expect(repo.findHistoryByInstance).not.toHaveBeenCalled();
  });

  it('limit < 1 应返回 err QUERY_VALIDATION_ERROR（二次防御）', async () => {
    // Arrange
    const repo = makeRepo();
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const result = await service.getHistory('inst-1', 1, 0);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.QUERY_VALIDATION_ERROR);
    }
  });

  it('limit > 200 应返回 err QUERY_VALIDATION_ERROR（二次防御，R-003）', async () => {
    // Arrange
    const repo = makeRepo();
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    const result = await service.getHistory('inst-1', 1, 201);

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.QUERY_VALIDATION_ERROR);
    }
  });

  it('合法的 page=2 limit=10 应透传给 Repository', async () => {
    // Arrange
    const repo = makeRepo({
      findHistoryByInstance: vi.fn().mockResolvedValue({ items: [], total: 15, page: 2 }),
    });
    const service = new InstanceService(repo, STALE_THRESHOLD_MS);

    // Act
    await service.getHistory('inst-1', 2, 10);

    // Assert
    expect(repo.findHistoryByInstance).toHaveBeenCalledWith('inst-1', 2, 10);
  });
});
