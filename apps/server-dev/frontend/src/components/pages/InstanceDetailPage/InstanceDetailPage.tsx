/**
 * InstanceDetailPage —— 实例历史详情（路由 /instances/:instanceId，React.lazy 懒加载）。
 *
 * 视觉焦点：HistoryTable（历史上报记录表格，按 reportedAt 倒序）。
 * 数据：GET /api/instances/:id/history（分页）。摘要区复用 WS store 最新状态（若已上报）。
 *
 * 历史查询状态机（质量原则第 4 原则）：
 *   idle → loading → success(data) / error(message)
 * 每个状态对应明确 UI（骨架屏 / 表格+分页 / 空状态 / 错误横幅）。
 */
import { useCallback, useEffect, useReducer, useState } from 'react';
import { useParams } from 'react-router-dom';
import { config } from '../../../config/env';
import { fetchInstanceHistory } from '../../../api/instances';
import { ApiError } from '../../../api/client';
import { useMonitorStore } from '../../../store/useMonitorStore';
import type { HistoryResponse } from '../../../types';
import { InstanceSummaryPanel } from '../../organisms/InstanceSummaryPanel/InstanceSummaryPanel';
import { HistoryTable } from '../../organisms/HistoryTable/HistoryTable';
import { PaginationBar } from '../../molecules/PaginationBar/PaginationBar';
import { ErrorBanner } from '../../molecules/ErrorBanner/ErrorBanner';
import { EmptyState } from '../../atoms/EmptyState/EmptyState';
import { SkeletonBox } from '../../atoms/SkeletonBox/SkeletonBox';
import { Text } from '../../atoms/Text/Text';
import { Link } from 'react-router-dom';
import styles from './InstanceDetailPage.module.css';

/** 历史查询状态机（质量原则第 4 原则） */
type HistoryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: HistoryResponse }
  | { status: 'error'; error: string; notFound?: boolean };

type Action =
  | { type: 'load' }
  | { type: 'success'; data: HistoryResponse }
  | { type: 'error'; error: string; notFound?: boolean };

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case 'load':
      return { status: 'loading' };
    case 'success':
      return { status: 'success', data: action.data };
    case 'error':
      return { status: 'error', error: action.error, notFound: action.notFound };
    default:
      return state;
  }
}

export function InstanceDetailPage() {
  const { instanceId = '' } = useParams<{ instanceId: string }>();
  const [page, setPage] = useState(config.history.defaultPage);
  const [state, dispatch] = useReducer(reducer, { status: 'idle' } as HistoryState);

  // 摘要区：从 WS store 取该实例最新状态（若存在）
  const storeInstance = useMonitorStore((s) => s.instances.get(instanceId));

  // 红队 FI-001 修正：load 接收 AbortSignal，传入 fetchInstanceHistory 取消上次请求，
  // 消除快速翻页时旧页响应覆盖新页数据的竞态，并避免卸载后 dispatch。
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!instanceId) return;
    dispatch({ type: 'load' });
    try {
      const data = await fetchInstanceHistory(
        instanceId,
        { page, limit: config.history.defaultLimit },
        signal,
      );
      // 双重保险：await 返回后若已被取消，丢弃结果不再 dispatch
      if (signal?.aborted) return;
      dispatch({ type: 'success', data });
    } catch (err) {
      // 请求被取消（翻页/卸载）时静默忽略，不进入 error 状态
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      const isNotFound = err instanceof ApiError && err.status === 404;
      dispatch({
        type: 'error',
        error: isNotFound ? '该实例从未上报，无历史记录' : err instanceof ApiError ? err.message : '加载失败，请稍后重试',
        notFound: isNotFound,
      });
    }
  }, [instanceId, page]);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.back}>
        ‹ 返回监控面板
      </Link>

      <div className={styles.heading}>
        <Text variant="h1">实例历史详情</Text>
        <Text variant="secondary">实例 ID：{instanceId}</Text>
      </div>

      {storeInstance ? <InstanceSummaryPanel instance={storeInstance} /> : null}

      {/* 历史查询状态矩阵 */}
      {state.status === 'idle' || state.status === 'loading' ? (
        <div className={styles.skeletonTable} aria-busy="true" aria-live="polite">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBox key={i} width="100%" height="2.5rem" />
          ))}
        </div>
      ) : state.status === 'error' ? (
        state.notFound ? (
          <EmptyState icon="🔍" title="该实例从未上报" description="未找到此实例的历史记录，请返回面板确认实例标识。" />
        ) : (
          <ErrorBanner message={state.error} retryLabel="重试" onRetry={load} />
        )
      ) : state.data.items.length === 0 ? (
        <EmptyState icon="📄" title="该实例暂无历史记录" description="此实例尚未产生任何上报快照。" />
      ) : (
        <>
          <HistoryTable records={state.data.items} />
          <PaginationBar
            page={state.data.page}
            total={state.data.total}
            limit={config.history.defaultLimit}
            onPageChange={setPage}
            disabled={state.status === 'loading'}
          />
        </>
      )}
    </div>
  );
}
