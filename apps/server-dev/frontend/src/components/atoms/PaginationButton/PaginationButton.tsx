/**
 * PaginationButton —— 分页按钮原子。
 * 可访问性：交互区域 ≥ 44px；用 aria-current 标记当前页。
 */
import { memo, type ButtonHTMLAttributes } from 'react';
import styles from './PaginationButton.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  disabled?: boolean;
  /** 屏幕阅读器朗读的标签 */
  label: string;
}

function PaginationButtonComponent({ active, disabled, label, className, children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={`${styles.button}${active ? ` ${styles.active}` : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

export const PaginationButton = memo(PaginationButtonComponent);
