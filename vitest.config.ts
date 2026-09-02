import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Agent worktrees are full checkouts living inside the repo. Without this,
    // vitest collects every worktree's copy of the suite and the run reports a
    // multiple of the real test count - a number that looks like progress and
    // measures nothing. The gate walks tests/ directly and was never affected,
    // which is exactly why the discrepancy was visible at all.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
  },
});
