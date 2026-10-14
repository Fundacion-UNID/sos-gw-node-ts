// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { getEnvSectionId } from './section-env';

const CLINICAL_CREATOR_BINDINGS_SECTION = 'clinical_author_identity_bindings';

/** Protected tenant section containing stable creator assignments and channel aliases. */
export function getClinicalCreatorBindingsSectionId(): string {
  return getEnvSectionId(CLINICAL_CREATOR_BINDINGS_SECTION);
}
