/**
 * Express 应用组装（组合根之一）—— 装配中间件链 + 路由
 *
 * 遵循后端设计 §4.1：组合根负责依赖注入；本文件装配 HTTP 层（中间件顺序见后端设计 §5）。
 * 控制器实例由 src/index.ts（启动组合根）构造并注入，保持 app 工厂可独立测试。
 *
 * 中间件顺序（后端设计 §5）：
 *   cors → body-size → json → request-logger → 业务路由 → not-found → error-handler
 */
import cors from 'cors';
import express, { type Express } from 'express';
import type { InstanceController } from './modules/instance/instance.controller';
import { createInstanceRouter } from './modules/instance/instance.routes';
import type { ReportController } from './modules/report/report.controller';
import { createReportRouter } from './modules/report/report.routes';
import { createBodySizeGuard } from './middleware/body-size';
import { errorHandler } from './middleware/error-handler';
import { notFound } from './middleware/not-found';
import { requestLogger } from './middleware/request-logger';

export interface AppDeps {
  reportController: ReportController;
  instanceController: InstanceController;
  /** CORS 允许 origin 列表（开发默认 ["*"]） */
  corsOrigins: string[];
  /** 请求体大小上限（如 "64kb"） */
  bodyLimit: string;
}

/**
 * 创建并返回已装配的 Express 应用（不含 HTTP 监听，便于测试）
 */
export function createApp(deps: AppDeps): Express {
  const app = express();

  // 1. CORS（后端设计 §3.2）：允许前端 SPA + Ext origin；仅 GET/POST
  //    规整通配符：含 "*" 时按通配放行（开发默认），否则按显式 origin 列表精确匹配
  const corsOrigin: string | string[] = deps.corsOrigins.includes('*')
    ? '*'
    : deps.corsOrigins;
  app.use(
    cors({
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      maxAge: 600,
    }),
  );

  // 2. 请求体大小限制 + JSON 解析（防超大 payload）
  app.use(createBodySizeGuard());
  app.use(express.json({ limit: deps.bodyLimit }));

  // 3. 请求日志（结构化）
  app.use(requestLogger);

  // 4. 业务路由（无认证 —— 后端设计 §3.1）
  app.use('/api/reports', createReportRouter(deps.reportController));
  app.use('/api/instances', createInstanceRouter(deps.instanceController));

  // 健康检查（轻量，不依赖 DB，便于部署探活）
  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // 5. 未匹配路由 → 404
  app.use(notFound);

  // 6. 全局错误中间件兜底（必须最后注册，4 参数签名）
  app.use(errorHandler);

  return app;
}
