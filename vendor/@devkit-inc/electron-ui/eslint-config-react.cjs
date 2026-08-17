module.exports = {
  extends: [
    require.resolve('./eslint-config-base.cjs'),
    'plugin:react-hooks/recommended',
  ],
  env: { browser: true },
};
