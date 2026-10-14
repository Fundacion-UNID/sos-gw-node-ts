import type { LLMProvider } from '../llm/LLMProvider.js';
import { toLedgerSafeMetaTags } from './metaTagSanitizer.js';

export type EntryWithMetaAndTags = {
  type: string;
  meta: {
    claims: Record<string, any>;
  };
  resource?: Record<string, any>;
};

export type DerivationResult = {
  anonymizedText: string;
  /**
   * JSON:API Primary Document entries (canonical internal form).
   * When representing this as FHIR Bundle, these become `Bundle.entry[]`.
   */
  data: EntryWithMetaAndTags[];
  meta?: {
    tag?: any[];
  };
};

export type UserInputDerivationParams = {
  model: string;
  inputText: string;
  policyPrompt?: string;
  ledgerSafe?: boolean;
};

export class UserInputDerivationService {
  constructor(private readonly llm: LLMProvider) {}

  async derive(params: UserInputDerivationParams): Promise<DerivationResult> {
    const prompt =
      `${params.policyPrompt ? `${params.policyPrompt.trim()}\n\n` : ''}` +
      `Task: Anonymize the user text and derive a JSON:API Primary Document with data entries.\n` +
      `Return ONLY valid JSON with this shape:\n` +
      `{\n` +
      `  "anonymizedText": string,\n` +
      `  "meta": { "tag": [{ "id": string, "system"?: string, "code"?: string, "version"?: string, "display"?: string, "userSelected"?: boolean }] },\n` +
      `  "data": [{ "type": string, "meta": { "claims": object }, "resource"?: object }]\n` +
      `}\n\n` +
      `Rules:\n` +
      `- "meta.tag[].id" MUST be unique and SHOULD use an index per resource type, e.g. "Observation[0].code", "MedicationStatement[0].medication".\n\n` +
      `User text:\n` +
      `${params.inputText}`;

    const raw = await this.llm.generateJson<DerivationResult>({
      model: params.model,
      prompt,
      temperature: 0.1,
      timeoutMs: 60_000,
    });

    const anonymizedText = typeof raw?.anonymizedText === 'string' ? raw.anonymizedText : '';
    const data = Array.isArray((raw as any)?.data)
      ? (raw as any).data
      : Array.isArray((raw as any)?.entry)
        ? (raw as any).entry
        : Array.isArray((raw as any)?.observations)
          ? (raw as any).observations
          : [];
    const meta = raw?.meta && typeof raw.meta === 'object' ? raw.meta : undefined;

    if (!params.ledgerSafe) {
      return { anonymizedText, data, meta };
    }

    const tag = toLedgerSafeMetaTags((meta as any)?.tag);
    const ledgerSafeMeta = meta ? { ...(meta as any), tag } : { tag };

    return { anonymizedText, data, meta: ledgerSafeMeta };
  }
}
