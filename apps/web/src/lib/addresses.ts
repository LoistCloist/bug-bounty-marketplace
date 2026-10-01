/**
 * Fixed mock wallet addresses, one per role. Shared between the role/wallet
 * store (`src/lib/role`, `src/lib/wallet`) and the mock DB seed data
 * (`src/mocks/db`) so that "connected as developer" lines up with the
 * `developerAddress` on the seeded contracts out of the box.
 */
export const MOCK_ADDRESSES = {
  developer: `0x${"d1".repeat(20)}`,
  auditor: `0x${"a2".repeat(20)}`,
  arbiter: `0x${"b3".repeat(20)}`,
} as const;

export type MockRole = keyof typeof MOCK_ADDRESSES;
