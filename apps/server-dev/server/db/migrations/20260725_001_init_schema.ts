/**
 * 初始迁移脚本 —— 数据层设计 §5.1
 *
 * 遵循质量原则第 5 原则：迁移脚本是代码，需要版本治理
 * - 命名格式：YYYYMMDD_NNN_description.ts（含时间戳）
 * - up/down 对称：down() 完整撤销 up() 的所有变更
 * - 事务包裹：所有 DDL/DML 包裹在事务中，失败整体回滚（质量原则第 6 原则）
 * - 不可修改：已执行的迁移文件永远不改，新需求写新迁移
 *
 * fail_deep fix #1（方言兼容）：
 * - 原脚本全量使用 PostgreSQL 专属语法（SERIAL/NOW()/DOUBLE PRECISION/setval），
 *   与当前 SQLite provider 配置不兼容，全新环境无法初始化数据库。
 * - 本脚本已改为方言感知：根据 DATABASE_URL 前缀动态生成 SQLite 或 PostgreSQL SQL。
 * - 注：此迁移此前从未在任何环境成功执行（因语法不兼容全新环境初始化即失败），
 *   故修改不存在"已执行迁移不可改"的冲突。
 *
 * up 操作：
 *   ① 创建 report_status 表 + 唯一索引
 *   ② INSERT 3 条种子数据（running/idle/error）
 *   ③ （仅 PostgreSQL）重置 SERIAL 序列
 *   ④ 创建 qoder_report 表 + PK + 复合索引 + FK 约束
 *
 * down 操作：
 *   ① DROP TABLE qoder_report（含索引、FK 自动级联删除）
 *   ② DROP TABLE report_status
 */

import type { Migration } from '../migrate';
import { isSQLite } from '../config/database';

const migration: Migration = {
  // 文件名时间戳格式：YYYYMMDD_NNN_description
  id: '20260725_001_init_schema',
  description: '初始 schema：report_status 状态查找表 + qoder_report 上报记录表 + 索引 + 种子数据（SQLite/PostgreSQL 双方言兼容）',

  /**
   * up —— 创建表结构、索引、外键，插入种子数据
   *
   * 每条 DDL/DML 单独调用 executeSql（Prisma $executeRawUnsafe 仅支持单语句）。
   * 事务由迁移运行器（migrate.ts）通过 prisma.$transaction 包裹。
   *
   * fail_deep fix #1：方言感知——根据 provider 选择 SQL 语法：
   * - 自增主键：SQLite → INTEGER PRIMARY KEY AUTOINCREMENT；PostgreSQL → SERIAL PRIMARY KEY
   * - 时间默认值：SQLite → CURRENT_TIMESTAMP；PostgreSQL → NOW()
   * - 双精度浮点：SQLite → REAL；PostgreSQL → DOUBLE PRECISION
   * - 序列重置：仅 PostgreSQL 执行 setval（SQLite 的 AUTOINCREMENT 自管理，无需手动重置）
   */
  async up(executeSql: (sql: string) => Promise<void>): Promise<void> {
    const sqlite = isSQLite();

    // 方言相关的 SQL 片段
    const autoIncPk = sqlite
      ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
      : 'SERIAL PRIMARY KEY';
    const nowDefault = sqlite ? 'CURRENT_TIMESTAMP' : 'NOW()';
    const doubleType = sqlite ? 'REAL' : 'DOUBLE PRECISION';

    // ① 创建 report_status（状态查找表）
    await executeSql(`
      CREATE TABLE report_status (
          id          ${autoIncPk},
          code        VARCHAR(20)  NOT NULL,
          label       VARCHAR(50)  NOT NULL,
          sort_order  INTEGER      NOT NULL DEFAULT 0,
          created_at  TIMESTAMP    NOT NULL DEFAULT ${nowDefault},
          updated_at  TIMESTAMP    NOT NULL DEFAULT ${nowDefault},
          CONSTRAINT report_status_code_key UNIQUE (code)
      )
    `);

    // ② 插入 3 条种子数据（running / idle / error）
    await executeSql(`
      INSERT INTO report_status (id, code, label, sort_order) VALUES
          (1, 'running', '运行中', 1),
          (2, 'idle',    '空闲',   2),
          (3, 'error',   '错误',   3)
    `);

    // ③ 重置自增序列（仅 PostgreSQL 需要）
    // SQLite 的 AUTOINCREMENT 自管理 rowid，无需手动重置
    if (!sqlite) {
      await executeSql(`
        SELECT setval('report_status_id_seq', COALESCE((SELECT MAX(id) FROM report_status), 1), true)
      `);
    }

    // ④ 创建 qoder_report（qoder 上报记录，append-only）
    await executeSql(`
      CREATE TABLE qoder_report (
          id              ${autoIncPk},
          instance_id     VARCHAR(36)  NOT NULL,
          hostname        VARCHAR(255) NOT NULL,
          qoder_version   VARCHAR(50)  NOT NULL,
          status_id       INTEGER      NOT NULL,
          uptime          INTEGER      CHECK (uptime >= 0),
          cpu_usage       ${doubleType} CHECK (cpu_usage BETWEEN 0 AND 100),
          mem_usage       ${doubleType} CHECK (mem_usage BETWEEN 0 AND 100),
          workspace_count INTEGER      CHECK (workspace_count >= 0),
          reported_at     TIMESTAMP    NOT NULL,
          created_at      TIMESTAMP    NOT NULL DEFAULT ${nowDefault},
          updated_at      TIMESTAMP    NOT NULL DEFAULT ${nowDefault},
          deleted_at      TIMESTAMP,
          CONSTRAINT fk_qoder_report_status
              FOREIGN KEY (status_id) REFERENCES report_status (id)
              ON DELETE RESTRICT
      )
    `);

    // ⑤ 创建复合索引（覆盖历史分页 + 最新状态聚合 + 离线检测）
    await executeSql(`
      CREATE INDEX idx_qoder_report_instance_reported
          ON qoder_report (instance_id, reported_at DESC)
    `);
  },

  /**
   * down —— 完整撤销 up() 的所有变更
   *
   * up/down 对称：down() 撤销 up() 的全部 DDL。
   * DROP TABLE 自动级联删除关联的索引和 FK 约束。
   * 每条 DDL 单独调用 executeSql。事务由迁移运行器包裹。
   */
  async down(executeSql: (sql: string) => Promise<void>): Promise<void> {
    // ① 先 DROP qoder_report（含索引、FK 自动级联删除）
    await executeSql(`DROP TABLE IF EXISTS qoder_report`);

    // ② 再 DROP report_status（此时无 FK 引用，可安全删除）
    await executeSql(`DROP TABLE IF EXISTS report_status`);
  },
};

export default migration;
