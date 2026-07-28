/**
 * Header —— 顶部导航栏组织（Logo + WS 连接状态）。
 */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { WsConnectionIndicator } from '../../molecules/WsConnectionIndicator/WsConnectionIndicator';
import styles from './Header.module.css';

function HeaderComponent() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand} aria-label="qoder 监控首页">
        <span className={styles.logo} aria-hidden="true">◉</span>
        <span className={styles.title}>qoder 监控</span>
      </Link>
      <WsConnectionIndicator />
    </header>
  );
}

export const Header = memo(HeaderComponent);
