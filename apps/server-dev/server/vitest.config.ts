/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

/**
 * 后端单元测试配置（Node 环境）
 *
 * 覆盖 server/api/（Service / Controller / DTO）+ server/db/（Repository）。
 * 测试通过 Mock Repository / 事件总线隔离业务逻辑，Controller 路由用 supertest 走 in-memory Express。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./api/test/setup.ts'],
    include: ['api/test/**/*.test.ts', 'db/test/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15000,
  },
});
