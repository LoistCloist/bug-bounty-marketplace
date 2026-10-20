/**
 * Conversions between human ETH (what people type and read) and wei decimal
 * strings (what the API and contracts use). Done with BigInt so no value
 * passes through a JS number.
 */

const WEI_PER_ETH = 10n ** 18n;
const ETH_PATTERN = /^\d+(\.\d{1,18})?$/;

/** Converts an ETH amount typed by a person ("1", "0.25") to a wei string. */
export function ethToWei(eth: string): string {
  const trimmed = eth.trim();
  if (!ETH_PATTERN.test(trimmed)) {
    throw new Error("Enter an amount in ETH, up to 18 decimal places.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const wei = BigInt(whole!) * WEI_PER_ETH + BigInt(fraction.padEnd(18, "0"));
  return wei.toString();
}

/** Formats a wei string as ETH for display, trimming trailing zeros. */
export function weiToEth(wei: string): string {
  const value = BigInt(wei);
  const whole = value / WEI_PER_ETH;
  const fraction = (value % WEI_PER_ETH).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}
