/**
 * MetricsGrid —— 实例关键指标网格（共享分子，红队 FI-008 修正）。
 *
 * 封装 CPU / 内存 / 运行时长 / 工作区 4 个 MetricItem 的渲染逻辑，
 * 消除 InstanceCard 与 InstanceSummaryPanel 中完全相同的指标块 JSX（DRY，质量原则第 3 原则）。
 * 网格布局（列数 / 间距）由各使用方通过 className 注入：
 *  - InstanceCard：两列紧凑网格
 *  - InstanceSummaryPanel：四列响应式网格
 * label / unit / 取值字段 / 格式化方式在此唯一维护，新增指标只需改一处。
 */
import { memo } from 'react';
import type { Instance } from '../../../types';
import { MetricItem } from '../MetricItem/MetricItem';
import { formatUptime } from '../../../utils/time';

interface Props {
  instance: Instance;
  /** 网格容器样式类（由使用方注入，控制列数与间距） */
  className: string;
}

function MetricsGridComponent({ instance, className }: Props) {
  return (
    <div className={className}>
      <MetricItem label="CPU" value={instance.cpuUsage} unit="%" />
      <MetricItem label="内存" value={instance.memUsage} unit="%" />
      <MetricItem label="运行时长" value={formatUptime(instance.uptime)} />
      <MetricItem label="工作区" value={instance.workspaceCount} unit="个" />
    </div>
  );
}

export const MetricsGrid = memo(MetricsGridComponent);
