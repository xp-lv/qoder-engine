/**
 * InstanceSummaryPanel —— 实例详情页头部摘要组织。
 * 展示该实例最新一条上报的关键信息 + 状态徽标。
 */
import { memo } from 'react';
import type { Instance } from '../../../types';
import { StatusBadge } from '../../atoms/StatusBadge/StatusBadge';
import { Text } from '../../atoms/Text/Text';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime';
// 红队 FI-008 修正：抽取共享 MetricsGrid，消除与 InstanceCard 的指标块 JSX 重复
import { MetricsGrid } from '../../molecules/MetricsGrid/MetricsGrid';
import styles from './InstanceSummaryPanel.module.css';

interface Props {
  instance: Instance;
}

function InstanceSummaryPanelComponent({ instance }: Props) {
  return (
    <section className={styles.panel} aria-label="实例最新状态摘要">
      <div className={styles.header}>
        <div>
          <Text variant="h2" className={styles.hostname}>
            {instance.hostname}
          </Text>
          <Text variant="secondary">
            {instance.instanceId} · v{instance.qoderVersion}
          </Text>
        </div>
        <StatusBadge effectiveStatus={instance.effectiveStatus} />
      </div>
      <MetricsGrid instance={instance} className={styles.metrics} />
      <Text variant="muted">
        最后上报 <RelativeTime iso={instance.reportedAt} />
      </Text>
    </section>
  );
}

export const InstanceSummaryPanel = memo(InstanceSummaryPanelComponent);
