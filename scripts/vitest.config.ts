import { defineConfig } from 'vitest/config';

// Exploratory fuzz runs: `npm run fuzz` (SEEDS, STEPS, SOLIDS=1 env vars).
export default defineConfig({
  test: { environment: 'node', include: ['scripts/**/*.test.ts'], testTimeout: 600_000 },
});
