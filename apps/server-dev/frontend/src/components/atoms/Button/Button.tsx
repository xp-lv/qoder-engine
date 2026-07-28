/**
 * Button —— 按钮原子（primary / secondary 变体）。
 * 可访问性：交互区域 ≥ 44px（质量原则第 6 原则）。
 */
import { memo, type ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

function ButtonComponent({ variant = 'primary', className, children, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export const Button = memo(ButtonComponent);
