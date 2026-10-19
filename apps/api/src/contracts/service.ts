import { createHash, randomUUID } from "node:crypto";
import {
  type Bounty,
  type Contract,
  ContractSourceFilenameSchema,
  ContractSourceSizeSchema,
  ContractSubmissionFieldsSchema,
} from "@bbm/shared";
import type { ContractRepository } from "./repository.js";
import type { SourceStorage } from "./storage.js";

export interface ContractServiceDeps {
  repository: ContractRepository;
  storage: SourceStorage;
  /** Injectable for tests. */
  now?: () => Date;
}

export interface SubmitContractInput {
  filename: string;
  bytes: Buffer;
  /** Raw non-file form fields, validated by ContractSubmissionFieldsSchema. */
  fields: Record<string, string>;
}

/** Thrown when a submission breaks a rule. `issues` lists every failed
 * check so the client can show them together. */
export class ContractValidationError extends Error {
  constructor(readonly issues: string[]) {
    super("Invalid contract submission");
    this.name = "ContractValidationError";
  }
}

/** Storage key for a submitted source. Content-addressed by sha256 so a
 * re-upload of the same bytes lands on the same object. */
export function sourceStorageKey(contractId: string, sourceHash: string): string {
  return `contracts/${contractId}/${sourceHash}.sol`;
}

/** Flattens a Zod safeParse result into its failure messages. */
function collectIssues(result: {
  success: boolean;
  error?: { issues: ReadonlyArray<{ message: string }> };
}): string[] {
  return result.error ? result.error.issues.map((issue) => issue.message) : [];
}

/**
 * Validates a `.sol` submission, stores its bytes, and records the contract
 * and its bounty. Storage is written before the DB rows, so a failed insert
 * leaves an unreferenced object rather than a row pointing at nothing.
 */
export async function submitContract(
  deps: ContractServiceDeps,
  input: SubmitContractInput,
): Promise<Contract> {
  const fieldResult = ContractSubmissionFieldsSchema.safeParse(input.fields);
  const issues = [
    ...collectIssues(ContractSourceFilenameSchema.safeParse(input.filename)),
    ...collectIssues(ContractSourceSizeSchema.safeParse(input.bytes.byteLength)),
    ...collectIssues(fieldResult),
  ];
  if (!fieldResult.success || issues.length > 0) {
    throw new ContractValidationError(issues);
  }
  const fields = fieldResult.data;

  const now = (deps.now ?? (() => new Date()))().toISOString();
  const contractId = `contract_${randomUUID()}`;
  const bountyId = `bounty_${randomUUID()}`;
  const sourceHash = createHash("sha256").update(input.bytes).digest("hex");
  const sourceReference = sourceStorageKey(contractId, sourceHash);

  await deps.storage.put(sourceReference, input.bytes);

  const bounty: Bounty = {
    id: bountyId,
    contractId,
    amount: fields.bountyAmount,
    currency: fields.currency,
    fundedAt: now,
    deadline: fields.deadline,
  };
  const contract: Contract = {
    id: contractId,
    developerAddress: fields.developerAddress,
    filename: input.filename,
    sourceHash,
    sourceReference,
    bountyId,
    status: "Open",
    createdAt: now,
    deadline: fields.deadline,
  };

  await deps.repository.insertContract({ contract, bounty });
  return contract;
}
