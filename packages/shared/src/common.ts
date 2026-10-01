import { z } from "zod";

/**
 * Timestamp convention used across every entity in this package: an ISO 8601
 * datetime string (e.g. "2026-09-30T12:00:00.000Z"). Picked over epoch
 * millis because it's human-readable in generated JSON Schema / fixtures
 * and serializes losslessly through JSON without a wrapper type.
 */
export const TimestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Ethereum-style address, loosely validated (0x + 40 hex chars). */
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, {
  error: "Must be a valid 0x-prefixed 40 hex character address",
});
export type Address = z.infer<typeof AddressSchema>;

/** Generic entity id. Kept as a non-empty string rather than a UUID-only
 * schema so seed data / mocks can use readable ids (e.g. "contract_1"). */
export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;
