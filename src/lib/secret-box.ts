// Secrets kept in the database (M22: the WhatsApp access token and app secret), encrypted
// with AES-256-GCM under APP_ENCRYPTION_KEY, which lives only in the server's environment.
// A database dump or a backup therefore holds nothing that can send a message.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";

const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY ?? "";
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new AppError("RULE", { message: "whatsapp.errors.noEncryptionKey" });
  }
  return bytes;
}

export function encryptionConfigured(): boolean {
  return Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64").length === 32;
}

// "v1:<iv>:<tag>:<data>", all base64.
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

// Null when it cannot be opened (another key, damaged): treated as "not set".
export function unseal(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [version, iv, tag, data] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
