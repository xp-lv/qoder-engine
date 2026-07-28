/**
 * GET /api/instances + /api/instances/:id/history 路由集成测试（supertest + Mock Service）
 *
 * 被测链路：HTTP → request-logger → 业务路由 → validate(query) → Controller → Service(Mock)
 * 通过 createApp 装配真实中间件链，仅 Service 层 Mock。
 *
 * 覆盖（统一接口文档 §2.2 / §2.3）：
 *   - GET /api/instances → 200 { items: InstanceDTO[] }
 *   - GET history 无 query → 200（默认 page=1 limit=50）
 *   - GET history limit=0 → 400 QUERY_VALIDATION_ERROR（R-003）
 *   - GET history limit=201 → 400
 *   - GET history page=abc（非数字 coerce 失败）→ 400
 *   - GET /health → 200 { ok: true }（健康检查探活）
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { ReportController } from '../modules/report/report.controller';
import { InstanceController } from '../modules/instance/instance.controller';
import type { IReportService } from '../modules/report/report.service';
import type { IInstanceService } from '../modules/instance/instance.service';
import type { InstanceDTO } from '../modules/instance/instance.dto';

// ============================================================
// Mock Service 工厂
// ============================================================

function makeReportService(): IReportService {
  return {
    ingest: vi.fn().mockResolvedValue({ ok: true, value: { id: 1 } }),
  } as IReportService;
}

function makeInstanceService(
  overrides: Partial<IInstanceService> = {},
): IInstanceService {
  return {
    listLatest: vi.fn().mockResolvedValue([]),
    getLatest: vi.fn().mockResolvedValue(null),
    getHistory: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { items: [], total: 0, page: 1 } }),
    ...overrides,
  } as IInstanceService;
}

function buildApp(instanceService: IInstanceService) {
  return createApp({
    reportController: new ReportController(makeReportService()),
    instanceController: new InstanceController(instanceService),
    corsOrigins: ['*'],
    bodyLimit: '64kb',
  });
}

const sampleInstance: InstanceDTO = {
  instanceId: '550e8400-e29b-41d4-a716-446655440000',
  hostname: 'host-1',
  qoderVersion: '1.4.0',
  status: 'running',
  effectiveStatus: 'running',
  uptime: 100,
  cpuUsage: 45,
  memUsage: 60,
  workspaceCount: 2,
  reportedAt: '2026-07-26T00:00:00.000Z',
};

// ============================================================
// 测试
// ============================================================

describe('GET /api/instances', () => {
  it('应返回 200 { items: InstanceDTO[] }', async () => {
    // Arrange
    const instanceService = makeInstanceService({
      listLatest: vi.fn().mockResolvedValue([sampleInstance]),
    });
    const app = buildApp(instanceService);

    // Act
    const res = await request(app).get('/api/instances');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      instanceId: '550e8400-e29b-41d4-a716-446655440000',
      effectiveStatus: 'running',
    });
  });

  it('空实例列表应返回 200 { items: [] }', async () => {
    // Arrange
    const instanceService = makeInstanceService({ listLatest: vi.fn().mockResolvedValue([]) });
    const app = buildApp(instanceService);

    // Act
    const res = await request(app).get('/api/instances');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('GET /api/instances/:instanceId/history', () => {
  it('无 query 参数应使用默认分页并返回 200', async () => {
    // Arrange
    const instanceService = makeInstanceService();
    const app = buildApp(instanceService);

    // Act
    const res = await request(app).get('/api/instances/inst-1/history');

    // Assert
    expect(res.status).toBe(200);
    expect(instanceService.getHistory).toHaveBeenCalledTimes(1);
    // 默认 page=1 limit=50 由 zod coerce 填充后传入
    expect(instanceService.getHistory).toHaveBeenCalledWith('inst-1', 1, 50);
  });

  it('显式 page/limit 应透传并返回 200', async () => {
    // Arrange
    const instanceService = makeInstanceService();
    const app = buildApp(instanceService);

    // Act
    const res = await request(app).get('/api/instances/inst-1/history?page=2&limit=10');

    // Assert
    expect(res.status).toBe(200);
    expect(instanceService.getHistory).toHaveBeenCalledWith('inst-1', 2, 10);
  });

  it('limit=0 应返回 400 QUERY_VALIDATION_ERROR（R-003）', async () => {
    // Arrange
    const instanceService = makeInstanceService();
    const app = buildApp(instanceService);

    // Act
    const res = await request(app).get('/api/instances/inst-1/history?limit=0');

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUERY_VALIDATION_ERROR');
    expect(instanceService.getHistory).not.toHaveBeenCalled();
  });

  it('limit=201 应返回 400 QUERY_VALIDATION_ERROR', async () => {
    // Arrange
    const instanceService = makeInstanceService();
    const app = buildApp(instanceService);

    // Act
    const res = await request(app).get('/api/instances/inst-1/history?limit=201');

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUERY_VALIDATION_ERROR');
  });

  it('page=0 应返回 400 QUERY_VALIDATION_ERROR', async () => {
    // Arrange
    const instanceService = makeInstanceService();
    const app = buildApp(instanceService);

    // Act
    const res = await request(app).get('/api/instances/inst-1/history?page=0');

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUERY_VALIDATION_ERROR');
  });

  it('Service 返回业务错误（err）应映射为对应 HTTP 状态码', async () => {
    // Arrange：Service 返回 err（QUERY_VALIDATION_ERROR → 400），模拟二次防御触发
    const instanceService = makeInstanceService({
      getHistory: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'QUERY_VALIDATION_ERROR', message: '分页参数越界' },
      }),
    });
    const app = buildApp(instanceService);

    // Act：query 校验通过（limit=50 合法），但 Service 二次防御返回 err
    const res = await request(app).get('/api/instances/inst-1/history?page=1&limit=50');

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUERY_VALIDATION_ERROR');
  });
});

describe('GET /health', () => {
  it('健康检查应返回 200 { ok: true }', async () => {
    // Arrange
    const app = buildApp(makeInstanceService());

    // Act
    const res = await request(app).get('/health');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
