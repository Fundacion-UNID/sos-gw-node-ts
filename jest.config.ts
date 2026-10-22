// jest.config.ts

import type { JestConfigWithTsJest } from 'ts-jest';

const isE2E = process.env.TEST_ENV === 'e2e';
const includeArtifacts = process.env.TEST_ARTIFACTS === '1';
const collectCoverage = process.env.COVERAGE === '1';

const esmNodeModules = [
  'gdc-common-utils-ts',
  'gdc-sdk-core-ts',
  'gdc-sdk-client-ts',
  'fhir-data-utils-ts',
  'tasks-core-node-ts',
  'sos-data-utils-ts',
  'sos-sdk-node-ts',
  'terminology-sdk-node-ts',
  'uhc-sdk-core-ts',
  'vet-data-utils-ts',
  'vet-sdk-core-ts',
  '@noble/ciphers',
  '@noble/hashes',
  '@noble/post-quantum',
  '@noble/post-quantum/ml-dsa',
  '@noble/post-quantum/ml-kem',
  '@noble/curves',
  '@stablelib/utf8',
  '@stablelib/base64',
  'pkijs',
  'asn1js',
  'uuid',
  '@peculiar/webcrypto',
];

const config: JestConfigWithTsJest = {
  testEnvironment: 'node',
  injectGlobals: true,   // make describe/it/expect/jest global
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // Treat TS as ESM inside Jest so imports work
  extensionsToTreatAsEsm: ['.ts'],

  roots: ['<rootDir>/src'],
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/src/__tests__/old/',
    'snomed-ips.test.ts',
    ...(includeArtifacts ? [] : ['/src/__tests__/artifacts/']),
    ...(isE2E ? [] : ['/src/__tests__/e2e/']),
    // Firestore integration tests require external services/credentials.
    '/src/__tests__/integration/repositories/firestore',
  ], // Exclude old tests and e2e by default

  // Important: we will transform .ts via ts-jest, and specific node_modules .js via babel-jest
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.jest.json',
      },
    ],
    '^.+\\.(mjs|js)$': 'babel-jest',
  },

  
  // By default, Jest ignores node_modules. This robust pattern uses a negative
  // lookahead to tell Jest to NOT ignore the specified ESM modules.
  transformIgnorePatterns: [
    `[/\\\\]node_modules[/\\\\](?!(${esmNodeModules.join('|')})([/\\\\]|$))`,
  ],

  // Allow TS ESM source files to import with .js specifiers (NodeNext style).
  // Jest/ts-jest resolves TS sources directly, so we strip the .js extension for relative imports.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^gdc-common-utils-ts$': '<rootDir>/node_modules/gdc-common-utils-ts/dist/index.js',
    '^gdc-common-utils-ts/(.*)$': '<rootDir>/node_modules/gdc-common-utils-ts/dist/$1.js',
    '^gdc-sdk-client-ts$': '<rootDir>/node_modules/gdc-sdk-client-ts/dist/index.js',
    '^gdc-sdk-client-ts/(.*)$': '<rootDir>/node_modules/gdc-sdk-client-ts/dist/$1.js',
    '^sos-data-utils-ts$': '<rootDir>/node_modules/sos-data-utils-ts/dist/index.js',
    '^sos-data-utils-ts/(.*)$': '<rootDir>/node_modules/sos-data-utils-ts/dist/$1.js',
    '^sos-sdk-node-ts$': '<rootDir>/node_modules/sos-sdk-node-ts/dist/index.js',
    '^sos-sdk-node-ts/(.*)$': '<rootDir>/node_modules/sos-sdk-node-ts/dist/$1.js',
    '^vet-sdk-core-ts$': '<rootDir>/node_modules/vet-sdk-core-ts/dist/index.js',
    '^vet-sdk-core-ts/(.*)$': '<rootDir>/node_modules/vet-sdk-core-ts/dist/$1.js',
    '^@noble/post-quantum/ml-dsa$': '@noble/post-quantum/ml-dsa.js',
    '^@noble/post-quantum/ml-kem$': '@noble/post-quantum/ml-kem.js',
  },
 

  clearMocks: true,
  watchman: false,
  testTimeout: 12000,
  verbose: true,

  // Coverage configuration
  collectCoverage,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!**/node_modules/**',
    '!**/vendor/**',
    '!**/src/__tests__/**',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '\\.data\\.ts$',
  ],
};

export default config;
