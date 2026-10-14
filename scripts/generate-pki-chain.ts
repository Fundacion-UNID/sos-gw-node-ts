// scripts/generate-pki-chain.ts
import 'dotenv/config';

import { generatePkiChainFromEnv } from '../src/utils/pki-chain';

generatePkiChainFromEnv({ cleanOutput: true }).catch((error) => {
  console.error('Failed to generate PKI chain:', error);
  process.exit(1);
});
