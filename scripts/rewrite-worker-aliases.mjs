import fs from 'node:fs';
import path from 'node:path';

const distRoot = path.resolve(process.cwd(), 'dist');

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }
    if (!entry.isFile() || !filePath.endsWith('.js')) continue;

    const original = fs.readFileSync(filePath, 'utf8');
    const rewritten = original.replace(/require\((['"])@\/([^'"]+)\1\)/g, (_match, quote, aliasPath) => {
      const target = path.resolve(distRoot, aliasPath);
      let relative = path.relative(path.dirname(filePath), target).split(path.sep).join('/');
      if (!relative.startsWith('.')) relative = './' + relative;
      return 'require(' + quote + relative + quote + ')';
    });

    if (rewritten !== original) fs.writeFileSync(filePath, rewritten, 'utf8');
  }
}

if (!fs.existsSync(path.join(distRoot, 'worker.js'))) {
  throw new Error('Worker compilation did not produce dist/worker.js');
}
walk(distRoot);
console.log('[Worker Build] Compiled output and rewrote @/ aliases to relative paths.');
