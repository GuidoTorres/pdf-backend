import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 120000, // 2 minutes for load tests
    hookTimeout: 30000,  // 30 seconds for setup/teardown
    teardownTimeout: 15000, // 15 seconds for cleanup
    // Separate timeouts for load tests
    include: [
      'test/**/*.test.js',
      'test/load/**/*.test.js'
    ],
    // Configure load test specific settings
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true // Load tests should run in single thread for accurate metrics
      }
    }
  }
});