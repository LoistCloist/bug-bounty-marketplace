// @bbm/shared - the Zod schemas (and inferred types) that form the API
// contract shared across apps/web, apps/api, and workers/. JSON Schema
// exports consumed by non-TS services are generated from these via
// `pnpm --filter @bbm/shared run gen:schema` into packages/shared/schema/.

export const SHARED_PACKAGE_NAME = "@bbm/shared";

export * from "./common";
export * from "./contract";
export * from "./bounty";
export * from "./finding";
export * from "./poc-submission";
export * from "./dispute";
export * from "./auditor-profile";
