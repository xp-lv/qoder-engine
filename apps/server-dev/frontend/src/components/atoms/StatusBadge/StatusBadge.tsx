/**
 * StatusBadge —— 状态徽标原子（running/idle/error/offline 圆点 + 文字）。
 * 视觉焦点之一，颜色区分状态（语义色映射 qoder status）。
 */
import { memo } from 'react';
import type { EffectiveStatus } from '../../../types';
import styles from './StatusBadge.module.css';

interface Props {
  /** 有效状态（服务端派生 effectiveStatus，C-01） */
  effectiveStatus: EffectiveStatus;
}

const LABEL: Record<EffectiveStatus, string> = {
  running: '运行中',
  idle: '空闲',
  error: '异常',
  stale: '离线',
};

function StatusBadgeComponent({ effectiveStatus }: Props) {
  return (
    <span className={`${styles.badge} ${styles[effectiveStatus]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {LABEL[effectiveStatus]}
    </span>
  );
}

export const StatusBadge = memo(StatusBadgeComponent);
