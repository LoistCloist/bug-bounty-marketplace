// @bbm/shared - the Zod schemas (and inferred types) that form the API
// contract shared across apps/web, apps/api, and workers/. JSON Schema
// exports consumed by non-TS services are generated from these via
// `pnpm --filter @bbm/shared run gen:schema` into packages/shared/schema/.

export const SHARED_PACKAGE_NAME = "@bbm/shared";

export * from "./common.js";
export * from "./contract.js";
export * from "./bounty.js";
export * from "./finding.js";
export * from "./poc-submission.js";
export * from "./dispute.js";
export * from "./auditor-profile.js";
