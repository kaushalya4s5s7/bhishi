import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scope to this app's own tests — without an explicit include/exclude,
    // vitest walks the monorepo and picks up unrelated test files from
    // node_modules (e.g. hardhat fixtures in transitive deps).
    include: ['./src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/lib/**'],
  },
});
