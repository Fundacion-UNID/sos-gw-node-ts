import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const srcPath = path.resolve(ROOT, 'src/__tests__/data/example-payloads.ts');
const outPath = path.resolve(ROOT, 'docs/openapi-examples/core-flow-examples.json');

const mod = await import(pathToFileURL(srcPath).href);

const payload = {
  ORGANIZATION_REGISTRATION_REQUEST: mod.ORGANIZATION_REGISTRATION_REQUEST,
  ORGANIZATION_ACTIVATION_REQUEST: mod.ORGANIZATION_ACTIVATION_REQUEST,
  ORGANIZATION_ORDER_REQUEST: mod.ORGANIZATION_ORDER_REQUEST,
  CONSENT_CREATION_MESSAGE: mod.CONSENT_CREATION_MESSAGE,
  COMMUNICATION_CREATION_MESSAGE: mod.COMMUNICATION_CREATION_MESSAGE,
  COMPOSITION_UPDATE_MESSAGE: mod.COMPOSITION_UPDATE_MESSAGE,
  SMART_TOKEN_REQUEST: mod.SMART_TOKEN_REQUEST,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`✅ Generated ${outPath}`);
