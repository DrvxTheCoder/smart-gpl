# Smart GPL — LPG production and sales prototype

Clickable front-end prototype of a multi-tenant product for LPG filling centres (product name
**Smart GPL**; the code still uses the old working name "jauge" internally). French UI, mock data for a
fictional operator (**Baobab Énergie SA**, centres of Rufisque and Kaolack, brand « Baobab Gaz »,
competitors « Sahel Gaz », « Teranga Gaz », « Delta Butane »). Nothing belongs to a real operator.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
# or
npm run build && npm start
npm test           # Vitest: correction engine, demo data, config migration, sales engines and commands
npm run lint       # type check (tsc --noEmit); Next 16 removed `next lint` and ESLint is not installed
```

Node 20+ recommended. No database or environment variables needed.

## Screens

### Production

| Route | What it shows |
|---|---|
| `/` | Dashboard: period KPIs, 7-day production bars, today's inventory, live timer, tank gauge and levels, recent inventories; below, « Demande vs production (7 j) » |
| `/inventaires` | Paginated, searchable list + month calendar coloured by écart band, monthly report card |
| `/inventaires/[id]` | Daily sheet: production time, night shift, tabs (supply, bottles, bulk outflows with the bulk BL reconciliation panel, tanks, stoppages, vehicles), live stock balance, closing flow |
| `/analyses` | KPIs with sparklines, tonnage vs previous period, bottle mix, lost time, 20-week écart heatmap |

### Commercial and warehouse

| Route | What it shows |
|---|---|
| `/ventes` | Commercial bento: bottles sold this week vs forecast pace, fill rate, OTIF, reliquats, forecast vs demand bars (hatched forecast), receivables ageing, wholesalers to call, today's trucks, fill plan |
| `/ventes/commandes` | Orders (BC) with status filters in the URL, to-do, Sage CSV export; fast order entry (`?nouveau=1&client=`) |
| `/ventes/commandes/[id]` | Order sheet: lines vs dispatched/reliquat/remaining, trucks, history, live summary and next step; confirm (credit, ATP, override), approve, plan a truck, reliquat, cancel/rectify |
| `/ventes/clients` | Customers: exposure vs limit, overdue, solvency; create (`?nouveau=1`) |
| `/ventes/clients/[id]` | Customer sheet: versioned contract, account ledger and ageing, payments, reversing entries, incidents, bottle balance, orders, solvency explanation. Wholesalers add: stock chez le grossiste, passages, comptages, appels and declarations |
| `/ventes/previsions` | Forecast grid (customers or categories, week or month, spreadsheet paste), versions, forecast vs demand, MAPE and bias, fill plan vs line capacity |
| `/ventes/grossistes` | Consignment follow-up vs threshold and each wholesaler's own rhythm, escalation ladder, passages heatmap, call tasks; passage dialog (`?passage=<id>`) |
| `/magasin` | Stock et bouteilles: fulls/empties/condemned by brand × format, ATP, competitor positions, movements, adjustments, counts and variance review, inter-brand exchange, day close |
| `/magasin/rapport` | Print view of the authority daily report (`?c=<centre>&jour=<date>`) |
| `/expeditions` | Truck queue by stage |
| `/expeditions/[id]` | Dispatch sheet: Camion → Vides reçues (brand × format, two-party confirmation) → Chargement (weighbridge, prepayment) → BL numérique (PDF) → proof of delivery |
| `/parametres` | Tenant configuration, now with Marques et bouteilles, Clients et contrats, Ventes et flux, Consignation, Rapports, Rôles (and the prototype role switcher) |

Shell: sidebar sections Menu, Commercial, Magasin, Général with badges (in-progress inventory, orders to
approve, trucks loading, late wholesalers); alert bell with a derived list; command palette
(`Ctrl K`, `G` then `D I A P V C K R G S E`, actions `N M L C K F P`, search over customers and orders).

## How it's organised

```
app/                    routes (all client components in the prototype)
components/shell        sidebar (GSAP rail), topbar, alert bell, command palette, island
components/ui           primitives (Button, Card, Segmented, Switch, Dialog, Field, NumberInput, IntegerInput, Stepper…)
components/charts       hand-built SVG charts (bars, forecast bars, half gauge, donut, line, sparkline, heatmap)
components/sales        sales and warehouse UI (order entry, grids, ConfirmCount, panels, dialogs)
components/settings     settings panels (correction, sales)
lib/types.ts            domain model; re-exports lib/sales/types.ts
lib/calc.ts, lib/correction/, lib/aggregate.ts   production engines (unchanged by the sales module)
lib/tenant-io.ts        config validation (v3), JSON template import/export, localStorage migration
lib/checker.ts          shared structural checker for untrusted JSON
lib/seed.ts             demo tenant + deterministic production generator
lib/store.tsx           production store (config, inventories, centre, toasts, background jobs)
lib/sales/              sales domain, pure (no React, no storage, no clock):
  types.ts defaults.ts config.ts labels.ts keys.ts
  pricing.ts contracts.ts dates.ts exposure.ts solvency.ts stock.ts bottle-ledger.ts
  lifecycle.ts (states, guards, effects as data) consignment.ts forecast.ts fill-plan.ts
  day-close.ts sage.ts bl-pdf.ts alerts.ts selectors.ts
  seed.ts (60-day demo, driven by closed inventories) data.ts (overlay persistence)
  commands/ (customers, orders, dispatch, warehouse, consignment, forecast, export)
  store.tsx (SalesProvider, nested in StoreProvider)
