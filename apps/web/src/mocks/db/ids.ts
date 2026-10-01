const counters = new Map<string, number>();

/** Returns a readable, incrementing id like "contract_1", "finding_4". */
export function nextId(prefix: string): string {
  const n = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, n);
  return `${prefix}_${n}`;
}

export function resetIdCounters(): void {
  counters.clear();
}
