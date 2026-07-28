/**
 * 后端测试全局 setup
 *
 * 1. 静默 pino 日志（避免请求日志/错误日志污染测试输出）；
 *    logger.ts 在模块加载时读取 LOG_LEVEL，setup 先于测试文件 import 执行，保证生效。
 * 2. 提供 DATABASE_URL 占位（部分模块加载时可能触及 validateEnv，但被测 Service 仅做类型导入，
 *    不会真正连库；占位避免意外 fail-fast）。
 */
process.env.LOG_LEVEL = 'silent';
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./test-placeholder.db';
}
