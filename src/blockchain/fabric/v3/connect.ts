/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import * as grpc from '@grpc/grpc-js';
import {
  connect,
  ConnectOptions,
  Gateway,
  // GrpcClient,
  Identity,
  Signer,
  signers,
} from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import {
  getPublicCertByMspId,
  getPrivatePemKeyByMspId,
  getConnectionPeerByMspId,
  getConnectionTlsCertPemByMspId,
} from './connection';

/** It can be "as local host" or have a HOST_ALIAS variable defined in the .env file */
function newGrpcClientOptions(): grpc.ClientOptions {
  const result: grpc.ClientOptions = {};
  /*
  if (HOST_ALIAS) {
    result['grpc.ssl_target_name_override'] = HOST_ALIAS; // Only required if server TLS cert does not match the endpoint address we use
  }
  */
  return result;
}

export async function newGrpcConnection(mspId: string): Promise<grpc.Client> {
  const peerEndpoint = getConnectionPeerByMspId(mspId);

  const tlsRootCert = getConnectionTlsCertPemByMspId(mspId);
  if (tlsRootCert) {
    const tlsCredentials = grpc.credentials.createSsl(Buffer.from(tlsRootCert));
    return new grpc.Client(
      peerEndpoint,
      tlsCredentials,
      newGrpcClientOptions()
    );
  }

  return new grpc.Client(
    peerEndpoint,
    grpc.ChannelCredentials.createInsecure()
  );
}

export async function newConnectOptions(
  client: grpc.Client,
  mspId: string
): Promise<ConnectOptions> {
  const connectOptions: ConnectOptions = {
    client,
    identity: await newIdentity(mspId),
    signer: await newSigner(mspId),
    // Default timeouts for different gRPC calls
    evaluateOptions: () => {
      return { deadline: Date.now() + 5000 }; // 5 seconds
    },
    endorseOptions: () => {
      return { deadline: Date.now() + 15000 }; // 15 seconds
    },
    submitOptions: () => {
      return { deadline: Date.now() + 5000 }; // 5 seconds
    },
    commitStatusOptions: () => {
      return { deadline: Date.now() + 60000 }; // 1 minute
    },
    blockEventsOptions: () => {
      return { deadline: Date.now() + 15000 };
    },
  };
  return Promise.resolve(connectOptions);
}

export async function newGatewayConnection(
  client: grpc.Client,
  mspId: string
): Promise<Gateway> {
  return connect(await newConnectOptions(client, mspId));
}

async function newIdentity(mspId: string): Promise<Identity> {
  const publicCert = getPublicCertByMspId(mspId);
  const credentialsBuffer = Buffer.from(publicCert);
  return { mspId, credentials: credentialsBuffer };
}

async function newSigner(mspId: string): Promise<Signer> {
  //const files = await fs.readdir(keyDirectoryPath);
  // path.resolve(keyDirectoryPath, files[0]);

  const privateKeyPem = getPrivatePemKeyByMspId(mspId);
  const privateCriptoKeyObject: crypto.KeyObject =
    crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateCriptoKeyObject);
}
