/**
 * InstanceCard —— 实例状态卡片分子（监控面板核心分子）。
 *
 * 内部：StatusBadge（焦点之一，颜色区分状态）+ hostname/版本 + MetricItem×4 + 最后上报时间。
 * 离线处理（C-01 服务端权威派生）：effectiveStatus === 'stale' 时降透明度 + 灰色徽标。
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { Instance } from '../../../types';
import { StatusBadge } from '../../atoms/StatusBadge/StatusBadge';
import { Text } from '../../atoms/Text/Text';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime';
// 红队 FI-008 修正：抽取共享 MetricsGrid，消除与 InstanceSummaryPanel 的指标块 JSX 重复
import { MetricsGrid } from '../MetricsGrid/MetricsGrid';
import styles from './InstanceCard.module.css';

interface Props {
  instance: Instance;
}

function InstanceCardComponent({ instance }: Props) {
  const isStale = instance.effectiveStatus === 'stale';

  return (
    <Link
      to={`/instances/${encodeURIComponent(instance.instanceId)}`}
      className={`${styles.card}${isStale ? ` ${styles.stale}` : ''}`}
      aria-label={`查看实例 ${instance.hostname} 的历史详情`}
    >
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <Text variant="h3" className={styles.hostname}>
            {instance.hostname}
          </Text>
          <Text variant="muted">v{instance.qoderVersion}</Text>
        </div>
        <StatusBadge effectiveStatus={instance.effectiveStatus} />
      </div>

      <MetricsGrid instance={instance} className={styles.metrics} />

      <Text variant="muted" className={styles.reported}>
        {isStale ? (
          <>
            疑似离线，最后上报 <RelativeTime iso={instance.reportedAt} />
          </>
        ) : (
          <>
            最后上报 <RelativeTime iso={instance.reportedAt} />
          </>
        )}
      </Text>
    </Link>
  );
}

export const InstanceCard = memo(InstanceCardComponent);
