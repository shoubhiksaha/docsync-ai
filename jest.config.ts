import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        target: 'ES2022',
      },
    }],
  },
  collectCoverageFrom: [
    'core/**/*.ts',
    'modules/**/*.ts',
    'middleware.ts',
    // Browser logic that is pure enough to unit-test (DOM-bound helpers are covered by e2e).
    'client/scan-flow.ts',
    'client/api.ts',
    'client/i18n/index.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // .claude/ holds Claude Code's temporary worktrees (full copies of the repo).
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/scratch/', '/\\.claude/'],
  modulePathIgnorePatterns: ['/\\.claude/'],
  coverageReporters: ['text', 'lcov', 'html'],
};

export default config;
