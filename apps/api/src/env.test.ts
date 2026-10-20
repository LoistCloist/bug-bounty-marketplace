import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBoolEnv, parseIntEnv, resolveMigrationsDir } from "./env.js";

describe("parseBoolEnv", () => {
  it("uses the fallback when unset or blank", () => {
    expect(parseBoolEnv(undefined, true)).toBe(true);
    expect(parseBoolEnv("", true)).toBe(true);
    expect(parseBoolEnv("  ", false)).toBe(false);
  });

  it.each(["false", "0", "no", "off", "FALSE", " Off "])("treats %j as false", (v) => {
    expect(parseBoolEnv(v, true)).toBe(false);
  });

  it.each(["true", "1", "yes", "on"])("treats %j as true", (v) => {
    expect(parseBoolEnv(v, false)).toBe(true);
  });
});

describe("parseIntEnv", () => {
  it("parses positive integers", () => {
    expect(parseIntEnv("10", 5)).toBe(10);
  });

  it.each([undefined, "", "abc", "0", "-3", "2.5"])("falls back for %j", (v) => {
    expect(parseIntEnv(v, 5)).toBe(5);
  });
});

describe("resolveMigrationsDir", () => {
  const moduleUrl = pathToFileURL(path.join(path.sep, "app", "dist", "index.js")).href;

  it("defaults to a migrations dir next to the running module", () => {
    expect(resolveMigrationsDir(undefined, moduleUrl)).toBe(
      path.join(path.sep, "app", "dist", "migrations"),
    );
  });

  it("matches src/db/migrations when running from source", () => {
    const srcUrl = pathToFileURL(path.join(path.sep, "app", "src", "db", "migrate.ts")).href;
    expect(resolveMigrationsDir("", srcUrl)).toBe(
      path.join(path.sep, "app", "src", "db", "migrations"),
    );
  });

  it("prefers MIGRATIONS_DIR when set, resolved to an absolute path", () => {
    expect(resolveMigrationsDir("/srv/migrations", moduleUrl)).toBe(path.resolve("/srv/migrations"));
    expect(path.isAbsolute(resolveMigrationsDir("rel/migrations", moduleUrl))).toBe(true);
  });
});
