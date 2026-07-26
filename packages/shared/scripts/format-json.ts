#!/usr/bin/env bun
/**
 * Reformat a JSON file in-place with 2-space indent.
 *
 * Used by the *:snapshot scripts so committed schemas stay diff-friendly
 * without pulling in a python or external `jq` dependency.
 *
 * Usage: bun run scripts/format-json.ts <file>
 */

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: bun run scripts/format-json.ts <file>');
  process.exit(1);
}

const parsed = await Bun.file(file).json();
await Bun.write(file, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(`Formatted ${file}`);
