// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import {
  buildStableActorIdentifier,
  stableActorIdentifierFromDidWeb,
  StableActorContactKinds,
} from 'gdc-common-utils-ts/utils/actor-identifier';

type VerifiedBearerPayload = Readonly<Record<string, unknown>>;

function firebaseIdentityValues(
  payload: VerifiedBearerPayload | undefined,
  kind: 'email' | 'phone',
): string[] {
  const firebase = payload?.firebase;
  if (!firebase || typeof firebase !== 'object' || Array.isArray(firebase)) return [];
  // A normal Firebase sign-in must use the explicit verified top-level claims.
  // The nested identity fallback exists only for server-issued custom-token
  // exchanges whose issuer has already verified and bound those contacts.
  if ((firebase as Record<string, unknown>).sign_in_provider !== 'custom') return [];
  const identities = (firebase as Record<string, unknown>).identities;
  if (!identities || typeof identities !== 'object' || Array.isArray(identities)) return [];
  const values = (identities as Record<string, unknown>)[kind];
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function verifiedBearerContacts(
  payload: VerifiedBearerPayload | undefined,
): ReadonlyArray<Readonly<{ kind: 'email' | 'phone'; value: string }>> {
  const contacts: Array<Readonly<{ kind: 'email' | 'phone'; value: string }>> = [];
  const topLevelEmail = String(payload?.email || '').trim();
  if (topLevelEmail && payload?.email_verified === true) {
    contacts.push({ kind: 'email', value: topLevelEmail });
  }
  const topLevelPhone = String(payload?.phone_number || '').trim();
  if (topLevelPhone && payload?.phone_number_verified !== false) {
    contacts.push({ kind: 'phone', value: topLevelPhone });
  }

  // A trusted server-issued Firebase custom token can retain its verified
  // linked contacts here without repeating them as top-level JWT claims.
  for (const value of firebaseIdentityValues(payload, 'email')) contacts.push({ kind: 'email', value });
  for (const value of firebaseIdentityValues(payload, 'phone')) contacts.push({ kind: 'phone', value });
  return contacts;
}

function stableIdentifierForContact(contact: Readonly<{ kind: 'email' | 'phone'; value: string }>): string {
  return buildStableActorIdentifier({
    contactKind: contact.kind === 'email' ? StableActorContactKinds.Email : StableActorContactKinds.Phone,
    contact: contact.value,
  });
}

/**
 * Verifies that one trusted OIDC bearer represents the actor that signed a
 * DCR-bound request. OIDC account subjects are provider-local identifiers and
 * therefore are not required to equal a DID. A canonical professional DID may
 * instead be bound to the bearer's verified contact stable identifier.
 */
export function isVerifiedBearerBoundToActorDid(
  payload: Readonly<Record<string, unknown>> | undefined,
  actorDid: string,
): boolean {
  const exactSubject = String(payload?.sub || '').trim();
  if (exactSubject && exactSubject === actorDid) return true;

  let expectedIdentifier: string;
  try {
    expectedIdentifier = stableActorIdentifierFromDidWeb(actorDid);
  } catch {
    return false;
  }

  return verifiedBearerContacts(payload)
    .some((contact) => stableIdentifierForContact(contact) === expectedIdentifier);
}

/**
 * Returns the operational actor DID authenticated for one queued request.
 * Verified SMART `sub` is authoritative; signed DIDComm `iss` is the fallback.
 * Plain request claims are never read as authentication evidence here.
 */
export function getAuthenticatedJobActorDid(job: JobRequest): string | undefined {
  const bearerSubject = String((job.content as any)?.meta?.bearer?.jwt?.payload?.sub || '').trim();
  if (bearerSubject.startsWith('did:web:')) return bearerSubject;
  const signedIssuer = String(job.content?.iss || '').trim();
  return signedIssuer.startsWith('did:web:') ? signedIssuer : undefined;
}

/**
 * Returns privacy-preserving identifiers proven by the authenticated request.
 * A linked account token can carry both its verified email and phone, allowing
 * a later login channel to match data authored through the other channel.
 */
export function getAuthenticatedJobActorIdentifiers(job: JobRequest): string[] {
  const payload = (job.content as any)?.meta?.bearer?.jwt?.payload as Record<string, any> | undefined;
  const identifiers = new Set<string>();
  const actorDid = getAuthenticatedJobActorDid(job);
  if (actorDid) identifiers.add(actorDid);

  for (const contact of verifiedBearerContacts(payload)) {
    identifiers.add(stableIdentifierForContact(contact));
  }
  return Array.from(identifiers);
}
