import { describe, expect, it } from 'vitest';
import { encrypt, decrypt, generateMasterKey } from '../src/aes-gcm.js';

describe('AES-256-GCM', () => {
  it('round-trips a string under the same key', () => {
    const key = generateMasterKey();
    const plaintext = 'user@example.com';
    const cipher = encrypt(plaintext, key);
    expect(cipher).not.toContain(plaintext);
    expect(decrypt(cipher, key)).toBe(plaintext);
  });

  it('produces a fresh IV on every call (no ciphertext reuse)', () => {
    const key = generateMasterKey();
    const a = encrypt('same plaintext', key);
    const b = encrypt('same plaintext', key);
    expect(a).not.toBe(b);
  });

  it('refuses to decrypt with a wrong key', () => {
    const a = generateMasterKey();
    const b = generateMasterKey();
    const cipher = encrypt('secret', a);
    expect(() => decrypt(cipher, b)).toThrow();
  });

  it('rejects tampered ciphertext (auth tag)', () => {
    const key = generateMasterKey();
    const cipher = encrypt('integrity matters', key);
    const buf = Buffer.from(cipher, 'base64');
    // Flip a byte in the ciphertext region (after IV[12] + tag[16])
    const tampered = Buffer.from(buf);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decrypt(tampered.toString('base64'), key)).toThrow();
  });

  it('rejects a key with the wrong length', () => {
    const key = Buffer.alloc(16);
    expect(() => encrypt('x', key)).toThrow();
  });

  it('handles long plaintexts', () => {
    const key = generateMasterKey();
    const long = 'a'.repeat(10_000);
    expect(decrypt(encrypt(long, key), key)).toBe(long);
  });
});
