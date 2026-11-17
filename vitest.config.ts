import { defineConfig } from 'vitest/config';

// Unit tests cover the pure, side-effect-free helpers in the main process
// (arg building, prompt assembly, templates). Anything that needs Electron or a
// live `claude` subprocess is verified by the smoketest and golden runs instead.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
