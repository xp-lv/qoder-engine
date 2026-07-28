/**
 * ErrorBanner —— 错误横幅分子（可重试）。
 */
import { memo, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button';
import styles from './ErrorBanner.module.css';

interface Props {
  message: string;
  /** 重试按钮文案，不传则不显示重试按钮 */
  retryLabel?: string;
  /** 重试按钮是否禁用（如请求进行中防连点，红队 FI-010） */
  retryDisabled?: boolean;
  onRetry?: () => void;
  /** 可选附加内容 */
  children?: ReactNode;
}

function ErrorBannerComponent({ message, retryLabel, retryDisabled, onRetry, children }: Props) {
  return (
    <div className={styles.banner} role="alert" aria-live="assertive">
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        {retryLabel && onRetry ? (
          <Button variant="secondary" onClick={onRetry} disabled={retryDisabled}>
            {retryLabel}
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export const ErrorBanner = memo(ErrorBannerComponent);
