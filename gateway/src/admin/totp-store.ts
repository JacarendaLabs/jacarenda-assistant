/**
 * Persistent TOTP-secret storage.
 *
 * Stores the admin's TOTP secret at $GATEWAY_SECURITY_DIR/admin-totp.json.
 * The secret itself is encrypted with AES-256-GCM using a key derived
 * from the HMAC signing key (same key that protects session cookies +
 * JWTs). Keeps the surface area small: one key to protect.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { dirname, join } from "node:path";

import { getSigningKey } from "../auth/token-service.js";
import { getLogger } from "../logger.js";
import { getGatewaySecurityDir } from "../paths.js";

const log = getLogger("admin-totp-store");

const STORE_FILENAME = "admin-totp.json";
const ALGO = "aes-256-gcm";
const TAG_LENGTH = 16;

interface StoreFile {
  version: 1;
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex (encrypted base32 secret)
}

function getStorePath(): string {
  return join(getGatewaySecurityDir(), STORE_FILENAME);
}

function deriveKey(): Buffer {
  // 32-byte derived key: SHA-256(signingKey || "admin-totp-v1")
  return createHash("sha256")
    .update(getSigningKey())
    .update("admin-totp-v1")
    .digest();
}

function encrypt(plaintext: string): StoreFile {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, deriveKey(), iv, {
    authTagLength: TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

function decrypt(store: StoreFile): string {
  const decipher = createDecipheriv(
    ALGO,
    deriveKey(),
    Buffer.from(store.iv, "hex"),
    {
      authTagLength: TAG_LENGTH,
    },
  );
  decipher.setAuthTag(Buffer.from(store.tag, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(store.ciphertext, "hex")),
    decipher.final(),
  ]);
  return plain.toString("utf-8");
}

/**
 * Does a TOTP secret already exist on disk AND is it decryptable with the
 * current signing key? A file that exists but can't be decrypted (e.g.
 * after a signing-key rotation) is treated as not enrolled so the admin
 * can re-enrol cleanly.
 */
export function totpEnrolled(): boolean {
  return loadTotpSecret() !== null;
}

/**
 * Read and decrypt the stored TOTP secret (base32). Returns null when the
 * file doesn't exist, is malformed, or can't be decrypted (e.g. the
 * signing key that encrypted it has been rotated). Never throws.
 */
export function loadTotpSecret(): string | null {
  const path = getStorePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const store = JSON.parse(raw) as StoreFile;
    if (store.version !== 1) {
      log.warn(
        { version: store.version },
        "Unsupported admin-totp version, treating as not enrolled",
      );
      return null;
    }
    return decrypt(store);
  } catch (err) {
    log.warn(
      { err },
      "admin-totp store unreadable (likely signing-key rotation) — treating as not enrolled",
    );
    return null;
  }
}

/** Encrypt and atomically write a new TOTP secret (base32). */
export function saveTotpSecret(secretBase32: string): void {
  const path = getStorePath();
  mkdirSync(dirname(path), { recursive: true });
  const store = encrypt(secretBase32);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(store));
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
