/**
 * 实例领域 API 调用层。
 * 路径与后端契约（统一接口文档 §2.2 / §2.3）完全一致。
 * 网站前端不调用 POST /api/reports（该接口为 Ext 专用上报通道）。
 */
import { request } from './client';
import { clampLimit } from '../config/env';
import type { HistoryQuery, HistoryResponse, Instance } from '../types';

/** GET /api/instances —— 全量实例最新状态（WS 不可用时的 HTTP 兜底） */
export async function fetchInstances(signal?: AbortSignal): Promise<Instance[]> {
  const data = await request<{ items: Instance[] }>('/api/instances', { signal });
  return data.items ?? [];
}

/** GET /api/instances/:instanceId/history —— 实例历史上报（分页倒序） */
export async function fetchInstanceHistory(
  instanceId: string,
  query: HistoryQuery,
  signal?: AbortSignal,
): Promise<HistoryResponse> {
  // 红队 R-003 / FI-009 修正：在 API 调用边界对 limit 做客户端防御性截断（∈ [1, 200]），
  // 作为 depth-in-defense，确保即便上层传入越界值也不会发出非法请求。
  const safeLimit = clampLimit(query.limit).value;
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(safeLimit),
  });
  return request<HistoryResponse>(
    `/api/instances/${encodeURIComponent(instanceId)}/history?${params.toString()}`,
    { signal },
  );
}
