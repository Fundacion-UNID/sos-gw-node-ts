/**
 * Converts an internal contextualized claim key into the external label we
 * present in gateway diagnostics and API examples.
 *
 * Example:
 * - `org.schema.Order.acceptedOffer.identifier`
 * - becomes `Order.acceptedOffer.identifier`
 *
 * This keeps manager code free of inline string literals while preserving the
 * public contract wording already used by tests, docs, and integrators.
 */
export function toExternalClaimLabel(claimKey: string): string {
  if (claimKey.startsWith('org.schema.')) {
    return claimKey.slice('org.schema.'.length);
  }
  return claimKey;
}

/**
 * Formats a missing-required-claim diagnostic using the public external claim
 * label instead of the internal contextualized storage key.
 */
export function formatMissingRequiredClaimDiagnostic(
  claimKey: string,
  options?: {
    context?: string;
    displayLabel?: string;
  },
): string {
  const context = options?.context ? ` ${options.context}` : '';
  const displayLabel = options?.displayLabel || toExternalClaimLabel(claimKey);
  return `Missing required claim${context}: '${displayLabel}'`;
}
