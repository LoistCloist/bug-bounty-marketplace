import React from "react";
import type { AnalysisStatus } from "@bbm/shared";

/** What the developer sees in place of findings while there are none: the
 * analysis is still running, it failed (with the compiler's message), or it
 * finished clean. */
export function AnalysisNotice({ status }: { status: AnalysisStatus | undefined }) {
  if (status?.status === "Failed") {
    return (
      <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-3">
        <p className="text-sm font-medium text-red-300">Analysis failed</p>
        {status.error && (
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-red-200">
            {status.error}
          </pre>
        )}
      </div>
    );
  }
  if (status?.status === "Done") {
    return <p className="mt-3 text-sm text-slate-400">Slither found no issues in this contract.</p>;
  }
  return (
    <p className="mt-3 text-sm text-slate-400">
      Analysis is still running - findings will appear here automatically once ready.
    </p>
  );
}
