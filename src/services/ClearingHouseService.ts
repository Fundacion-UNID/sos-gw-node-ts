import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { createHash } from 'crypto';

export type ClearingHouseVerificationRequest = {
  vpToken: string;
  presentationSubmission?: any;
  acrValues: string[];
};

export type ClearingHouseVerificationResult = {
  acr: string;
  amr?: string[];
  vpHash?: string;
  ledgerVerified: boolean;
};

export interface IClearingHouseService {
  verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult>;
}

export class ClearingHouseService implements IClearingHouseService {
  async verifyVpToken(request: ClearingHouseVerificationRequest): Promise<ClearingHouseVerificationResult> {
    const mode = (process.env.CLEARING_HOUSE_MODE || 'stub').toLowerCase();
    if (mode === 'remote') {
      const baseUrl = String(process.env.CLEARING_HOUSE_URL || '').trim();
      if (!baseUrl) {
        throw new Error('CLEARING_HOUSE_URL is required when CLEARING_HOUSE_MODE=remote');
      }
      const response = await fetch(baseUrl, {
        method: HttpRequestMethods.Post,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vp_token: request.vpToken,
          presentation_submission: request.presentationSubmission,
          acr_values: request.acrValues,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Clearing House verification failed: ${response.status} ${text}`.trim());
      }
      const payload = await response.json().catch(() => undefined);
      const acr = payload?.acr || payload?.body?.acr || request.acrValues[0];
      return {
        acr,
        amr: payload?.amr || payload?.body?.amr || ['openid4vp', 'vc'],
        vpHash: payload?.vp_hash || payload?.vpHash || payload?.body?.vp_hash,
        ledgerVerified: payload?.ledger_verified ?? payload?.ledgerVerified ?? payload?.body?.ledger_verified ?? true,
      };
    }
    if (mode !== 'stub') {
      throw new Error(`Clearing House mode not implemented: ${mode}`);
    }

    const vpHash = createHash('sha256').update(request.vpToken, 'utf8').digest('hex');
    return {
      acr: request.acrValues[0],
      amr: ['openid4vp', 'vc'],
      vpHash,
      ledgerVerified: true,
    };
  }
}
