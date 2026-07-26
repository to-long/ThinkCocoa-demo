/**
 * Jest config — uses @swc/jest for fast TS/TSX transpilation (no
 * type-check; that's `tsc --noEmit`'s job in CI). jsdom env so
 * components rendered with React Testing Library have a DOM.
 *
 * Path aliases mirror tsconfig (`@/...` → `src/...`). CSS / asset
 * imports are stubbed to avoid Jest blowing up on shadcn / Tailwind /
 * SVG side-effect imports — tests should never assert on styling.
 *
 * Test files: anything matching `*.test.ts(x)` or `*.spec.ts(x)`
 * under `src/` or `tests/`.
 */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: [
    '<rootDir>/src/**/*.{test,spec}.{ts,tsx}',
    '<rootDir>/tests/**/*.{test,spec}.{ts,tsx}',
  ],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true, decorators: false },
          transform: { react: { runtime: 'automatic' } },
          target: 'es2022',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/style-mock.js',
    '\\.(png|jpg|jpeg|gif|svg|webp|woff2?)$': '<rootDir>/tests/file-mock.js',
  },
  // react-intl + @formatjs ship as ESM. SWC has to transform them or
  // jest crashes on `import` syntax inside node_modules. The Bun
  // package layout (`node_modules/.bun/<name>@<version>+<hash>/...`)
  // means a simple `(?!react-intl)` doesn't match — match the package
  // name anywhere along the path instead.
  transformIgnorePatterns: [
    '/node_modules/(?!(?:.*[/@])?(react-intl|@formatjs|intl-messageformat|intl-messageformat-parser)([/.@]|$))',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Resolve `@cocoaimpact/shared` workspace import — the package
  // ships compiled `dist/`; point Jest there so it doesn't try to
  // type-resolve the source `.ts` files.
  moduleDirectories: ['node_modules', '<rootDir>/../../node_modules'],
};
