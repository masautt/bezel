module.exports = {
  root: true,
  extends: [require.resolve('@devkit-inc/electron-ui/eslint')],
  overrides: [
    {
      files: ['client/src/**/*.{ts,tsx}'],
      extends: [require.resolve('@devkit-inc/electron-ui/eslint-react')],
    },
    {
      // tsc does not rewrite path-mapped specifiers (like `@shared/*`) when it
      // emits electron/'s output — a runtime import through the alias resolves
      // to a nonexistent "@shared" package in Node. `import type` is fine (it
      // gets erased entirely), so only value imports are banned here.
      files: ['electron/**/*.ts'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@shared/*'],
                message:
                  "tsc does not rewrite path-mapped specifiers on emit — use a relative '../src/*.js' import for runtime values in electron/.",
                allowTypeImports: true,
              },
            ],
          },
        ],
      },
    },
  ],
};
