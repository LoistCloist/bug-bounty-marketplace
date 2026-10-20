import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { env } from "../lib/env.js";
import { decodeAddress, rpc } from "../lib/rpc.js";

/** Shape written by contracts/script/Deploy.s.sol (deployments/<chainId>.json). */
interface Deployments {
  chainId: number;
  operator: string;
  arbiter: string;
  challengeWindow: number;
  refundDelay: number;
  auditorStaking: string;
  bountyEscrow: string;
  disputeResolution: string;
}

// BBM_DEPLOYMENTS_FILE may be absolute or relative. A relative path is taken
// relative to the repo root (vitest runs with cwd = tests/, so `../<file>`),
// matching how CI copies the compose volume to `.ci/deployments/31337.json`.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const deploymentsPath = isAbsolute(env.deploymentsFile)
  ? env.deploymentsFile
  : resolve(repoRoot, env.deploymentsFile);
const hasDeployments = existsSync(deploymentsPath);
if (!hasDeployments) {
  console.warn(
    `[chain] skipping: no deployments file at ${deploymentsPath} ` +
      "(no local chain, e.g. Azure Container Apps; set BBM_DEPLOYMENTS_FILE to enable)",
  );
}

// `disputeResolution()` on AuditorStaking and BountyEscrow.
const DISPUTE_RESOLUTION_SELECTOR = "0xbe9157cf";

// Skipped when no deployments file exists, e.g. the Azure Container Apps
// environment, which has no anvil chain to deploy to.
describe.skipIf(!hasDeployments)(`chain: deployed contracts (${deploymentsPath})`, () => {
  const load = (): Deployments => JSON.parse(readFileSync(deploymentsPath, "utf8")) as Deployments;

  it("deployments file names every contract and setting", () => {
    const d = load();
    for (const key of [
      "arbiter",
      "auditorStaking",
      "bountyEscrow",
      "disputeResolution",
      "operator",
    ] as const) {
      expect(d[key], key).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect(Number(d.challengeWindow)).toBeGreaterThan(0);
    expect(Number(d.refundDelay)).toBeGreaterThan(0);
  });

  it("eth_chainId matches the deployments chainId", async () => {
    const chainId = await rpc("eth_chainId");
    expect(Number(BigInt(chainId))).toBe(Number(load().chainId));
  });

  it.each(["auditorStaking", "bountyEscrow", "disputeResolution"] as const)(
    "%s has code on chain",
    async (name) => {
      const code = await rpc("eth_getCode", [load()[name], "latest"]);
      expect(code).toMatch(/^0x[0-9a-f]+$/i);
      expect(code.length).toBeGreaterThan(2);
    },
  );

  it.each(["auditorStaking", "bountyEscrow"] as const)(
    "%s.disputeResolution() is bound to the deployed DisputeResolution",
    async (name) => {
      const d = load();
      const word = await rpc("eth_call", [
        { to: d[name], data: DISPUTE_RESOLUTION_SELECTOR },
        "latest",
      ]);
      expect(decodeAddress(word)).toBe(d.disputeResolution.toLowerCase());
    },
  );
});
