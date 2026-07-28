/**
 * DashboardPage —— 实时监控面板（路由 /，首屏直接加载）。
 *
 * 视觉焦点：InstanceGrid（所有 qoder 实例状态卡片网格）。
 * 数据通道：WebSocket（主）+ HTTP GET /api/instances（WS 不可用时兜底）。
 *
 * 状态机（质量原则第 4 原则）——依据 wsState 状态矩阵渲染（红队 FI-006 修正）：
 *  - connecting / reconnecting / error（兜底前）且尚无数据 → 骨架屏（加载态）
 *  - connected + 实例数>0 → InstanceGrid
 *  - connected + 实例数=0 → 空状态（仅此态显示「暂无实例上报」，避免误导用户错误归因）
 *  - reconnecting → 保留上次数据 + 指示器（无数据时显骨架屏 + 重连提示）
 *  - error → ErrorBanner + HTTP 兜底按钮（无数据时主区显骨架屏）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMonitorStore } from '../../../store/useMonitorStore';
import { useMonitorSocket } from '../../../ws/useMonitorSocket';
import { fetchInstances } from '../../../api/instances';
import { ApiError } from '../../../api/client';
import { InstanceGrid } from '../../organisms/InstanceGrid/InstanceGrid';
import { EmptyState } from '../../atoms/EmptyState/EmptyState';
import { SkeletonBox } from '../../atoms/SkeletonBox/SkeletonBox';
import { ErrorBanner } from '../../molecules/ErrorBanner/ErrorBanner';
import { Text } from '../../atoms/Text/Text';
import styles from './DashboardPage.module.css';

export function DashboardPage() {
  // 启动 WebSocket 连接（组件挂载即建立，单一实例）
  useMonitorSocket();

  const wsState = useMonitorStore((s) => s.wsState);
  const replaceAll = useMonitorStore((s) => s.replaceAll);

  // 红队 FI-007 修正：直接订阅 instances Map（apply* 内每次 new Map，引用仅在数据变更时变化），
  // 用 useMemo 仅在 Map 引用变化时排序一次；避免之前 selectInstanceList 在每次 store 更新
  // （含 wsState 变化）都执行 O(N log N) 排序的残留计算成本。
  const instancesMap = useMonitorStore((s) => s.instances);
  const instances = useMemo(
    () =>
      Array.from(instancesMap.values()).sort((a, b) =>
        a.hostname.localeCompare(b.hostname),
      ),
    [instancesMap],
  );

  // 红队 FI-010 修正：HTTP 兜底接入 AbortController，取消上一次进行中的请求，
  // 防止连续点击重试时并发请求 resolve 顺序不确定导致结果互相覆盖（与 InstanceDetailPage FI-001 同构）。
  const fallbackCtrlRef = useRef<AbortController | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  const handleHttpFallback = useCallback(async () => {
    // 取消上一次进行中的兜底请求，仅保留最后一次点击的结果
    fallbackCtrlRef.current?.abort();
    const ctrl = new AbortController();
    fallbackCtrlRef.current = ctrl;

    setFallbackLoading(true);
    setFallbackError(null);
    try {
      const items = await fetchInstances(ctrl.signal);
      // await 返回后若已被取消，丢弃结果
      if (ctrl.signal.aborted) return;
      replaceAll(items);
    } catch (err) {
      if (ctrl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      setFallbackError(err instanceof ApiError ? err.message : '拉取失败，请稍后重试');
    } finally {
      // 仅当本次请求未被取消时才复位 loading（被取消的请求不负责复位按钮）
      if (!ctrl.signal.aborted) setFallbackLoading(false);
    }
  }, [replaceAll]);

  // 组件卸载时取消进行中的兜底请求
  useEffect(() => {
    return () => fallbackCtrlRef.current?.abort();
  }, []);

  // 红队 FI-006 修正：尚未拿到任何数据（非 connected 态）时显骨架屏（加载态），
  // 仅 connected 且无实例才显空状态；避免 reconnecting/error 态误显「暂无实例上报」误导用户错误归因。
  const noData = instances.length === 0;
  const showSkeleton = noData && wsState.status !== 'connected';
  const showEmpty = noData && wsState.status === 'connected';
  const isReconnecting = wsState.status === 'reconnecting';

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <Text variant="h1">实时监控面板</Text>
        <Text variant="secondary">所有 qoder 实例的实时运行状态</Text>
      </div>

      {/* WS 致命错误时显示 HTTP 兜底横幅 */}
      {wsState.status === 'error' ? (
        <ErrorBanner
          message="实时连接中断，数据可能不是最新"
          retryLabel={fallbackLoading ? '拉取中…' : '手动刷新（HTTP 兜底）'}
          retryDisabled={fallbackLoading}
          onRetry={handleHttpFallback}
        >
          {fallbackError ? <Text variant="muted">{fallbackError}</Text> : null}
        </ErrorBanner>
      ) : null}

      {/* 状态矩阵 */}
      {showSkeleton ? (
        <div className={styles.skeletonGrid} aria-busy="true" aria-live="polite">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <SkeletonBox width="40%" height="0.875rem" />
              <SkeletonBox width="60%" height="1.5rem" />
              <div className={styles.skeletonRow}>
                <SkeletonBox width="45%" height="1.25rem" />
                <SkeletonBox width="45%" height="1.25rem" />
              </div>
            </div>
          ))}
        </div>
      ) : showEmpty ? (
        <EmptyState
          icon="📭"
          title="暂无 qoder 实例上报"
          description="请确认 Ext 已安装并在被监控的 qoder 机器上运行。实例上报后，数据将通过 WebSocket 实时显示在此。"
        />
      ) : (
        <InstanceGrid instances={instances} />
      )}

      {/* 重连中提示（无数据时骨架屏下方叠加，避免用户误以为「暂无数据」） */}
      {showSkeleton && isReconnecting ? (
        <Text variant="muted" className={styles.reconnectHint} role="status">
          连接断开，正在尝试重连，请稍候…
        </Text>
      ) : null}
    </div>
  );
}
