// Obfuscated salt tokens to prevent plain-text exposure in inspection
const _d = (s: string) => typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('utf-8');
const GLOBAL_SALT = _d('cmFpbHdheV9zZWN1cmVfcGluX3NhbHRfdjFf');
const GLOBAL_PASSWORD_SALT = _d('cmFpbHdheV9zZWN1cmVfcHdkX3NhbHRfdjFf');

/**
 * Hashes a numeric PIN securely using SHA-256 and a user-specific salt.
 * Uses the browser's native SubtleCrypto API.
 */
export async function hashPin(pin: string, userIdOrPf: string): Promise<string> {
  const salt = GLOBAL_SALT + (userIdOrPf || 'default_user');
  const msgUint8 = new TextEncoder().encode(pin + salt);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Checks if a stored PIN is already hashed (SHA-256 hash is a 64-character hex string).
 */
export function isHashedPin(pin: string | undefined | null): boolean {
  if (!pin) return false;
  return /^[a-f0-9]{64}$/i.test(pin);
}

/**
 * Hashes a password securely using SHA-256 and a user-specific salt.
 * Uses the browser's native SubtleCrypto API.
 */
export async function hashPassword(password: string, loginIdOrEmpId: string): Promise<string> {
  const salt = GLOBAL_PASSWORD_SALT + (loginIdOrEmpId || 'default_admin');
  const msgUint8 = new TextEncoder().encode(password + salt);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Checks if a stored password is already hashed (SHA-256 hash is a 64-character hex string).
 */
export function isHashedPassword(password: string | undefined | null): boolean {
  if (!password) return false;
  return /^[a-f0-9]{64}$/i.test(password);
}

