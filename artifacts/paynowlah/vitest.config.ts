import { defineConfig } from 'vitest/config';

// Deliberately separate from Vite's server config: tests need no PORT or BASE_PATH.
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
