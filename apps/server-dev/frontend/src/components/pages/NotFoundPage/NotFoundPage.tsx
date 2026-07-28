/**
 * NotFoundPage —— 404 兜底（路由 *，React.lazy 懒加载）。
 */
import { Link } from 'react-router-dom';
import { EmptyState } from '../../atoms/EmptyState/EmptyState';
import { Button } from '../../atoms/Button/Button';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <EmptyState
        icon="🧭"
        title="页面不存在"
        description="你访问的页面不存在或已被移除。"
        action={
          <Link to="/">
            <Button>返回监控面板</Button>
          </Link>
        }
      />
    </div>
  );
}
