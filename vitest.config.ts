import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['kanban-module/tests/**/*.test.ts'],
    exclude: ['kanban-module/tests/e2e/**', 'node_modules/**'],
  },
});
