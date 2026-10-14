// src/database/storage/ipfs.storage.adapter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';

import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { appendStorageTrace, isStorageTraceEnabled } from '../../utils/storage-trace';
import { DownloadResult, IStorageAdapter, UploadResult } from './IStorageAdapter';

const SHA3_384_MULTIHASH_PREFIX = new Uint8Array([0x15, 0x30]);
const DEFAULT_MFS_ROOT = '/gwtemplate/blobs';

export interface IpfsStorageAdapterOptions {
  apiUrl: string;
  gatewayUrl: string;
  mfsRoot?: string;
  fetchImpl?: typeof fetch;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '');
}

function nowMs(): number {
  return Date.now();
}

export function computeEncodedMultiHash(dataBytes: Uint8Array): string {
  const digest = sha3_384(dataBytes);
  const multihashBytes = new Uint8Array(SHA3_384_MULTIHASH_PREFIX.length + digest.length);
  multihashBytes.set(SHA3_384_MULTIHASH_PREFIX);
  multihashBytes.set(digest, SHA3_384_MULTIHASH_PREFIX.length);
  return encodeMultibase58btc(multihashBytes);
}

function buildMfsPath(mfsRoot: string, encodedMultiHash: string): string {
  const normalizedRoot = `/${trimLeadingSlash(trimTrailingSlash(mfsRoot))}`;
  return `${normalizedRoot}/${encodedMultiHash}`;
}

function buildGatewayUrl(gatewayUrl: string, contentCid: string): string {
  return `${trimTrailingSlash(gatewayUrl)}/ipfs/${contentCid}`;
}

function buildKuboWriteFormData(dataBytes: Uint8Array, contentType: string, filename: string): FormData {
  const formData = new FormData();
  const blob = new Blob([Buffer.from(dataBytes)], { type: contentType || 'application/octet-stream' });
  formData.append('data', blob, filename);
  return formData;
}

async function readKuboErrorMessage(response: Response): Promise<string> {
  let diagnostics = `${response.status} ${response.statusText}`.trim();
  try {
    const bodyText = await response.text();
    if (bodyText) diagnostics = `${diagnostics}: ${bodyText}`;
  } catch {
    // Ignore body parsing failures; status text is enough.
  }
  return diagnostics;
}

/**
 * Stores confidential blobs in a Kubo (IPFS) node using MFS paths keyed by the
 * canonical encodedMultiHash identifier already used by the other adapters.
 */
export class IpfsStorageAdapter implements IStorageAdapter {
  private readonly apiUrl: string;
  private readonly gatewayUrl: string;
  private readonly mfsRoot: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IpfsStorageAdapterOptions) {
    if (!options?.apiUrl) {
      throw new Error('IPFS API URL must be provided.');
    }
    if (!options?.gatewayUrl) {
      throw new Error('IPFS gateway URL must be provided.');
    }
    this.apiUrl = trimTrailingSlash(options.apiUrl);
    this.gatewayUrl = trimTrailingSlash(options.gatewayUrl);
    this.mfsRoot = options.mfsRoot || DEFAULT_MFS_ROOT;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private trace(operation: string, details: Record<string, unknown>): void {
    if (!isStorageTraceEnabled()) return;
    const normalized = Object.entries(details)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    console.log(`[StorageTrace][IPFS] op=${operation} ${normalized}`);
    appendStorageTrace('ipfs', operation, details);
  }

  private buildApiUrl(path: string, params: Record<string, string>): string {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private async statMfsPath(mfsPath: string): Promise<{ Hash: string; Size?: number }> {
    const response = await this.fetchImpl(this.buildApiUrl('/api/v0/files/stat', { arg: mfsPath }), {
      method: HttpRequestMethods.Post,
    });
    if (!response.ok) {
      throw new Error(`IPFS stat failed: ${await readKuboErrorMessage(response)}`);
    }
    return response.json() as Promise<{ Hash: string; Size?: number }>;
  }

  async upload(dataBytes: Uint8Array, contentType: string): Promise<UploadResult> {
    const startedAt = nowMs();
    const encodedMultiHash = computeEncodedMultiHash(dataBytes);
    const mfsPath = buildMfsPath(this.mfsRoot, encodedMultiHash);

    try {
      const writeResponse = await this.fetchImpl(
        this.buildApiUrl('/api/v0/files/write', {
          arg: mfsPath,
          create: 'true',
          parents: 'true',
          truncate: 'true',
        }),
        {
          method: HttpRequestMethods.Post,
          body: buildKuboWriteFormData(dataBytes, contentType, encodedMultiHash),
        },
      );
      if (!writeResponse.ok) {
        throw new Error(await readKuboErrorMessage(writeResponse));
      }

      const stat = await this.statMfsPath(mfsPath);
      const publicUrl = buildGatewayUrl(this.gatewayUrl, stat.Hash);

      this.trace('upload', {
        mfsPath,
        blobRef: encodedMultiHash,
        contentCid: stat.Hash,
        bytes: dataBytes.byteLength,
        contentType,
        durationMs: nowMs() - startedAt,
      });

      return {
        publicUrl,
        encodedMultiHash,
      };
    } catch (error) {
      console.error(`[IpfsStorageAdapter] Failed to upload blob '${encodedMultiHash}'.`, error);
      throw new Error(`IPFS upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async download(encodedMultiHash: string): Promise<DownloadResult> {
    const startedAt = nowMs();
    const mfsPath = buildMfsPath(this.mfsRoot, encodedMultiHash);

    try {
      const readResponse = await this.fetchImpl(
        this.buildApiUrl('/api/v0/files/read', { arg: mfsPath }),
        { method: HttpRequestMethods.Post },
      );
      if (!readResponse.ok) {
        throw new Error(await readKuboErrorMessage(readResponse));
      }

      const dataBytes = new Uint8Array(await readResponse.arrayBuffer());
      const stat = await this.statMfsPath(mfsPath);

      this.trace('download', {
        mfsPath,
        blobRef: encodedMultiHash,
        contentCid: stat.Hash,
        bytes: dataBytes.byteLength,
        durationMs: nowMs() - startedAt,
      });

      return {
        dataBytes,
        contentType: 'application/octet-stream',
      };
    } catch (error) {
      console.error(`[IpfsStorageAdapter] Failed to download '${encodedMultiHash}'.`, error);
      throw new Error(`IPFS download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async delete(encodedMultiHash: string): Promise<void> {
    const startedAt = nowMs();
    const mfsPath = buildMfsPath(this.mfsRoot, encodedMultiHash);

    try {
      const response = await this.fetchImpl(
        this.buildApiUrl('/api/v0/files/rm', {
          arg: mfsPath,
          force: 'true',
        }),
        { method: HttpRequestMethods.Post },
      );
      if (!response.ok) {
        throw new Error(await readKuboErrorMessage(response));
      }

      this.trace('delete', {
        mfsPath,
        blobRef: encodedMultiHash,
        durationMs: nowMs() - startedAt,
      });
    } catch (error) {
      console.error(`[IpfsStorageAdapter] Failed to delete '${encodedMultiHash}'.`, error);
      throw new Error(`IPFS delete failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
