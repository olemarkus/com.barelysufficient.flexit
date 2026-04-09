import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.vitest.ts', 'test/unit_registry.test.ts'],
    exclude: ['test/verify_discovery.ts'],
    pool: 'forks',
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'lcov'],
      all: true,
      include: [
        'lib/**/*.ts',
        'drivers/**/*.ts',
        'app.ts',
        'scripts/fake-unit/**/*.ts',
        'scripts/fake-unit.ts',
        'scripts/fake-unit-cli.ts',
        'scripts/bacnet-read-probe.js',
      ],
      exclude: [
        'test/**',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75.5,
      },
    },
  },
});
