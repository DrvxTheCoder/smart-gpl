import type { TenantConfig } from "../types";
import { customerBottleBalance, clientSite, siteBalance } from "./bottle-ledger";
import { categoryOf, contractAt } from "./contracts";
import { accountBalance, ageing, exposure, openDebits, pendingOrdersValue, type Ageing, type Exposure, type OpenDebit } from "./exposure";
import { priceFor, valueOf } from "./pricing";
import { solvency, type Solvency } from "./solvency";
import type { BottleMovement, BrandGrid, Contract, ContractTerms, Customer, CustomerCategory, Money, SalesData } from "./types";

/* Read models for screens: plain inputs in, plain figures out. */

export interface Position {
  customer: Customer;
  category: CustomerCategory | undefined;
  contract: Contract | null;
  terms: ContractTerms;
  wholesaler: boolean;
  balance: Money;
  open: OpenDebit[];
  ageing: Ageing;
  floatQty: Record<string, number>; // fulls held at the wholesaler's site
  floatValue: Money;
  exposure: Exposure;
  solvency: Solvency;
  bottles: BrandGrid;
}

export function customerPosition(o: { cfg: TenantConfig; data: SalesData; ledger: BottleMovement[]; today: string; own: string }, customer: Customer, exceptOrderId?: string): Position {
  const sc = o.cfg.sales;
  const category = categoryOf(sc, customer);
  const contract = contractAt(o.data.contracts, customer.id, o.today);
  const terms = contract?.terms ?? category?.defaults ?? sc.categories[0].defaults;
  const wholesaler = category?.kind === "GROSSISTE";
  const balance = accountBalance(o.data.entries, customer.id);
  const open = openDebits(o.data.entries, customer.id, o.today);
  const age = ageing(open);
  const floatQty = wholesaler ? { ...(siteBalance(o.ledger, clientSite(customer.id)).PLEIN[o.own] ?? {}) } : {};
  const floatValue = valueOf(floatQty, (f) => priceFor(sc.priceLists, terms.priceListId, f, o.today));
  const exp = exposure({ balance, pendingOrders: pendingOrdersValue(o.data.orders, o.data.dispatches, customer.id, exceptOrderId), consignment: floatValue });
  return {
    customer,
    category,
    contract,
    terms,
    wholesaler,
    balance,
    open,
    ageing: age,
    floatQty,
    floatValue,
    exposure: exp,
    solvency: solvency({
      cfg: sc.solvency,
      entries: o.data.entries,
      incidents: o.data.incidents,
      customerId: customer.id,
      today: o.today,
      termDays: terms.payment.kind === "COMPTANT" ? 0 : terms.payment.days,
      limit: terms.creditLimit,
      exposure: exp.total,
      openTotal: age.total,
      overdue: age.overdue,
      floatValue,
    }),
    bottles: customerBottleBalance(o.ledger, customer.id, sc.consignment.balanceBasis),
  };
}

/** Customers served by a centre ("all" = every centre). */
export const customersIn = (customers: Customer[], centreId: string) => (centreId === "all" ? customers : customers.filter((c) => c.centreIds.includes(centreId)));
