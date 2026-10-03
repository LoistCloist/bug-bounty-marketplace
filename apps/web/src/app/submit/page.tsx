"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { developerApi, ApiError } from "@/lib/api";
import { useWallet } from "@/lib/wallet";

const MAX_FILE_BYTES = 102_400; // 100 KB

function validateFile(file: File | null): string | null {
  if (!file) return "Choose a .sol file to submit.";
  if (!file.name.toLowerCase().endsWith(".sol")) {
    return "Only .sol files are accepted.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "File is too large - the limit is 100 KB.";
  }
  return null;
}

export default function SubmitPage() {
  const router = useRouter();
  const wallet = useWallet();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [bountyAmount, setBountyAmount] = useState("1");
  const [currency, setCurrency] = useState("ETH");
  const [deadline, setDeadline] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!wallet.address) {
        throw new Error("Connect a wallet before submitting a contract.");
      }
      const validationError = validateFile(file);
      if (validationError) {
        throw new Error(validationError);
      }
      if (!deadline) {
        throw new Error("Choose a deadline.");
      }
      return developerApi.submitContract({
        file: file!,
        developerAddress: wallet.address,
        bountyAmount: Number(bountyAmount),
        currency,
        // `datetime-local` inputs have no timezone/seconds info; normalize
        // to the full ISO 8601 string the shared Contract schema expects.
        deadline: new Date(deadline).toISOString(),
      });
    },
    onSuccess: (contract) => {
      router.push(`/contracts/${contract.id}`);
    },
  });

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setFileError(selected ? validateFile(selected) : null);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateFile(file);
    setFileError(validationError);
    if (validationError) return;
    submitMutation.mutate();
  }

  const errorMessage =
    submitMutation.error instanceof ApiError
      ? submitMutation.error.message
      : submitMutation.error instanceof Error
        ? submitMutation.error.message
        : null;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-white">Submit a contract</h1>
      <p className="mt-2 text-slate-400">
        Upload a Solidity source file and fund a bounty. Analysis (Slither + LLM) kicks
        off automatically once submitted.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-slate-200">
            Contract source (.sol, max 100 KB)
          </label>
          <input
            ref={fileInputRef}
            id="file"
            name="file"
            type="file"
            accept=".sol"
            onChange={handleFileChange}
            className="mt-2 block w-full text-sm text-slate-300 file:mr-4 file:rounded-md file:border-0 file:bg-emerald-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-950 hover:file:bg-emerald-400"
          />
          {fileError && <p className="mt-2 text-sm text-red-400">{fileError}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="bountyAmount" className="block text-sm font-medium text-slate-200">
              Bounty amount
            </label>
            <input
              id="bountyAmount"
              name="bountyAmount"
              type="number"
              min="0"
              step="any"
              required
              value={bountyAmount}
              onChange={(e) => setBountyAmount(e.target.value)}
              className="mt-2 block w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label htmlFor="currency" className="block text-sm font-medium text-slate-200">
              Currency
            </label>
            <select
              id="currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-2 block w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="ETH">ETH</option>
              <option value="USDC">USDC</option>
              <option value="DAI">DAI</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="deadline" className="block text-sm font-medium text-slate-200">
            Deadline
          </label>
          <input
            id="deadline"
            name="deadline"
            type="datetime-local"
            required
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="mt-2 block w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
          />
        </div>

        {errorMessage && (
          <p role="alert" className="text-sm text-red-400">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={submitMutation.isPending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitMutation.isPending ? "Submitting..." : "Submit contract"}
        </button>
      </form>
    </div>
  );
}
