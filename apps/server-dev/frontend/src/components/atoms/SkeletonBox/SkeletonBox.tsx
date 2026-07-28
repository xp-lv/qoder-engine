/**
 * SkeletonBox —— 骨架屏占位原子（质量原则第 5 原则：感知性能）。
 * 微光扫描动画，背景 --color-bg-muted，圆角 --radius-md。
 * 骨架结构 1:1 还原真实组件布局，避免加载完成后的布局抖动（CLS）。
 */
import { memo } from 'react';
import styles from './SkeletonBox.module.css';

interface Props {
  /** 宽度（CSS 值，默认 100%） */
  width?: string;
  /** 高度（CSS 值，默认 1em） */
  height?: string;
  /** 圆角（默认引用 --radius-md） */
  radius?: string;
  /** 无障碍标签 */
  'aria-label'?: string;
}

function SkeletonBoxComponent({ width = '100%', height = '1em', radius, ...aria }: Props) {
  return (
    <span
      className={styles.box}
      role="status"
      aria-label={aria['aria-label'] ?? '加载中'}
      style={
        {
          '--skeleton-width': width,
          '--skeleton-height': height,
          '--skeleton-radius': radius ?? 'var(--radius-md)',
        } as React.CSSProperties
      }
    />
  );
}

export const SkeletonBox = memo(SkeletonBoxComponent);

/** 整页骨架占位（路由 lazy loading 时的 Suspense fallback） */
export function SkeletonPage() {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite">
      <SkeletonBox width="200px" height="1.75rem" />
      <div className={styles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.card}>
            <SkeletonBox width="40%" height="0.875rem" />
            <SkeletonBox width="60%" height="1.5rem" />
            <div className={styles.row}>
              <SkeletonBox width="45%" height="1.25rem" />
              <SkeletonBox width="45%" height="1.25rem" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
