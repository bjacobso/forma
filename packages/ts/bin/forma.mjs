#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { migrateSource } from '../dist/Migrate.mjs';
const [command, ...args] = process.argv.slice(2);
const usage = 'Usage: forma migrate [--write | --check] FILE...\nWithout flags, prints the migrated source. Edits preserve comments and use syntax node identities.';
if (args.includes('--help') || command === '--help') {
  console.log(usage);
} else {
  try {
    if (command !== 'migrate') throw new Error(usage);
    const flags = args.filter(arg => arg.startsWith('--'));
    for (const flag of flags) if (!['--write', '--check'].includes(flag)) throw new Error(`Unknown option ${flag}\n${usage}`);
    if (flags.includes('--write') && flags.includes('--check')) throw new Error('--write and --check are mutually exclusive');
    const files = [...new Set(args.filter(arg => !arg.startsWith('--')))];
    if (!files.length) throw new Error(usage);
    // Prepare every edit before writing, so malformed inputs cannot leave a partial migration.
    const results = files.map(file => ({ file, result: migrateSource(readFileSync(file, 'utf8')) }));
    for (const { file, result } of results) {
      if (flags.includes('--write')) {
        if (result.changed) writeFileSync(file, result.source);
      } else if (flags.includes('--check')) {
        if (result.changed) { console.error(`${file}: requires migration`); process.exitCode = 1; }
      } else process.stdout.write(result.source);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
