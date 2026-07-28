/**
 * 应用集中配置 —— 遵循质量原则第 6 原则：配置即代码，环境变量是第一公民
 *
 * 所有环境相关值用环境变量注入；提供开发默认值；集中管理。
 * 数据库相关配置（DATABASE_URL 校验）由 db/config/database.ts 负责（数据层边界）。
 *
 * 来源：后端设计 §3.2 / §4.4 / §5。
 */
import { logger } from '../shared/logger';

interface AppConfig {
  /** REST + WebSocket 共用端口（需求确认报告 §1） */
  readonly port: number;
  /** CORS 允许的 origin 列表（逗号分隔，开发默认 "*"） */
  readonly corsOrigins: string[];
  /** 离线检测阈值（默认 30_000ms = 3 × 默认采集周期 10s，解决 R-002） */
  readonly staleThresholdMs: number;
  /** 离线检测扫描间隔（默认 10s） */
  readonly staleDetectorIntervalMs: number;
  /** WebSocket 心跳 ping 间隔（默认 30s，配合 R-004） */
  readonly wsHeartbeatIntervalMs: number;
  /** 请求体大小上限（防超大 payload，后端设计 §5） */
  readonly bodyLimit: string;
  /** 数据保留天数（默认 30，0=禁用自动清理；解决 R-004） */
  readonly retentionDays: number;
  /** 数据保留清理扫描间隔（默认每日一次） */
  readonly retentionCronIntervalMs: number;
  /** 是否生产环境 */
  readonly isProd: boolean;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

/**
 * 加载应用配置（启动时调用一次）
 *
 * 环境变量清单：
 * - PORT（默认 3000）
 * - CORS_ORIGINS（逗号分隔，默认 "*"）
 * - STALE_THRESHOLD_MS（默认 30000）
 * - STALE_DETECTOR_INTERVAL_MS（默认 10000）
 * - WS_HEARTBEAT_INTERVAL_MS（默认 30000）
 * - RETENTION_DAYS（默认 30，0=禁用；解决 R-004）
 * - RETENTION_CRON_INTERVAL_MS（默认 86400000 = 24h）
 * - NODE_ENV / LOG_LEVEL
 */
export function loadAppConfig(): AppConfig {
  const config: AppConfig = {
    port: parsePositiveInt(process.env.PORT, 3000),
    corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
    staleThresholdMs: parsePositiveInt(process.env.STALE_THRESHOLD_MS, 30_000),
    staleDetectorIntervalMs: parsePositiveInt(process.env.STALE_DETECTOR_INTERVAL_MS, 10_000),
    wsHeartbeatIntervalMs: parsePositiveInt(process.env.WS_HEARTBEAT_INTERVAL_MS, 30_000),
    bodyLimit: process.env.BODY_LIMIT ?? '64kb',
    retentionDays: parseNonNegativeInt(process.env.RETENTION_DAYS, 30),
    retentionCronIntervalMs: parsePositiveInt(process.env.RETENTION_CRON_INTERVAL_MS, 24 * 60 * 60 * 1000),
    isProd: process.env.NODE_ENV === 'production',
  };

  // BI-004 fix：生产环境 CORS 默认 "*" 安全告警。
  // 本系统无认证体系（后端设计 §3.1），生产环境若遗漏 CORS_ORIGINS 显式配置，
  // 任意网站均可经 REST 读取监控数据、经 WS 接收实时推送，构成安全风险。
  if (config.isProd && (config.corsOrigins.includes('*') || config.corsOrigins.length === 0)) {
    logger.warn(
      { corsOrigins: config.corsOrigins },
      '⚠️ 生产环境 CORS_ORIGINS 未显式配置（含 "*" 或为空）。结合本系统无认证体系，任意来源均可访问。'
        + '建议显式列出前端 SPA origin 与 Ext origin（如 http://localhost:5173,chrome-extension://<id>）。',
    );
  }

  logger.info({ config: { ...config, corsOrigins: config.corsOrigins } }, '应用配置已加载');
  return config;
}
