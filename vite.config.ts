import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  // scripts/ holds exploratory runs (npm run fuzz), not part of the test suite.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
