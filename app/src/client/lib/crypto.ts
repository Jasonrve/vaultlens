import * as openpgp from 'openpgp';

/**
 * Encrypt a plaintext secret using OpenPGP symmetric encryption.
 * Returns the encrypted message as an armored string and the passphrase
 * (which serves as the decryption key — stored only in the URL fragment).
 */
export async function encryptSecret(plaintext: string): Promise<{
  encrypted: string;
  key: string;
}> {
  // Generate a random passphrase (32 bytes, base64url-encoded)
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...keyBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const message = await openpgp.createMessage({ text: plaintext });
  const encrypted = await openpgp.encrypt({
    message,
    passwords: [key],
    format: 'armored',
  });

  return { encrypted: encrypted as string, key };
}

/**
 * Decrypt an OpenPGP-encrypted message using the provided passphrase.
 * Returns the original plaintext.
 */
export async function decryptSecret(
  encrypted: string,
  key: string
): Promise<string> {
  const message = await openpgp.readMessage({ armoredMessage: encrypted });
  const { data } = await openpgp.decrypt({
    message,
    passwords: [key],
  });

  return data as string;
}
