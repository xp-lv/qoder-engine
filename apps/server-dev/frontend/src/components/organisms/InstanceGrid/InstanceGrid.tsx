/**
 * InstanceGrid —— 实例卡片网格组织（监控面板视觉焦点）。
 * 响应式 grid：桌面 3 列，平板 2 列，手机 1 列。
 */
import { memo } from 'react';
import type { Instance } from '../../../types';
import { InstanceCard } from '../../molecules/InstanceCard/InstanceCard';
import styles from './InstanceGrid.module.css';

interface Props {
  instances: Instance[];
}

function InstanceGridComponent({ instances }: Props) {
  return (
    <div className={styles.grid} role="list" aria-label="qoder 实例列表">
      {instances.map((instance) => (
        <div key={instance.instanceId} role="listitem">
          <InstanceCard instance={instance} />
        </div>
      ))}
    </div>
  );
}

export const InstanceGrid = memo(InstanceGridComponent);
