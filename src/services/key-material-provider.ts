export type KeyMaterialPurpose = 'all' | 'hmac' | 'storage' | 'comm_sig' | 'vc_sign' | 'encryption';

export type KeyMaterialRecord<T> = {
  entityVaultId: string;
  purpose: KeyMaterialPurpose;
  keyVersion: string;
  loadedAt: number;
  keyMaterial: T;
};

export interface KeyMaterialProvider<T> {
  get(
    entityVaultId: string,
    purpose: KeyMaterialPurpose,
    options?: { minVersion?: string },
  ): Promise<KeyMaterialRecord<T>>;

  invalidate(entityVaultId?: string, purpose?: KeyMaterialPurpose): void;
}
