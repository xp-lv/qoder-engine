/**
 * WsConnectionIndicator —— WS 连接状态指示器分子（圆点 + 文字）。
 * 消费全局 wsState 状态机：connecting / connected / reconnecting / error。
 */
import { memo } from 'react';
import { useMonitorStore } from '../../../store/useMonitorStore';
import styles from './WsConnectionIndicator.module.css';

function WsConnectionIndicatorComponent() {
  const wsState = useMonitorStore((s) => s.wsState);

  let dotClass = styles.neutral;
  let text = '连接中…';
  let label = 'WebSocket 正在连接';

  switch (wsState.status) {
    case 'connected':
      dotClass = styles.success;
      text = '实时连接正常';
      label = 'WebSocket 已连接，数据实时更新';
      break;
    case 'connecting':
      dotClass = styles.warning;
      text = '连接中…';
      label = 'WebSocket 正在连接';
      break;
    case 'reconnecting':
      dotClass = styles.warning;
      text = `重连中…（第 ${wsState.attempt} 次）`;
      label = `WebSocket 正在重连，第 ${wsState.attempt} 次`;
      break;
    case 'error':
      dotClass = styles.danger;
      text = '连接中断';
      label = 'WebSocket 连接已中断';
      break;
  }

  return (
    <span className={styles.indicator} role="status" aria-live="polite" aria-label={label}>
      <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
      <span className={styles.text}>{text}</span>
    </span>
  );
}

export const WsConnectionIndicator = memo(WsConnectionIndicatorComponent);
