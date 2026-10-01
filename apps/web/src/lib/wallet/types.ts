/** Minimal wallet interface. A real wagmi-backed implementation can later
 * implement this same shape as a drop-in replacement for `useWallet`. */
export interface Wallet {
  address: string | null;
  isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): void;
}
