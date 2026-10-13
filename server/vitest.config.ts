import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    // Integration tests share one MongoDB test database, so run files serially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
