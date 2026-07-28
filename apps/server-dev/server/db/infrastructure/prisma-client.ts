/**
 * Prisma Client 单例 —— 基础设施层
 *
 * 遵循质量原则第 4 原则（Repository 模式）：本文件提供 Prisma Client 实例，
 * 但业务逻辑（Service 层）不直接 import 此文件，而是通过 Repository 接口访问。
 * 仅 Repository 实现类（db/infrastructure/*.ts）依赖此 Prisma Client。
 *
 * 遵循质量原则第 6 原则（配置即代码）：启动时调用 validateEnv() 做 fail-fast 校验。
 */
import { PrismaClient } from '@prisma/client';
import { validateEnv } from '../config/database';

// 模块级单例：全应用共享同一 PrismaClient 实例（连接池复用）
// 避免热重载场景下创建多个连接（开发环境 __dirname 检查）
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * 获取 Prisma Client 单例
 *
 * 首次调用时创建实例并触发 fail-fast 环境变量校验。
 * 后续调用返回同一单例（连接池复用）。
 *
 * @returns PrismaClient 单例
 * @throws {Error} 当 DATABASE_URL 缺失时抛出（fail-fast，来自 validateEnv）
 */
export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    // fail-fast：创建客户端前校验环境变量
    validateEnv();

    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return globalForPrisma.prisma;
}

/**
 * 导出单例（供 Repository 实现类直接使用）
 *
 * 注意：首次 import 本模块时即创建实例并触发 fail-fast 校验。
 */
export const prisma = getPrismaClient();

/**
 * 优雅关闭数据库连接
 *
 * 应在应用关闭信号（SIGTERM / SIGINT）处理中调用，确保连接池正确释放。
 */
export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.prisma) {
    await globalForPrisma.prisma.$disconnect();
    globalForPrisma.prisma = undefined;
  }
}
