import { defineConfig } from 'vitest/config';

/**
 * The unit suite runs with the authoring flag OFF, deliberately.
 *
 * It is the configuration a learner gets, so every test here is a statement
 * about the learner build: the pure authoring geometry is testable regardless
 * (it is arithmetic and touches nothing), and the side-effecting entry points
 * are asserted to THROW, which is the test that fails the moment a guard is
 * deleted. See `tests/unit/authoringGate.test.ts`.
 */
export default defineConfig({
  define: { __AUTHORING__: 'false' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
