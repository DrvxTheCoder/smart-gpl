import { shiftDate } from "./dates";
import type { Contract, ContractTerms, Customer, CustomerCategory, SalesConfig } from "./types";

/** Every version of a customer's contract, newest first. */
export const contractVersions = (contracts: Contract[], customerId: string) =>
  contracts.filter((c) => c.customerId === customerId).sort((a, b) => b.version - a.version);

/** The version in force on a date: started on or before it, not ended before it. */
export function contractAt(contracts: Contract[], customerId: string, date: string): Contract | null {
  return contractVersions(contracts, customerId).find((c) => c.validFrom <= date && (c.validTo == null || c.validTo >= date)) ?? null;
}

/**
 * A new version takes effect on `from`: the current one ends the day before.
 * Terms are never edited in place, so past orders keep the terms they were made under.
 */
export function newVersion(contracts: Contract[], customerId: string, terms: ContractTerms, from: string, by: string, now: string, id: string): Contract[] {
  const versions = contractVersions(contracts, customerId);
  const prevDay = shiftDate(from, -1);
  const closed = contracts.map((c) => (c.customerId === customerId && (c.validTo == null || c.validTo >= from) && c.validFrom < from ? { ...c, validTo: prevDay } : c));
  const version = (versions[0]?.version ?? 0) + 1;
  return [...closed, { id, customerId, version, validFrom: from, validTo: null, terms, createdBy: by, createdAt: now }];
}

export const categoryOf = (cfg: SalesConfig, c: Customer): CustomerCategory | undefined => cfg.categories.find((k) => k.id === c.categoryId);

export const isWholesaler = (cfg: SalesConfig, c: Customer) => categoryOf(cfg, c)?.kind === "GROSSISTE";
