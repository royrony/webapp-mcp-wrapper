// T059: RuntimeAuthSession token store for the Node runtime (FR-014; research.md #4).
// OS keychain (keytar) in local/stdio mode; AES-GCM encrypted-file fallback in hosted mode.
// Tokens NEVER touch logs, the ExtractionReport, or a ValidationRun (Principle V).
// T067 adds the api-key fallback path.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import type { TokenSet } from "./oauth-loopback.js";

export type StorageBackend = "os-keychain" | "encrypted-file";

export interface TokenStore {
  save(session: string, tokens: TokenSet): Promise<void>;
  load(session: string): Promise<TokenSet | null>;
  clear(session: string): Promise<void>;
  readonly backend: StorageBackend;
}

const SERVICE = "webapp-mcp-wrapper";

/** OS keychain store via keytar (loaded lazily so it's optional at runtime). */
export class KeychainTokenStore implements TokenStore {
  readonly backend: StorageBackend = "os-keychain";

  async save(session: string, tokens: TokenSet): Promise<void> {
    const keytar = await import("keytar");
    await keytar.default.setPassword(SERVICE, session, JSON.stringify(tokens));
  }
  async load(session: string): Promise<TokenSet | null> {
    const keytar = await import("keytar");
    const raw = await keytar.default.getPassword(SERVICE, session);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  }
  async clear(session: string): Promise<void> {
    const keytar = await import("keytar");
    await keytar.default.deletePassword(SERVICE, session);
  }
}

/** AES-256-GCM encrypted-file store for hosted mode. Key derived from an env-supplied secret. */
export class EncryptedFileTokenStore implements TokenStore {
  readonly backend: StorageBackend = "encrypted-file";
  private readonly key: Buffer;

  constructor(
    private readonly filePath: string,
    secret: string,
  ) {
    if (!secret) throw new Error("EncryptedFileTokenStore requires a non-empty secret");
    // Fixed salt is acceptable here since the secret is the real entropy source.
    this.key = scryptSync(secret, "webapp-mcp-wrapper-salt", 32);
  }

  private async readAll(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.filePath, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async save(session: string, tokens: TokenSet): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
    const all = await this.readAll();
    all[session] = blob;
    await fs.writeFile(this.filePath, JSON.stringify(all), { mode: 0o600 });
  }

  async load(session: string): Promise<TokenSet | null> {
    const all = await this.readAll();
    const blob = all[session];
    if (!blob) return null;
    const [ivB64, tagB64, encB64] = blob.split(".");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as TokenSet;
  }

  async clear(session: string): Promise<void> {
    const all = await this.readAll();
    delete all[session];
    await fs.writeFile(this.filePath, JSON.stringify(all), { mode: 0o600 });
  }
}

/** Select a store by deployment mode. */
export function createTokenStore(
  mode: "stdio" | "streamable-http",
  opts: { filePath?: string; secret?: string } = {},
): TokenStore {
  if (mode === "stdio") return new KeychainTokenStore();
  return new EncryptedFileTokenStore(
    opts.filePath ?? "./.wrapper-tokens.enc",
    opts.secret ?? process.env.WRAPPER_TOKEN_SECRET ?? "",
  );
}
