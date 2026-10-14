// src/blockchain/fabric/v3/connection.ts

import env from 'env-var';

export const EnvConnectionOldPrefix = 'HLF_CONNECTION_PROFILE'; // deprecate
export const EnvConnectionPemPrefix = 'HLF_CONNECTION_PEM';
export const EnvPublicPemPrefix = 'HLF_CERTIFICATE';
export const EnvPrivatePemPrefix = 'HLF_PRIVATE_KEY';
export const EnvPeerPrefix = 'HLF_CONNECTION_PEER';

function getProcessOwnedOrMspValue(baseName: string, mspId: string): {
  envVariableName: string;
  value?: string;
} {
  const processOwnedValue = env.get(baseName).asString();
  if (processOwnedValue) {
    return { envVariableName: baseName, value: processOwnedValue };
  }

  const compatibilityName = `${baseName}_${mspId}`;
  return {
    envVariableName: compatibilityName,
    value: env.get(compatibilityName).asString(),
  };
}

export function getConnectionTlsCertPemByMspId(mspId: string): string {
  const { envVariableName, value: resultString } = getProcessOwnedOrMspValue(
    EnvConnectionPemPrefix,
    mspId,
  );
  console.log(
    `---> getConnectionTlsCertPemByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );

  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The PEM certificate for TLS connection "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString.replace(/\\n/g, '\n');
}

export function getConnectionPeerByMspId(mspId: string): string {
  const { envVariableName, value: resultString } = getProcessOwnedOrMspValue(
    EnvPeerPrefix,
    mspId,
  );
  console.log(
    `---> getConnectionPeerByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );

  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The peer connection "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString;
}

export function getPublicCertByMspId(mspId: string): string {
  const { envVariableName, value: resultString } = getProcessOwnedOrMspValue(
    EnvPublicPemPrefix,
    mspId,
  );
  console.log(
    `---> getPublicCertByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );

  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The public PEM certificate "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString.replace(/\\n/g, '\n');
}

export function getPrivatePemKeyByMspId(mspId: string): string {
  const { envVariableName, value: resultString } = getProcessOwnedOrMspValue(
    EnvPrivatePemPrefix,
    mspId,
  );
  console.log(
    `---> getPrivatePemKeyByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );

  if (!resultString || resultString === '') {
    throw new Error(
      `!!! The private PEM key "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return resultString.replace(/\\n/g, '\n');
}

export function getConnectionProfileOldByMspId(
  mspId: string
): Record<string, unknown> {
  const envVariableName = `${EnvConnectionOldPrefix}_${mspId}`;
  console.log(
    `---> getConnectionProfileByMspId: mspId=${mspId}; envVariableName=${envVariableName}`
  );
  const connectionProfile = env.get(envVariableName).asString();

  if (!connectionProfile) {
    throw new Error(
      `!!! connection profile "${envVariableName}" was not found for the mspId "${mspId}"`
    );
  }

  return JSON.parse(connectionProfile) as Record<string, unknown>;
}
