import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSourceStorage } from "./storage.js";

describe("LocalSourceStorage", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "bbm-storage-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes under a nested key", async () => {
    const storage = new LocalSourceStorage(root);
    const bytes = Buffer.from("contract Vault {}");

    await storage.put("contracts/contract_1/abc.sol", bytes);

    expect(await storage.get("contracts/contract_1/abc.sol")).toEqual(bytes);
    expect(await readFile(path.join(root, "contracts/contract_1/abc.sol"))).toEqual(bytes);
  });

  it("returns null for a missing key", async () => {
    const storage = new LocalSourceStorage(root);
    expect(await storage.get("contracts/nope.sol")).toBeNull();
  });

  it("refuses a key that escapes the storage root", async () => {
    const storage = new LocalSourceStorage(root);
    await expect(storage.put("../outside.sol", Buffer.from("x"))).rejects.toThrow(
      /escapes the storage root/,
    );
  });
});
