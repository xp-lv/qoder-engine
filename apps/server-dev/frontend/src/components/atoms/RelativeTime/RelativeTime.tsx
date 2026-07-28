/**
 * RelativeTime —— 自管理相对时间原子（红队 FI-003 修正）。
 *
 * 此前「最后上报 Nx 前」文案依赖父级页面 useState(now) + setInterval(5s) 周期刷新，
 * now 作为 prop 透传 InstanceGrid → InstanceCard / InstanceSummaryPanel，
 * 致使 memo 比较失效，每 5s 全量重渲染整棵卡片树，渲染成本与收益严重不匹配。
 *
 * 本组件内部 setInterval 仅触发自身重渲染，父级不再依赖 now prop，
 * 实现「只有时间文案这一片 DOM 更新」的精确局部更新。
 */
import { memo, useEffect, useState } from 'react';
import { formatRelative } from '../../../utils/time';

interface Props {
  /** ISO8601 时间字符串（reportedAt / createdAt） */
  iso: string;
}

function RelativeTimeComponent({ iso }: Props) {
  // 仅作「定时触发自身重渲染」用，值本身无意义
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

  // 每次重渲染都用 Date.now() 重新计算相对文案
  return <>{formatRelative(iso)}</>;
}

export const RelativeTime = memo(RelativeTimeComponent);
