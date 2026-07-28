/**
 * 迁移运行器（Migration Runner）
 *
 * 职责：加载 migrations/ 目录下所有迁移，按 id 排序执行 up/down，
 *       记录已执行迁移到 _migrations 表，支持回滚。
 *
 * 遵循质量原则第 5 原则：迁移脚本是代码，需要版本治理。
 * 使用方式：tsx db/migrate.ts up | down
 */
import { prisma, disconnectPrisma } from './infrastructure/prisma-client';
import { Prisma } from '@prisma/client';
import { isSQLite } from './config/database';

/**
 * 迁移定义接口
 */
export interface Migration {
  /** 迁移 ID（格式：YYYYMMDD_NNN_description） */
  id: string;
  /** 迁移描述 */
  description: string;
  /** 正向迁移：创建表/索引/数据 */
  up: (executeSql: (sql: string) => Promise<void>) => Promise<void>;
  /** 反向迁移：撤销 up 的所有变更 */
  down: (executeSql: (sql: string) => Promise<void>) => Promise<void>;
}

/**
 * 执行原始 SQL（通过 Prisma $executeRawUnsafe）
 *
 * DI-001 fix：Prisma 5 的 $executeRawUnsafe 仅支持单条 SQL 语句，
 * 调用方需逐条传入 SQL（不可拼接多条语句）。事务由 migrateUp/migrateDown
 * 内的 prisma.$transaction 包裹（DI-003 fix）。
 *
 * @param sql 单条 SQL 语句
 */
async function executeSql(sql: string): Promise<void> {
  await prisma.$executeRawUnsafe(sql);
}

/**
 * 确保 _migrations 记录表存在
 *
 * fail_deep fix #1：方言兼容——SQLite 使用 CURRENT_TIMESTAMP（SQL 标准），
 * PostgreSQL 保留 NOW()。两者均为时间默认值。
 */
async function ensureMigrationsTable(): Promise<void> {
  const nowDefault = isSQLite() ? 'CURRENT_TIMESTAMP' : 'NOW()';
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
        id          VARCHAR(100) PRIMARY KEY,
        description TEXT,
        executed_at TIMESTAMP NOT NULL DEFAULT ${nowDefault}
    );
  `);
}

/**
 * 获取已执行的迁移 ID 列表
 */
async function getExecutedMigrations(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM _migrations ORDER BY id ASC
  `;
  return rows.map((r) => r.id);
}

/**
 * 动态加载所有迁移文件（按文件名排序）
 *
 * 迁移文件命名格式：YYYYMMDD_NNN_description.ts
 */
async function loadMigrations(): Promise<Migration[]> {
  // 使用 fs 动态加载 migrations 目录
  const fs = await import('fs');
  const path = await import('path');

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .sort(); // 按文件名排序，确保时间戳顺序

  const migrations: Migration[] = [];
  for (const file of files) {
    const modulePath = path.join(migrationsDir, file);
    const mod = await import(modulePath);
    if (mod.default && typeof mod.default.id === 'string') {
      migrations.push(mod.default as Migration);
    }
  }

  return migrations.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 执行正向迁移（up）
 *
 * 加载所有未执行的迁移，按 id 顺序执行 up()，记录到 _migrations 表。
 *
 * DI-003 fix：迁移 DDL 执行与 _migrations 版本记录插入包裹在同一个
 * prisma.$transaction 中，确保"DDL 已应用但版本未记录"的不一致状态不会发生。
 * DI-002 fix：_migrations 表操作使用 Prisma tagged template（参数化绑定），
 * 彻底消除 SQL 注入面。
 */
async function migrateUp(): Promise<void> {
  await ensureMigrationsTable();
  const executed = new Set(await getExecutedMigrations());
  const migrations = await loadMigrations();

  const pending = migrations.filter((m) => !executed.has(m.id));

  if (pending.length === 0) {
    console.log('[migrate] 无待执行的迁移，数据库已是最新。');
    return;
  }

  console.log(`[migrate] 待执行迁移：${pending.length} 个`);
  for (const migration of pending) {
    console.log(`[migrate] ↑ 执行 up: ${migration.id} — ${migration.description}`);
    // DDL 执行 + 版本记录包裹在同一事务中（DI-003 fix），任一步失败整体回滚
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 创建 tx 作用域的 SQL 执行器，确保迁移语句在事务内执行
      const txExecuteSql = async (sql: string): Promise<void> => {
        await tx.$executeRawUnsafe(sql);
      };
      await migration.up(txExecuteSql);
      // 参数化查询（DI-002 fix）：使用 Prisma tagged template 自动绑定参数
      await tx.$executeRaw`INSERT INTO _migrations (id, description) VALUES (${migration.id}, ${migration.description})`;
    });
    console.log(`[migrate] ✓ 完成: ${migration.id}`);
  }
  console.log('[migrate] 全部迁移执行完毕。');
}

/**
 * 执行反向迁移（down）—— 回滚最后一个迁移
 *
 * 查找最后执行的迁移，执行 down()，从 _migrations 表删除记录。
 *
 * DI-003 fix：迁移 DDL 回滚与 _migrations 记录删除包裹在同一个事务中。
 * DI-002 fix：_migrations 表操作使用参数化查询。
 */
async function migrateDown(): Promise<void> {
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();
  const migrations = await loadMigrations();

  if (executed.length === 0) {
    console.log('[migrate] 无可回滚的迁移。');
    return;
  }

  const lastExecutedId = executed[executed.length - 1];
  const migration = migrations.find((m) => m.id === lastExecutedId);

  if (!migration) {
    throw new Error(`[migrate] 找不到迁移文件：${lastExecutedId}`);
  }

  console.log(`[migrate] ↓ 执行 down: ${migration.id} — ${migration.description}`);
  // DDL 回滚 + 版本记录删除包裹在同一事务中（DI-003 fix）
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const txExecuteSql = async (sql: string): Promise<void> => {
      await tx.$executeRawUnsafe(sql);
    };
    await migration.down(txExecuteSql);
    // 参数化查询（DI-002 fix）
    await tx.$executeRaw`DELETE FROM _migrations WHERE id = ${migration.id}`;
  });
  console.log(`[migrate] ✓ 已回滚: ${migration.id}`);
}

/**
 * CLI 入口
 *
 * 用法：
 *   tsx db/migrate.ts up     # 执行正向迁移
 *   tsx db/migrate.ts down   # 回滚最后一个迁移
 */
async function main(): Promise<void> {
  const direction = process.argv[2];

  if (direction !== 'up' && direction !== 'down') {
    console.error('用法: tsx db/migrate.ts <up|down>');
    process.exit(1);
  }

  try {
    if (direction === 'up') {
      await migrateUp();
    } else {
      await migrateDown();
    }
  } catch (err) {
    console.error('[migrate] 迁移失败：', err);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
}

// 仅在直接执行时运行 main（不作为模块导入）
if (require.main === module) {
  main();
}

// 防止 Prisma 类型未使用警告
void Prisma;
