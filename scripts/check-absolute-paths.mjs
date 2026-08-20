/** Reject machine-specific paths before a commit is shared. */
import { spawnSync } from 'node:child_process';

// Split the literals so this checker does not match its own source.
const pattern = [
  ['/', 'Users/', '[A-Za-z0-9._-]+/'].join(''),
  ['[A-Za-z]:\\\\', 'Users\\\\'].join(''),
  ['/', 'home/', '[A-Za-z0-9._-]+/'].join(''),
].join('|');

const result = spawnSync(
  'git',
  [
    'grep',
    '-nIE',
    pattern,
    '--',
    '.',
    ':(exclude)package-lock.json',
  ],
  { encoding: 'utf8' },
);

if (result.status === 0) {
  process.stderr.write(result.stdout);
  console.error('A machine-specific absolute path is committed. Remove it.');
  process.exit(1);
}

if (result.status !== 1) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

console.log('No local absolute paths found.');
