/**
 * POST /api/reports 路由集成测试（supertest + Mock Service）
 *
 * 被测链路：HTTP 请求 → body-size → json 解析 → validate(zod) → Controller → Service(Mock)
 * 通过 createApp 装配真实中间件链（CORS / body-size / json / validate / asyncHandler / errorHandler），
 * 仅 Service 层用 Mock 替换（隔离 DB），验证 HTTP 契约（统一接口文档 §2.1）。
 *
 * 覆盖：
 *   - 正常上报 → 201 { ok: true }
 *   - 字段校验失败（非法 status / 缺 instanceId / 数值越界）→ 422 ErrorEnvelope
 *   - 畸形 JSON → 400（express.json err.status 透传，BI-005）
 *   - Service 系统异常 → 500 INTERNAL_ERROR（脱敏，不泄露 details）
 *   - 未知路由 → 404
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { ReportController } from '../modules/report/report.controller';
import { InstanceController } from '../modules/instance/instance.controller';
import type { IReportService } from '../modules/report/report.service';
import type { IInstanceService } from '../modules/instance/instance.service';

// ============================================================
// Mock Service 工厂
// ============================================================

function makeReportService(
  overrides: Partial<IReportService> = {},
): IReportService {
  return {
    ingest: vi.fn().mockResolvedValue({ ok: true, value: { id: 1 } }),
    ...overrides,
  } as IReportService;
}

function makeInstanceService(
  overrides: Partial<IInstanceService> = {},
): IInstanceService {
  return {
    listLatest: vi.fn().mockResolvedValue([]),
    getLatest: vi.fn().mockResolvedValue(null),
    getHistory: vi.fn().mockResolvedValue({ ok: true, value: { items: [], total: 0, page: 1 } }),
    ...overrides,
  } as IInstanceService;
}

function buildApp(reportService: IReportService) {
  return createApp({
    reportController: new ReportController(reportService),
    instanceController: new InstanceController(makeInstanceService()),
    corsOrigins: ['*'],
    bodyLimit: '64kb',
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

// ============================================================
// 测试
// ============================================================

describe('POST /api/reports', () => {
  let reportService: IReportService;

  beforeEach(() => {
    reportService = makeReportService();
  });

  it('有效上报应返回 201 { ok: true } 并调用 Service', async () => {
    // Arrange
    const app = buildApp(reportService);

    // Act
    const res = await request(app).post('/api/reports').send(validBody());

    // Assert
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(reportService.ingest).toHaveBeenCalledTimes(1);
  });

  it('非法 status 应返回 422 VALIDATION_ERROR', async () => {
    // Arrange
    const app = buildApp(reportService);

    // Act
    const res = await request(app).post('/api/reports').send(validBody({ status: 'stale' }));

    // Assert
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(reportService.ingest).not.toHaveBeenCalled();
  });

  it('缺失 instanceId 应返回 422 VALIDATION_ERROR', async () => {
    // Arrange
    const app = buildApp(reportService);
    const { instanceId, ...withoutId } = validBody() as Record<string, unknown>;

    // Act
    const res = await request(app).post('/api/reports').send(withoutId);

    // Assert
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cpuUsage 超过 100 应返回 422（数值边界）', async () => {
    // Arrange
    const app = buildApp(reportService);

    // Act
    const res = await request(app).post('/api/reports').send(validBody({ cpuUsage: 150 }));

    // Assert
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reportedAt 非法 ISO 应返回 422', async () => {
    // Arrange
    const app = buildApp(reportService);

    // Act
    const res = await request(app).post('/api/reports').send(validBody({ reportedAt: 'nope' }));

    // Assert
    expect(res.status).toBe(422);
  });

  it('畸形 JSON 应返回 400（express.json err.status 透传，BI-005）', async () => {
    // Arrange
    const app = buildApp(reportService);

    // Act：发送非法 JSON 体
    const res = await request(app)
      .post('/api/reports')
      .set('Content-Type', 'application/json')
      .send('{ invalid json }');

    // Assert
    expect(res.status).toBe(400);
  });

  it('Service 系统异常应返回 500 INTERNAL_ERROR 且不泄露 details', async () => {
    // Arrange：Service 抛出系统异常（模拟 DB 故障），由全局 errorHandler 兜底
    reportService = makeReportService({
      ingest: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const app = buildApp(reportService);

    // Act
    const res = await request(app).post('/api/reports').send(validBody());

    // Assert
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    // 不泄露内部异常 details
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });

  it('未知路由应返回 404 NOT_FOUND', async () => {
    // Arrange
    const app = buildApp(reportService);

    // Act
    const res = await request(app).get('/api/unknown-endpoint');

    // Assert
    expect(res.status).toBe(404);
  });
});
