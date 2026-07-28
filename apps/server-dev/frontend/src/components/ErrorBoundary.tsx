/**
 * ErrorBoundary —— 错误边界，包裹关键组件（质量原则第 4 原则）。
 * 捕获子组件渲染异常，展示降级 UI，避免整页白屏。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  /** 自定义降级 UI 标题 */
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 生产环境应接入专业日志工具（质量红线：禁止 console.log 留在生产代码）
    // 此处仅保留必要兜底，可由监控 SDK 覆盖。
    void error;
    void info;
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: '' });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className={styles.container} role="alert" aria-live="assertive">
        <div className={styles.card}>
          <h2 className={styles.title}>{this.props.fallbackTitle ?? '页面渲染异常'}</h2>
          <p className={styles.message}>{this.state.message || '发生了未知错误'}</p>
          <button type="button" className={styles.button} onClick={this.handleReset}>
            重试
          </button>
        </div>
      </div>
    );
  }
}
