import fs from 'fs';
import path from 'path';

const BUILD_DIR = path.resolve(process.cwd(), 'build');
const EXTRA_TS_PATCH_DIRS = (process.env.EXTRA_TS_PATCH_DIRS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function collectFiles(dir, extensions, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, extensions, files);
    } else if (entry.isFile()) {
      const ext = path.extname(fullPath);
      if (extensions.includes(ext)) files.push(fullPath);
    }
  }
  return files;
}

function hasRuntimeExtension(specifier) {
  const ext = path.extname(specifier);
  return ['.js', '.mjs', '.cjs', '.json', '.node', '.ts', '.tsx'].includes(ext);
}

function resolveExtension(specifier, sourceFile) {
  if (!specifier.startsWith('.') && !specifier.startsWith('..')) return null;
  if (hasRuntimeExtension(specifier)) return null;

  const sourceExt = path.extname(sourceFile);
  const prefersTs = sourceExt === '.ts' || sourceExt === '.tsx';
  const basePath = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = [
    ...(prefersTs
      ? [`${basePath}.ts`, `${basePath}.tsx`, path.join(basePath, 'index.ts'), path.join(basePath, 'index.tsx')]
      : [`${basePath}.js`, `${basePath}.mjs`, path.join(basePath, 'index.js'), path.join(basePath, 'index.mjs')]),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const rel = path.relative(path.dirname(sourceFile), candidate).replace(/\\/g, '/');
      return rel.startsWith('.') ? rel : `./${rel}`;
    }
  }
  return null;
}

function resolvePackageExtension(specifier) {
  if (hasRuntimeExtension(specifier)) return null;

  const isLocalPackage =
    specifier.startsWith('gdc-common-utils-ts/') ||
    specifier.startsWith('gdc-sdk-client-ts/');

  if (!isLocalPackage) return null;

  const candidate = path.resolve(process.cwd(), 'node_modules', `${specifier}.ts`);
  if (fs.existsSync(candidate)) {
    return `${specifier}.ts`;
  }
  return null;
}

function rewriteImports(source, sourceFile) {
  let updated = source;

  updated = updated.replace(
    /\bfrom\s+(['"])([^'"]+)\1/g,
    (match, quote, spec) => {
      const resolved = resolveExtension(spec, sourceFile) ?? resolvePackageExtension(spec);
      if (!resolved) return match;
      return `from ${quote}${resolved}${quote}`;
    },
  );

  updated = updated.replace(
    /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g,
    (match, quote, spec) => {
      const resolved = resolveExtension(spec, sourceFile) ?? resolvePackageExtension(spec);
      if (!resolved) return match;
      return `import(${quote}${resolved}${quote})`;
    },
  );

  return updated;
}

if (!fs.existsSync(BUILD_DIR)) {
  console.error(`[patch-esm-imports] Build directory not found: ${BUILD_DIR}`);
  process.exit(1);
}

const files = collectFiles(BUILD_DIR, ['.js']);
for (const extraDir of EXTRA_TS_PATCH_DIRS) {
  if (fs.existsSync(extraDir)) {
    collectFiles(extraDir, ['.ts', '.tsx'], files);
  }
}
let changedCount = 0;

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const updated = rewriteImports(original, file);
  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');
    changedCount += 1;
  }
}

console.log(`[patch-esm-imports] Updated ${changedCount} file(s).`);
