#!/usr/bin/env node
/**
 * Preview or explicitly apply one authoring-slots/v1 pose to one pack view.
 *
 * Preview is the default. The pack path is replaced only when `--write` is
 * present and the complete candidate has passed `validatePack`.
 */
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { prepareAuthoringIngest } from './lib/authoringIngest.ts';

interface CliOptions {
  exportPath: string;
  packPath: string;
  slotId: string;
  viewId: string;
  packVersion: string;
  write: boolean;
}

const USAGE = `Usage:
  npm run ingest:authoring -- \\
    --export <authoring-slots.json> \\
    --pack <pack.json> \\
    --slot <slot-id> \\
    --view <view-id> \\
    --pack-version <next-version> [--write]

Default: validate and print a preview; do not change the pack.
Write:   add --write to atomically replace the selected pack.json.`;

function parseArguments(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  let write = false;
  const names = new Set(['--export', '--pack', '--slot', '--view', '--pack-version']);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (argument === '--write') {
      if (write) throw new Error('--write was supplied more than once');
      write = true;
      continue;
    }
    if (!names.has(argument)) throw new Error(`unknown argument "${argument}"`);
    if (values.has(argument)) throw new Error(`${argument} was supplied more than once`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, value);
    index += 1;
  }

  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value.length === 0) throw new Error(`missing required ${name}`);
    return value;
  };

  return {
    exportPath: resolve(required('--export')),
    packPath: resolve(required('--pack')),
    slotId: required('--slot'),
    viewId: required('--view'),
    packVersion: required('--pack-version'),
    write,
  };
}

function readJson(path: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${label} "${path}": ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} "${path}" is not JSON: ${(error as Error).message}`);
  }
}

function atomicWrite(path: string, contents: string): void {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function main(): void {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = prepareAuthoringIngest({
      pack: readJson(options.packPath, 'pack'),
      authoringExport: readJson(options.exportPath, 'authoring export'),
      slotId: options.slotId,
      viewId: options.viewId,
      nextPackVersion: options.packVersion,
    });

    const heading = options.write ? 'WRITE' : 'PREVIEW ONLY — no file written';
    console.log(`${heading}\n${JSON.stringify(result.summary, null, 2)}`);
    if (!options.write) {
      console.log('\nRe-run the same command with --write to replace the validated pack.');
      return;
    }

    atomicWrite(options.packPath, `${JSON.stringify(result.candidate, null, 2)}\n`);
    console.log(`\nWROTE ${options.packPath}`);
  } catch (error) {
    console.error((error as Error).message);
    console.error(`\n${USAGE}`);
    process.exitCode = 1;
  }
}

main();
