import { defineConfig } from 'vitest/config';

// MySQL setup and scrypt can be slow on Windows hosts sharing resources with Docker.
export default defineConfig({
  test: { include: ['tests/integration/**/*.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 60000 },
});
