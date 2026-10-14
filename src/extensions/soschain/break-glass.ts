// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.
/**
 * SOSChain compatibility surface for the shared emergency authorization core.
 *
 * Human and veterinary profiles use the same audited implementation. This
 * module intentionally contains no second policy, persistence path or ledger
 * writer; it only preserves the established SOSChain import names.
 */
export {
  BreakGlassService as SoschainBreakGlassService,
  evaluateBreakGlassPolicy as evaluateSoschainBreakGlassPolicy,
} from '../../security/break-glass';

export type {
  BreakGlassAuthorization as SoschainBreakGlassAuthorization,
  BreakGlassAuthorizationInput as SoschainBreakGlassAuthorizationInput,
  BreakGlassAuthorizer as SoschainBreakGlassAuthorizer,
  BreakGlassControllerNotifier as SoschainBreakGlassControllerNotifier,
  BreakGlassPolicyDecision as SoschainBreakGlassPolicyDecision,
  BreakGlassPolicyInput as SoschainBreakGlassPolicyInput,
  BreakGlassReasonCode as SoschainBreakGlassReasonCode,
  BreakGlassRequest as SoschainBreakGlassRequest,
  BreakGlassSubjectKind as SoschainBreakGlassSubjectKind,
} from '../../security/break-glass';
