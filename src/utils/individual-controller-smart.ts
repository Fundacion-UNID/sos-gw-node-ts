import { IndividualCredentialTypes } from 'gdc-common-utils-ts/constants/verifiable-credentials';
import { getVpCredentials } from 'gdc-common-utils-ts/utils/vp-token';

export type IndividualControllerCredentialSummary = Readonly<{
  actorDid: string;
  subjectDid: string;
  relationship: string;
  issuerDid: string;
}>;

/**
 * Reads one exact controller authority from an already verified VP.
 *
 * Proof verification remains the Clearing House responsibility. This matcher
 * only prevents a controller credential issued for another actor, animal,
 * relationship, or provider from becoming subject-wide authority.
 */
export function getMatchingIndividualControllerCredentialFromVpToken(
  vpToken: string,
  criteria: Readonly<{
    actorDid: string;
    subjectDid: string;
    relationship?: string;
    issuerDid: string;
  }>,
): IndividualControllerCredentialSummary | undefined {
  return getVpCredentials(vpToken)
    .map(summarizeIndividualControllerCredential)
    .find((summary): summary is IndividualControllerCredentialSummary => {
      if (!summary) return false;
      return summary.actorDid === String(criteria.actorDid || '').trim()
        && summary.subjectDid === String(criteria.subjectDid || '').trim()
        && summary.issuerDid === String(criteria.issuerDid || '').trim()
        && (!criteria.relationship
          || summary.relationship.toLowerCase() === String(criteria.relationship).trim().toLowerCase());
    });
}

function summarizeIndividualControllerCredential(
  credential: unknown,
): IndividualControllerCredentialSummary | undefined {
  const source = credential as Record<string, any> | undefined;
  const types = Array.isArray(source?.type)
    ? source.type.map(String)
    : [String(source?.type || '')];
  if (!types.includes(IndividualCredentialTypes.IndividualControllerCredential)) return undefined;
  const subject = source?.credentialSubject || {};
  const actorDid = String(subject.id || '').trim();
  const subjectDid = String(subject.subject || '').trim();
  const relationship = String(subject.relationship || '').trim();
  const issuerDid = String(source?.issuer?.id || source?.issuer || '').trim();
  if (!actorDid || !subjectDid || !relationship || !issuerDid) return undefined;
  return { actorDid, subjectDid, relationship, issuerDid };
}
