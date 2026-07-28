/**
 * 数据库连接配置 —— 遵循质量原则第 6 原则：配置即代码 + 事务完整性
 *
 * 核心约束：
 * - DATABASE_URL 必须来自环境变量，启动时 fail-fast 校验，缺失则拒绝启动
 * - 禁止任何硬编码连接字符串
 * - 集中管理所有数据库配置
 *
 * fail_deep fix #2（isolationLevel 条件化）：
 * - SQLite 的 Prisma 客户端 TransactionIsolationLevel 枚举仅含 'Serializable'，
 *   传入 'ReadCommitted' 会触发 tsc 构建错误（生产构建失败）。
 * - 本文件提供统一的 getTransactionOptions()：SQLite 返回 undefined（使用默认隔离），
 *   PostgreSQL 返回 { isolationLevel: 'ReadCommitted' }。
 * - 所有 $transaction 调用必须通过此函数获取选项，禁止内联硬编码 isolationLevel。
 */

/**
 * 必需环境变量清单
 * 启动时逐项校验，缺失任一项则 fail-fast 抛错并拒绝启动
 */
const REQUIRED_ENV_VARS = ['DATABASE_URL'] as const;

/**
 * 检测当前数据库 provider 是否为 SQLite
 *
 * 通过 DATABASE_URL 协议前缀判断：
 * - file: 开头 → SQLite（本地验证/无 PostgreSQL 环境）
 * - postgresql:// 或 postgres:// → PostgreSQL（生产）
 *
 * fail_deep fix #1/#2：迁移脚本与事务选项均依赖此函数做 provider 条件化。
 */
export function isSQLite(): boolean {
  return process.env.DATABASE_URL?.startsWith('file:') ?? false;
}

/**
 * 校验必需环境变量
 *
 * 遵循质量原则第 6 原则：启动时校验必需变量，缺失则 fail fast。
 * 在应用启动入口（如 src/index.ts）调用此函数，确保数据库依赖就绪。
 *
 * @throws {Error} 当任何必需环境变量缺失或为空时抛出
 */
export function validateEnv(): void {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    const value = process.env[key];
    if (value === undefined || value === null || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    // fail-fast：缺失必需环境变量，拒绝启动
    throw new Error(
      `[database/config] 启动失败：必需环境变量缺失 → ${missing.join(', ')}。\n` +
        '请在 .env 文件或部署环境中设置这些变量。\n' +
        '示例（PostgreSQL）：DATABASE_URL="postgresql://user:password@localhost:5432/qoder_monitor?schema=public"\n' +
        '示例（SQLite 验证）：DATABASE_URL="file:./dev.db"'
    );
  }

  // 校验 DATABASE_URL 格式（必须以 postgresql:// / postgres:// / file: 开头）
  // 验证适配：同时支持 SQLite（file:）用于本地无 PostgreSQL 的运行验证
  const databaseUrl = process.env.DATABASE_URL!;
  if (
    !databaseUrl.startsWith('postgresql://') &&
    !databaseUrl.startsWith('postgres://') &&
    !databaseUrl.startsWith('file:')
  ) {
    throw new Error(
      `[database/config] 启动失败：DATABASE_URL 格式不正确，必须以 "postgresql://"、"postgres://" 或 "file:" 开头。` +
        ` 当前值前缀："${databaseUrl.slice(0, 20)}..."`
    );
  }
}

/**
 * 获取 Prisma 事务隔离级别选项（验证适配集中化）
 *
 * fail_deep fix #2：SQLite 生成的 Prisma 客户端 TransactionIsolationLevel 枚举
 * 仅含 'Serializable'，直接传 { isolationLevel: 'ReadCommitted' } 会触发 tsc 类型错误
 * （"'ReadCommitted' 不能赋值给 'Serializable'"），导致生产构建失败。
 *
 * 本函数根据 provider 动态返回：
 * - SQLite → undefined（使用 Prisma/SQLite 默认隔离级别 SERIALIZABLE）
 * - PostgreSQL → { isolationLevel: 'ReadCommitted' }（质量原则第 6 原则：默认 Read Committed）
 *
 * 返回类型使用宽松的事务选项签名（isolationLevel?: string），通过运行时
 * 条件化确保 SQLite 环境永不进入 ReadCommitted 分支。
 * 调用方直接将返回值传入 prisma.$transaction(fn, options)，无需额外断言。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TransactionOptions = any;

export function getTransactionOptions(): TransactionOptions {
  if (isSQLite()) {
    // SQLite：不设置 isolationLevel（Prisma SQLite 驱动不支持显式隔离级别设置）
    return undefined;
  }
  // PostgreSQL：显式声明 ReadCommitted（质量原则第 6 原则）
  return { isolationLevel: 'ReadCommitted' };
}

/**
 * 数据库配置（只读快照，应用启动后不可变）
 *
 * fail_deep fix #2：isolationLevel 不再硬编码于配置对象（provider 相关），
 * 改由 getTransactionOptions() 在使用点动态返回。
 */
export interface DatabaseConfig {
  /** Prisma 连接字符串，来自 DATABASE_URL 环境变量 */
  url: string;
  /** 数据库 provider：'sqlite' | 'postgresql' */
  provider: 'sqlite' | 'postgresql';
}

/**
 * 获取数据库配置
 *
 * 内部调用 validateEnv() 确保 fail-fast。返回不可变配置对象，
 * 全应用共享同一配置实例（配置集中管理）。
 *
 * @returns 数据库配置快照
 * @throws {Error} 当必需环境变量缺失时抛出（fail-fast）
 */
export function getDatabaseConfig(): DatabaseConfig {
  validateEnv();

  return Object.freeze({
    url: process.env.DATABASE_URL!,
    provider: isSQLite() ? ('sqlite' as const) : ('postgresql' as const),
  });
}
