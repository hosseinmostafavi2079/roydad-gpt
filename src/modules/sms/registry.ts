import "server-only";
import { createKavenegarProvider } from "./kavenegar";
import type { SmsProvider } from "./provider";
import { testSmsProvider, assertTestSmsAllowed } from "./test-provider";

export class SmsProviderRegistry {
  private readonly adapters = new Map<string, SmsProvider>();
  constructor(providers: SmsProvider[]) {
    for (const provider of providers) {
      if (this.adapters.has(provider.key))
        throw new Error("Duplicate SMS provider");
      this.adapters.set(provider.key, provider);
    }
  }
  resolve(key: string): SmsProvider {
    if (key === "TEST") assertTestSmsAllowed();
    const adapter = this.adapters.get(key);
    if (!adapter) throw new Error("Unsupported SMS provider");
    return adapter;
  }
  list() {
    return [...this.adapters.values()]
      .filter((adapter) => adapter.key !== "TEST")
      .map(({ key, capabilities, configurationFields }) => ({
        key,
        capabilities,
        configurationFields,
      }));
  }
}
export const smsProviderRegistry = new SmsProviderRegistry([
  createKavenegarProvider(),
  testSmsProvider,
]);
