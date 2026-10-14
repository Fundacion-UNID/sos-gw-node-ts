
import * as mlKem from '@noble/post-quantum/ml-kem';
import { testMockRandom64Bytes } from '../../data/crypto.data';

// Tell Jest to bypass the global mock in jest.config.ts for this test file.
// We want to test the REAL library primitives here.
jest.unmock('@noble/post-quantum/ml-kem');

describe('ML-KEM (Kyber-768) Primitives', () => {
  it('should correctly encapsulate and decapsulate a shared secret', async () => {
    // --- 1. Arrange ---
    
    // Generate a key pair for the recipient.
    // Using a deterministic seed ensures the test is reproducible.
    const seed = testMockRandom64Bytes;
    const { publicKey: publicKeyBytes, secretKey: secretKeyBytes } = mlKem.ml_kem768.keygen(seed);

    // --- 2. Act (Sender side) ---
    
    // The sender encapsulates a shared secret using the recipient's public key.
    const { cipherText: encryptedBytes, sharedSecret: senderSharedSecret } = await mlKem.ml_kem768.encapsulate(publicKeyBytes);

    // --- 3. Act (Recipient side) ---

    // The recipient uses their secret key to decapsulate the ciphertext
    // and derive the same shared secret.
    const recipientSharedSecret = await mlKem.ml_kem768.decapsulate(encryptedBytes, secretKeyBytes);

    // --- 4. Assert ---
    
    // The shared secret derived by both parties must be identical.
    expect(senderSharedSecret).toEqual(recipientSharedSecret);
    expect(senderSharedSecret).toBeInstanceOf(Uint8Array);
    expect(senderSharedSecret.length).toBe(32); // ML-KEM-768 produces a 32-byte shared secret.
  });

  it('should produce a different secret when decapsulating with the wrong key', async () => {
    // --- 1. Arrange ---
    
    // Generate the intended recipient's key pair.
    const recipientSeed = testMockRandom64Bytes;
    const { publicKey: recipientPublicKey } = mlKem.ml_kem768.keygen(recipientSeed);

    // Generate a different, attacker's key pair.
    const attackerSeed = new Uint8Array(64).fill(1);
    const { secretKey: attackerSecretKey } = mlKem.ml_kem768.keygen(attackerSeed);

    // Encapsulate a secret for the INTENDED recipient, and capture the correct secret.
    const { cipherText: encryptedBytes, sharedSecret: correctSharedSecret } = await mlKem.ml_kem768.encapsulate(recipientPublicKey);

    // --- 2. Act ---

    // The attacker tries to decapsulate the ciphertext with their own, incorrect secret key.
    const garbageSharedSecret = await mlKem.ml_kem768.decapsulate(encryptedBytes, attackerSecretKey);

    // --- 3. Assert ---

    // The result should not be the same as the correct shared secret.
    expect(garbageSharedSecret).not.toEqual(correctSharedSecret);
  });
});
