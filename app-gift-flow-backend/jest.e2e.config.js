module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\.e2e-spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { diagnostics: false }] },
  testEnvironment: 'node',
  testTimeout: 30000,
};
