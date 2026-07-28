/**
 * 服务器启动入口（组合根）—— 依赖注入 + HTTP/WS 启动 + 优雅关闭
 *
 * 遵循质量原则第 2 原则（依赖倒置）：在此处把「接口 ← 实现」绑定：
 *   - 数据层 createRepositories() → reportRepo（QoderReportRepository 接口实例）
 *   - InMemoryEventBus → IEventBus
 *   - 各 Service 注入 Repository 接口 + EventBus
 *   - RealtimeGateway 订阅事件总线
 *
 * HTTP（REST）与 WebSocket 共用端口 3000（需求确认报告 §1）。
 *
 * 运行：
 *   - 开发：npm run dev（tsx watch）
 *   - 生产：npm run build && npm start（node dist/index.js）
 */
import { createServer } from 'http';
import { createRepositories, disconnectPrisma } from '../db';
import { loadAppConfig } from '../api/config';
import { createApp } from '../api/app';
import { InMemoryEventBus } from '../api/infra/events/in-memory-event-bus';
import { createWsServer } from '../api/infra/ws/ws-server';
import { ReportController } from '../api/modules/report/report.controller';
import { ReportService } from '../api/modules/report/report.service';
import { InstanceController } from '../api/modules/instance/instance.controller';
import { InstanceService } from '../api/modules/instance/instance.service';
import { RealtimeGateway } from '../api/modules/instance/realtime.gateway';
import { StaleDetectorJob } from '../api/modules/instance/stale-detector.job';
import { DataRetentionJob } from '../api/modules/instance/data-retention.job';
import { EventTopic } from '../api/shared/events/event-bus';
import type { ReportReceivedEvent } from '../api/shared/events/event-bus';
import type { StatusMessageData } from '../api/modules/instance/realtime.gateway';
import { logger } from '../api/shared/logger';

async function main(): Promise<void> {
  // 1. 加载应用配置（环境变量 fail-fast 在数据层 createRepositories 内执行）
  const config = loadAppConfig();

  // 2. 数据层：构建 Repository 接口实例（含 DATABASE_URL fail-fast 校验）
  const { reportRepo } = await createRepositories();

  // 3. 基础设施：进程内事件总线（解耦 report → instance）
  const eventBus = new InMemoryEventBus();

  // 4. 领域 Service（依赖倒置：注入 Repository 接口 + EventBus）
  const reportService = new ReportService(reportRepo, eventBus);
  const instanceService = new InstanceService(reportRepo, config.staleThresholdMs);

  // 5. Controller（极薄，注入 Service）
  const reportController = new ReportController(reportService);
  const instanceController = new InstanceController(instanceService);

  // 6. Express 应用（注入 Controller）
  const app = createApp({
    reportController,
    instanceController,
    corsOrigins: config.corsOrigins,
    bodyLimit: config.bodyLimit,
  });

  // 7. HTTP + WebSocket（共用端口 3000，path=/ws）
  const httpServer = createServer(app);
  const wss = createWsServer({
    server: httpServer,
    allowedOrigins: config.corsOrigins,
    isProd: config.isProd,
  });

  // 8. 实时网关：连接管理 + snapshot/report/status 广播 + 心跳
  const gateway = new RealtimeGateway({
    wss,
    instanceService,
    heartbeatIntervalMs: config.wsHeartbeatIntervalMs,
  });
  gateway.start();

  // 订阅事件：report 到达 → 广播 report；stale 变化 → 广播 status
  eventBus.subscribe<ReportReceivedEvent>(EventTopic.REPORT_RECEIVED, (e) => {
    gateway.onReportReceived(e).catch((err) =>
      logger.error({ err }, '处理 report.received 事件失败'),
    );
  });
  eventBus.subscribe<StatusMessageData>(EventTopic.INSTANCE_STALE_CHANGED, (e) => {
    gateway.onStaleChanged(e);
  });

  // 9. 离线检测后台任务（解决 R-002）
  const staleDetector = new StaleDetectorJob({
    repo: reportRepo,
    eventBus,
    thresholdMs: config.staleThresholdMs,
    intervalMs: config.staleDetectorIntervalMs,
  });
  staleDetector.start();

  // 数据保留清理后台任务（解决 R-004，统一接口文档 C-02 软删除方案）
  const dataRetention = new DataRetentionJob({
    repo: reportRepo,
    retentionDays: config.retentionDays,
    cronIntervalMs: config.retentionCronIntervalMs,
  });
  dataRetention.start();

  // 10. 启动 HTTP 服务
  httpServer.listen(config.port, () => {
    logger.info(
      { port: config.port, wsPath: '/ws' },
      'qoder 监控后端已启动（REST + WebSocket 共用端口）',
    );
  });

  // 11. 优雅关闭（质量原则第 6 原则：资源正确释放）
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '收到关闭信号，开始优雅关闭');
    staleDetector.stop();
    dataRetention.stop();
    gateway.stop();
    wss.close();
    httpServer.close();
    await disconnectPrisma();
    logger.info('已优雅关闭');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// 未捕获的 Promise rejection 兜底（质量红线：不处理 rejection 会导致进程崩溃）
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, '未处理的 Promise rejection');
});

main().catch((err) => {
  logger.fatal({ err }, '服务器启动失败');
  process.exit(1);
});
