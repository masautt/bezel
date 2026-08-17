module.exports = {
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  printWidth: 100,
  // Defer to the working tree's line endings instead of forcing LF — the team is on
  // Windows with git autocrlf (LF in the repo, CRLF on checkout), and a hard "lf"
  // makes prettier --check fail on every freshly-checked-out file.
  endOfLine: 'auto',
};
