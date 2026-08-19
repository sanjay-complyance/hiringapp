import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function credentialKey() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required for AI connections");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must encode exactly 32 bytes");
  return key;
}

export function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptCredential(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Unsupported credential format");
  const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
