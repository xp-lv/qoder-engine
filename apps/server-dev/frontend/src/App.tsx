/**
 * 应用根组件——路由配置（质量原则第 5 原则：路由级代码分割）。
 *
 * 加载策略：
 *  - DashboardPage（/）首屏直接加载（LCP 关键路径）
 *  - InstanceDetailPage（/instances/:instanceId）React.lazy 懒加载
 *  - NotFoundPage（*）React.lazy 懒加载
 *
 * ErrorBoundary 包裹 Suspense 与路由出口，捕获懒加载/渲染异常。
 */
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardLayout } from './components/templates/DashboardLayout/DashboardLayout';
import { DashboardPage } from './components/pages/DashboardPage/DashboardPage';
import { SkeletonPage } from './components/atoms/SkeletonBox/SkeletonBox';

const InstanceDetailPage = lazy(() =>
  import('./components/pages/InstanceDetailPage/InstanceDetailPage').then((m) => ({
    default: m.InstanceDetailPage,
  })),
);
const NotFoundPage = lazy(() =>
  import('./components/pages/NotFoundPage/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="应用发生异常">
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="instances/:instanceId"
            element={
              <Suspense fallback={<SkeletonPage />}>
                <InstanceDetailPage />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <Suspense fallback={<SkeletonPage />}>
                <NotFoundPage />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
