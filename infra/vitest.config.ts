import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lambda/**/*.test.ts', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['node_modules/**', 'cdk.out/**'],
    // Forces every unmocked AWS SDK call to a dead endpoint with fake credentials.
    setupFiles: ['./test/setup-no-aws.ts'],
    // CDK synth-based tests are slow.
    testTimeout: 30000,
  },
});
