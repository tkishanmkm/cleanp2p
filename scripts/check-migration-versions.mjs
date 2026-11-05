import { readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const directory = resolve(process.argv[2] ?? 'supabase/migrations');
let files;
try {
  files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
} catch (error) {
  console.error(`MIGRATION_PREFLIGHT_ERROR: cannot read ${directory}: ${error.message}`);
  process.exit(2);
}

const versions = new Map();
const issues = [];
for (const file of files) {
  const match = basename(file).match(/^(\d{14})_(.+)\.sql$/);
  if (!match) {
    issues.push(`INVALID_FILENAME: ${file} — expected a 14-digit version prefix and descriptive name.`);
    continue;
  }
  const [, version] = match;
  if (versions.has(version)) {
    issues.push(`DUPLICATE_VERSION: ${version} — '${versions.get(version)}' and '${file}'.`);
  } else {
    versions.set(version, file);
  }
}

console.log(`Migration files scanned: ${files.length}`);
console.log(`Unique valid version prefixes: ${versions.size}`);
if (issues.length) {
  console.error(`PREFLIGHT BLOCKED: ${issues.length} migration naming/version issue(s). Do not deploy this migration directory.`);
  for (const issue of issues) console.error(` - ${issue}`);
  process.exitCode = 1;
} else {
  console.log('PREFLIGHT PASSED: migration version prefixes are valid and unique.');
}
