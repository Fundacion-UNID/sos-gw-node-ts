// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
}

function hasProperty(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some((property) => propertyName(property.name) === name);
}

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(resolved);
    return /\.ts$/.test(entry.name) ? [resolved] : [];
  });
}

function isDirectBundleArrayEntry(object: ts.ObjectLiteralExpression): boolean {
  let current: ts.Node = object;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    if (ts.isArrayLiteralExpression(current.parent)) {
      const arrayProperty = current.parent.parent;
      return ts.isPropertyAssignment(arrayProperty)
        && ['data', 'entry'].includes(propertyName(arrayProperty.name) || '');
    }
    if (ts.isObjectLiteralExpression(current.parent)) return false;
    current = current.parent;
  }
  return false;
}

function isBundleEntryWriter(object: ts.ObjectLiteralExpression): boolean {
  return isDirectBundleArrayEntry(object)
    || hasProperty(object, 'request')
    || hasProperty(object, 'response')
    || (hasProperty(object, 'type') && hasProperty(object, 'resource'));
}

describe('canonical Bundle entry writer boundary', () => {
  it('rejects every VET writer, fixture, example, and journey that authors entry.meta.claims', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(path.resolve('src'))) {
      const isTestFile = file.includes(`${path.sep}__tests__${path.sep}`);
      const isCanonicalJourneySurface = [
        `${path.sep}__tests__${path.sep}data${path.sep}`,
        `${path.sep}__tests__${path.sep}integration${path.sep}`,
        `${path.sep}__tests__${path.sep}e2e${path.sep}`,
      ].some((segment) => file.includes(segment));
      if (isTestFile && !isCanonicalJourneySurface) continue;
      const sourceText = fs.readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node) && isBundleEntryWriter(node)) {
          const legacyMeta = node.properties.find((property) => ts.isPropertyAssignment(property)
            && propertyName(property.name) === 'meta'
            && (!ts.isObjectLiteralExpression(property.initializer)
              || hasProperty(property.initializer, 'claims')));
          if (legacyMeta) {
            const location = source.getLineAndCharacterOfPosition(legacyMeta.getStart(source));
            violations.push(`${path.relative(process.cwd(), file)}:${location.line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});
