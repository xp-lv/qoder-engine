/**
 * DashboardLayout —— 通用布局模板（Header + 主内容区 + 留白边距）。
 * 通过 React Router <Outlet /> 渲染嵌套子路由（质量原则第 3 原则：模板分层）。
 */
import { Outlet } from 'react-router-dom';
import { Header } from '../../organisms/Header/Header';
import { ErrorBoundary } from '../../ErrorBoundary';
import styles from './DashboardLayout.module.css';

export function DashboardLayout() {
  return (
    <div className={styles.layout}>
      <Header />
      <main className={styles.main} id="main-content">
        <ErrorBoundary fallbackTitle="内容区渲染异常">
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
