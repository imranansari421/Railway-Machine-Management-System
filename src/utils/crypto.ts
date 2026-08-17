const GLOBAL_SALT = 'railway_secure_pin_salt_v1_';
const GLOBAL_PASSWORD_SALT = 'railway_secure_pwd_salt_v1_';

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

