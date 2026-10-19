import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Object storage for uploaded Solidity sources. Postgres keeps the metadata
 * and the sha256; the bytes live here. The local-disk implementation backs
 * dev and tests. An S3/R2 implementation can replace it without touching the
 * routes.
 */
export interface SourceStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

/** Holds objects in process memory. Default for tests and for `buildApp()`
 * when no storage is configured. */
export class MemorySourceStorage implements SourceStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(bytes));
  }

  async get(key: string): Promise<Buffer | null> {
    const bytes = this.objects.get(key);
    return bytes ? Buffer.from(bytes) : null;
  }
}

/** Writes objects under a root directory. Keys are relative paths, so a key
 * that escapes the root is refused. */
export class LocalSourceStorage implements SourceStorage {
  constructor(private readonly rootDir: string) {}

  async put(key: string, bytes: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private resolve(key: string): string {
    const root = path.resolve(this.rootDir);
    const target = path.resolve(root, key);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Storage key escapes the storage root: ${key}`);
    }
    return target;
  }
}
