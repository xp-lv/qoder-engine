/**
 * DTO zod 校验测试（质量原则第 3 原则：接口即契约）
 *
 * 被测对象：
 *   - createReportSchema（report.dto.ts）—— POST /api/reports 请求体
 *   - historyQuerySchema（instance.dto.ts）—— GET /api/instances/:id/history 查询参数
 *
 * 覆盖：合法输入 / 枚举越界 / 长度边界 / 数值边界 / 可空字段 / 默认值填充。
 * 校验结果直接决定中间件返回 422 / 400，是 API 契约的断言依据。
 */
import { describe, it, expect } from 'vitest';
import { createReportSchema } from '../modules/report/report.dto';
import { historyQuerySchema } from '../modules/instance/instance.dto';

// ============================================================
// createReportSchema
// ============================================================

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

describe('createReportSchema — 请求体校验', () => {
  it('合法完整请求体应通过校验', () => {
    const result = createReportSchema.safeParse(validBody());
    expect(result.success).toBe(true);
  });

  it('可空字段全部缺失应通过校验（均为 optional）', () => {
    const result = createReportSchema.safeParse(
      validBody({
        uptime: undefined,
        cpuUsage: undefined,
        memUsage: undefined,
        workspaceCount: undefined,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('可空字段显式为 null 应通过校验', () => {
    const result = createReportSchema.safeParse(
      validBody({ cpuUsage: null, memUsage: null, uptime: null, workspaceCount: null }),
    );
    expect(result.success).toBe(true);
  });

  it('status 非法枚举值应拒绝', () => {
    const result = createReportSchema.safeParse(validBody({ status: 'stale' }));
    expect(result.success).toBe(false);
  });

  it('status 为空字符串应拒绝', () => {
    const result = createReportSchema.safeParse(validBody({ status: '' }));
    expect(result.success).toBe(false);
  });

  it('instanceId 非 36 字符应拒绝', () => {
    // Arrange：太短
    expect(createReportSchema.safeParse(validBody({ instanceId: 'short' })).success).toBe(false);
    // 太长
    expect(
      createReportSchema.safeParse(validBody({ instanceId: 'x'.repeat(37) })).success,
    ).toBe(false);
  });

  it('reportedAt 非法 ISO8601 应拒绝', () => {
    const result = createReportSchema.safeParse(validBody({ reportedAt: 'not-a-date' }));
    expect(result.success).toBe(false);
  });

  it('cpuUsage 超过 100 应拒绝（数值边界）', () => {
    const result = createReportSchema.safeParse(validBody({ cpuUsage: 100.1 }));
    expect(result.success).toBe(false);
  });

  it('cpuUsage 为负数应拒绝（数值边界）', () => {
    const result = createReportSchema.safeParse(validBody({ cpuUsage: -0.1 }));
    expect(result.success).toBe(false);
  });

  it('cpuUsage 恰好 0 和 100 应通过（闭区间边界）', () => {
    expect(createReportSchema.safeParse(validBody({ cpuUsage: 0 })).success).toBe(true);
    expect(createReportSchema.safeParse(validBody({ cpuUsage: 100 })).success).toBe(true);
  });

  it('uptime 为负数应拒绝', () => {
    const result = createReportSchema.safeParse(validBody({ uptime: -1 }));
    expect(result.success).toBe(false);
  });

  it('hostname 为空字符串应拒绝', () => {
    const result = createReportSchema.safeParse(validBody({ hostname: '' }));
    expect(result.success).toBe(false);
  });

  it('hostname 超过 255 字符应拒绝（长度边界）', () => {
    const result = createReportSchema.safeParse(validBody({ hostname: 'x'.repeat(256) }));
    expect(result.success).toBe(false);
  });

  it('qoderVersion 超过 50 字符应拒绝（长度边界）', () => {
    const result = createReportSchema.safeParse(validBody({ qoderVersion: 'x'.repeat(51) }));
    expect(result.success).toBe(false);
  });
});

// ============================================================
// historyQuerySchema
// ============================================================

describe('historyQuerySchema — 分页查询参数校验', () => {
  it('缺失 page/limit 应填充默认值（page=1, limit=50）', () => {
    const result = historyQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(50);
    }
  });

  it('字符串数字应 coerce 为数值（query string 场景）', () => {
    const result = historyQuerySchema.safeParse({ page: '2', limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(10);
    }
  });

  it('page=0 应拒绝（必须 ≥ 1）', () => {
    const result = historyQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it('page 为负数应拒绝', () => {
    const result = historyQuerySchema.safeParse({ page: -1 });
    expect(result.success).toBe(false);
  });

  it('limit=0 应拒绝（必须 ≥ 1）', () => {
    const result = historyQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('limit=201 应拒绝（必须 ≤ 200，R-003）', () => {
    const result = historyQuerySchema.safeParse({ limit: 201 });
    expect(result.success).toBe(false);
  });

  it('limit 边界 1 和 200 应通过（闭区间）', () => {
    expect(historyQuerySchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(historyQuerySchema.safeParse({ limit: 200 }).success).toBe(true);
  });

  it('limit 为非整数应拒绝', () => {
    const result = historyQuerySchema.safeParse({ limit: 1.5 });
    expect(result.success).toBe(false);
  });
});
