/**
 * EmptyState —— 空状态提示原子（图标 + 文案）。
 */
import { memo, type ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** 可选操作区（如按钮） */
  action?: ReactNode;
}

function EmptyStateComponent({ icon, title, description, action }: Props) {
  return (
    <div className={styles.container} role="status">
      {icon ? <div className={styles.icon} aria-hidden="true">{icon}</div> : null}
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

export const EmptyState = memo(EmptyStateComponent);
