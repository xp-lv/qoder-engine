/**
 * 结构化日志（pino）—— 遵循质量原则第 6 原则：可观测性
 *
 * 后端设计 §1 选型 pino。开发环境用 pino-pretty 美化输出，生产环境输出 JSON。
 * 全应用共享同一 logger 实例。
 */
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
    : {}),
});