```

Every business rule is a pure function taking plain data (and `now`). Commands take the current state
and return a patch; the provider commits it. Ledgers (bottle movements, account entries) are
append-only: balances are sums, corrections are reversing entries with a reason. Confirmed orders,
expedited BLs, confirmed passages and closed days are read-only. This is meant to map one-to-one onto
tables and server actions when Prisma/Postgres replaces the client store.

## Storage keys

| Key | Content |
|---|---|
| `jauge:config` | `{ version: 3, config }` tenant configuration, including `sales` |
| `jauge:edits:v1` | inventories changed on this device |
| `jauge:sales:v1` | `{ version: 1, overlay }` sales documents and ledger rows created on this device |
| `jauge:role` | prototype role switcher (per device) |
| `jauge:density`, `jauge:sidebar-collapsed` | display preferences |

New sales keys live in `lib/sales/keys.ts`. The sales demo is regenerated each day from the inventories;
only what the user created is stored, on top. « Restaurer la démo » clears configuration, inventories
and sales.

## Theming

A tenant picks **one** colour (`--brand`). Every shade is derived with `color-mix()` in
`app/globals.css`; status colours (ok / warn / alert) are fixed. The BL and report headers use it.

## What is mocked

- **Data:** generated client-side from today's date; deterministic per day.
- **Correction factors:** see `lib/correction`; the built-in table's `source` is a placeholder.
- **Auth:** none. Paramètres, Rôles has a role switcher so each team's view can be shown; permissions
  are checked with `can(action)` in commands and the UI.
- **Documents:** the BL PDF and the authority report are real files; Sage receives a CSV.

## Assumptions to confirm with the client

Implemented as defaults, configurable where noted:

- Wholesaler sales are priced on the **settlement** day (Paramètres, Consignation: or placement day).
- Customer bottle balances are kept **by format**, bottles being fungible (or by brand × format).
  Physical stock and the authority report are always by brand.
- Wholesalers pay **at each passage** by default; configurable per contract (periodic statement, due date).
- Inactivity threshold **5 days**, ladder **5 / 7 / 10** (call task, notify manager, block placements);
  overridable per category and per contract. Wholesaler counts **monthly**.
- Solvency weights and thresholds are **illustrative**. Formula: four sub-scores in 0–1, weighted:
  delay (average days paid past due, unpaid overdue counted at today; 0 j → 1, 30 j → 0), share of open
  receivables overdue, credit use (≤ 70 % → 1, ≥ 120 % → 0), incidents (bounced cheque 2 points,
  dispute 1, 4 points → 0). The suggested limit (sales over term + 7 days, plus consignment float, cut
  by 20 % or 50 % on a weak score and never above the current limit then) is never applied automatically.
- The authority report template and the Sage export columns are **placeholders**; files say so until
  the real specifications are entered and the box is ticked in Paramètres, Rapports.
- **No fiscal or legal compliance is claimed.** The digital BL is marked « Document interne :
  facturation dans Sage ». Document numbering is configurable. Regulated prices, quotas and fiscal
  invoicing rules for Senegal are unverified.
- Ownership of code vs the operator's processes is a contractual matter outside this repository; all
  operator-specific values live in tenant configuration and seed data.
- Bulk orders are not checked against tank stock at confirmation (bottles only).
- Proposed, not done: pre-filling the inventory's Véhicules tab (Chargés COM / LIV) from the day's
  expedited dispatches by mode, instead of entering it twice.

## Suggested next steps toward the full product

1. Prisma schema with `tenantId` on every table + Postgres row-level security; mirror `lib/types.ts`
   and `lib/sales/types.ts`; ledgers as insert-only tables.
2. Server actions replacing the client store; commands in `lib/sales/commands` port as they are.
3. Real authentication and roles; audit log; signatures in `ConfirmCount` (the proof field is ready).
4. Sage integration beyond CSV once the import format is known; the official authority report format.
5. Tank calibration tables, offline entry for the gate, i18n.
