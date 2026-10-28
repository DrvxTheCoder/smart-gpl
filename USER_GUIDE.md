# Smart GPL: process guide (temporary, for review)

How the prototype works, module by module, and in what order each process runs. UI labels are
in French as they appear on screen. Code references point to where each rule lives, so a change you
ask for can be mapped to a file.

> Temporary working document. Not committed. The last section lists points I noticed while
> writing this that may need a decision.

---

## 1. The big picture

One tenant (Baobab Énergie SA), two centres (Rufisque, Kaolack), three modules:

| Module | Who | Routes | What it owns |
|---|---|---|---|
| **Production** | Chef de production (Awa Ndiaye) | `/`, `/inventaires`, `/remplissage`, `/analyses` | The daily inventory (mass balance of LPG), filling confirmation |
| **Ventes** | Responsable commercial (Cheikh Mbaye) | `/ventes/*` | Customers, contracts, orders (BC), account, forecasts, wholesalers |
| **Stock** | Magasinier (Ousmane Ba) | `/magasin`, `/expeditions` | Bottles by brand × format, trucks and BL, counts, day close |
| *(shared)* | everyone | `/parametres`, `/connexion` | Configuration, filtered by module |

The admin (Aliou Kane) sees all modules and has every permission. Password for all: `demo`.

### How the modules hand work to each other

```
                VENTES                         PRODUCTION                       STOCK
  ┌────────────────────────────┐   ┌───────────────────────────┐   ┌────────────────────────────┐
  │ Customer + contract        │   │                           │   │                            │
  │        │                   │   │                           │   │                            │
  │ Order BC (draft→confirmed) ├──►│ Remplissage: confirm      │   │                            │
  │        │                   │   │ bottles filled per BC     ├──►│ Truck: gate-in empties     │
  │ Plan a truck ──────────────┼───┼───────────────────────────┼──►│        → loading           │
  │                            │   │ Daily inventory closed    │   │        → BL / expedition   │
  │ Account: debit at BL ◄─────┼───┼───────────────────────────┼───┤        → delivery          │
  │                            │   │   └─► fulls created in    │   │                            │
  │ Wholesaler passage ────────┼───┼──────  the bottle ledger ─┼──►│ Day close (authority rpt)  │
  └────────────────────────────┘   └───────────────────────────┘   └────────────────────────────┘
```

Key point: **production never enters bottles twice.** Fulls appear in the bottle ledger only when a
daily inventory is closed (its day + night bottle counts become `PRODUCTION` movements: own empties
−n, own fulls +n). See [lib/sales/stock.ts](lib/sales/stock.ts) `productionMovements`.

### Rules that apply everywhere

- **Commands are pure.** Every action is a function `(state) → patch | error` in
  [lib/sales/commands/](lib/sales/commands/). The error message always says the cause and the fix.
- **Ledgers are append-only.** Bottle movements and account entries are never edited. A correction is
  a reversing entry with a reason ([lib/sales/bottle-ledger.ts](lib/sales/bottle-ledger.ts) `reverse`).
- **Read-only once validated:** confirmed orders, expedited BLs, confirmed passages, closed days,
  closed inventories (except admin edit mode).
- **Optional workflow steps** (Paramètres › Ventes et flux) switch guards on or off. Two presets:
  « Dépôt simple » (credit check only) and « Usine complète » (all on, the default).
  Protected effects (stock movements, billing) run whatever is switched off.
- **Permissions** are a role × action matrix (Paramètres › Rôles), see §6.

---

## 2. Production module

### 2.1 Daily inventory (`/inventaires/[id]`)

One inventory per centre per day, id `centre_yyyy-mm-dd`. Status `EN_COURS` → `TERMINE`.

**Sequence of a production day**

1. **Open.** Today's inventory exists already in `EN_COURS` (the demo generates it; there is no
   "new inventory" button, see §8). `Stock initial` is set on it.
2. **Production time.** `Heure de début` is set; `Heure de fin` stays empty until closing.
   The live timer on the dashboard runs from the start time.
3. **Arrêts (stoppages).** Either from the live timer (start/stop button: `pausedAt` is set, then
   on stop a stop of N minutes is added, type « Autre ») or typed in the « Arrêts » tab
   (type, minutes, note).
4. **Tabs, entered during the day, in any order:**
   - **Approvisionnement**: tonnes received per supply field (configurable in Paramètres › Entrées et sorties).
   - **Bouteilles**: bottles filled per format (day shift).
   - **Bouteilles de nuit**: only when « Quart de nuit » is on (night hours, night stoppages, lines used, bottles).
   - **Sorties vrac**: bulk tonnes out per outflow field. A panel lists the bulk BLs expedited that
     day by the Stock module; « Reprendre » proposes to replace the typed figure with the sum of
     weighbridge nets (asks first, never silent).
   - **Réservoirs**: per tank, height, liquid/vapour temperature, liquid volume, pressure, d15.
     Tonnage comes from the tenant's temperature-correction profile ([lib/correction/](lib/correction/)).
     A reading outside the table either warns or blocks the tank (profile policy).
   - **Véhicules**: trucks unloaded / loaded / not unloaded… split COM / LIV, plus notes.
5. **Live balance** (right panel), recomputed on every keystroke ([lib/calc.ts](lib/calc.ts) `summarize`):
   ```
   stock théorique = stock initial − conditionné nuit + appro − vrac − conditionné jour
   stock physique  = Σ tanks (liquid, or liquid + gas, per profile)
   écart           = physique − théorique      écart % = écart / théorique
   temps total     = fin − début (− lunch break if span > 2 × break)
   temps utile     = temps total − arrêts
   rendement T/h   = conditionné jour / heures utiles; % of line capacity
   ```
   The écart is banded: ≤ `ecartOk` % good, ≤ `ecartWarn` % to watch, above: to justify
   (Paramètres › Règles de calcul).
6. **Close** (« Clôturer l'inventaire »):
   - Blocked if a tank has a reading but no result (out of table, BLOCK policy).
   - If the tanks carry warnings: a checkbox « J'ai pris connaissance… » is required.
   - If |écart| > `ecartWarn`: a second checkbox confirming the tank readings is required.
   - On close: `heureFin` = now (if empty), a running stop is closed and recorded, status `TERMINE`,
     and the correction factors used are **frozen** in `closing` so later profile edits never
     rewrite history ([lib/calc.ts](lib/calc.ts) `buildClosing`).
7. **After close:** read-only. The admin can use edit mode; saving re-freezes the factors.
8. **Effect on the other modules:** the closed day's bottles become fulls in the ledger (dated 20:00
   that day). This feeds ATP, the warehouse stock, the authority report and the forecast comparison.

### 2.2 Remplissage (`/remplissage`)

Production's queue of **confirmed** bons de commande (status `CONFIRMEE` or `EXPEDIEE`), by due date.

1. For each BC: per format, need (ordered − reliquats), already confirmed filled, left to fill.
2. « Confirmer le remplissage » opens a dialog with a **running total** per format
   ([lib/sales/commands/orders.ts](lib/sales/commands/orders.ts) `confirmFill`):
   - can grow as the lines work; never above what was ordered; never below what already left on a truck;
   - status per BC: À remplir → Partielle → Remplie.
3. The page also compares "to fill by tomorrow" with fulls in stock.
4. **Effect:** none on the ledger (fulls still come from closed inventories). It only unlocks
   loading when the « Confirmation du remplissage » step is on: a truck can load at most
   `filled − already dispatched` per format. Bulk has nothing to fill.

Permission: `order.fill` (Chef de production, Direction).

### 2.3 Dashboard and Analyses

Read-only views over inventories: period KPIs, 7-day production, tank gauges, recent inventories,
« Demande vs production (7 j) »; Analyses adds sparklines, tonnage vs previous period, bottle mix,
lost time, 20-week écart heatmap. A yearly PDF export is available ([lib/year-report.ts](lib/year-report.ts)).

---

## 3. Ventes module

### 3.1 Customer and contract (`/ventes/clients`, `/ventes/clients/[id]`)

**Create a customer** (« Nouveau client », `?nouveau=1`): name, category, zone, contact, centres, rep.
- Refused if the name duplicates an existing customer, or no centre is chosen.
- Code `CL-001`, `CL-002`… assigned automatically.
- **A contract v1 is created at once** from the category's default terms, effective today.

**Categories** (Paramètres › Clients et contrats) carry the default terms and the credit rule:

| Category | Kind | Payment | Limit | Over limit | Late beyond | then |
|---|---|---|---|---|---|---|
| Distributeur | Standard | 30 j | 15 M | Approval | 15 j | Approval |
| Station-service | Standard | 30 j | 4 M | Warn | 10 j | Approval |
| Industriel | Standard | 60 j | 30 M | Approval | 30 j | **Block** |
| Grossiste (consignation) | Wholesaler | Comptant | 3 M | Approval | 0 j | **Block** |

**Contract versions** (tab « Contrat »): terms are never edited in place. A new version takes effect
on a date ≥ today (default tomorrow); the previous version ends the day before. Orders keep the
version they were made under (`order.contractVersion`). Terms: payment term, accepted methods, credit
limit, guarantees, price list, billing trigger (at BL / at sale), payment trigger, invoicing
(per passage / periodic statement), float cap per format, inactivity threshold.

**Account** (tab « Compte »), append-only ([lib/sales/exposure.ts](lib/sales/exposure.ts)):
- Debits come from BLs (or passages / statements for wholesalers); credits from payments.
- « Enregistrer un règlement »: amount, method, date (not in the future).
- « Signaler un incident »: bounced cheque (adds a debit due today) or dispute.
- « Annuler cette écriture »: mirror entry with a reason (permission `order.cancel`).
- Payments settle the oldest debits first; ageing: not due / 1–30 / 31–60 / 61–90 / > 90.

**Exposure** = receivables + confirmed-but-not-dispatched orders + consignment float (wholesalers).

**Solvency score** (« SmartScore™ », [lib/sales/solvency.ts](lib/sales/solvency.ts)), 0–100, four
weighted sub-scores (defaults 35/30/20/15): payment delay, share overdue, credit use, incidents.
≥ 70 Solvable, ≥ 45 À surveiller, else À justifier. A suggested limit is shown, never applied.

Other tabs: bottle balance (what the customer holds of ours, by format by default), orders.

### 3.2 Order (BC) lifecycle (`/ventes/commandes`, `/ventes/commandes/[id]`)

```
 BROUILLON ──confirm──► CONFIRMEE ──(first truck expedited)──► EXPEDIEE ──(all served, all delivered)──► LIVREE ──close──► CLOTUREE
     │                      │   └─ approval pending? (flag, not a status)
     └──────cancel──────────┴──► ANNULEE   (+ optional rectifying draft)
```
Rules in [lib/sales/lifecycle.ts](lib/sales/lifecycle.ts) `ORDER_FLOW`; commands in
[lib/sales/commands/orders.ts](lib/sales/commands/orders.ts).

**Step 1 — Draft** (fast entry `?nouveau=1&client=`, or the order sheet)
- Customer must be active, centre chosen, date ≥ today, a contract in force on that date.
- Lines are **priced from the contract's price list on the requested date**; the price is locked on the line.
- Number from the pattern `BC-{AAAA}{N:5}{CENTRE}` (counter per centre per year).
- Only a draft can be edited.

**Step 2 — Confirm.** Before confirming, the screen shows a live check (`checkOrder`):
1. at least one quantity; every line has a price;
2. **credit** (step `creditCheck`): exposure + this order vs limit, and lateness vs tolerance →
   ALLOW / WARN / APPROVAL / BLOCK per the category rule. BLOCK needs a **forced override** with a
   reason (permission `credit.override`);
3. **stock**: ATP per format = own fulls − reserved by other confirmed orders (step
   `reserveOnConfirm`) + average daily production × horizon (default 1 day). If short:
   policy « Reliquat » (default) confirms anyway and notes "reliquat prévu"; policy « Bloquer » refuses.
   Bulk is not checked against tanks;
4. **wholesaler**: refused if the escalation ladder is at « Bloquer » (too many days without a passage);
   above the float cap → needs approval.

On confirm, **approval is required** if any of: credit decision = APPROVAL, credit was forced,
amount > approval threshold (10 M by default, step `approval`), wholesaler over float cap.

**Step 3 — Approve** (if required): « Valider la commande », with an optional note
(permission `order.approve`). Until then no truck can pass the gate or load.

**Step 4 — Fill** (Production, §2.2) when the fill-confirmation step is on.

**Step 5 — Plan a truck** (« Planifier un camion »): plate, driver, date, time. The truck takes what
remains to serve (ordered − dispatched − reliquats − already planned). Several trucks per order are
possible. Number `BL-{AAAA}{N:5}{CENTRE}`. → continues in Stock (§4.1).

**Step 6 — Order status follows its trucks automatically** (`syncOrder`):
EXPEDIEE as soon as one truck has left; LIVREE when nothing remains and every truck is delivered.

**Reliquat** (« Déclarer un reliquat »): only once something has left and no truck is in progress;
the remainder is written off with a reason (stock, empties, truck capacity, credit, other). The
order can then become LIVREE.

**Close** (« Clôturer »): LIVREE → CLOTUREE; with the `accountingExport` step on, only once exported to Sage.

**Cancel / rectify** (permission `order.cancel` once confirmed):
- reason mandatory; impossible once CLOTUREE (correction then goes through a credit note in Sage);
- nothing through the gate yet → plain cancellation;
- trucks already past the gate → every bottle movement and account entry they produced is
  **reversed** with the reason; trucks stay on record;
- « rectifier » creates a new draft copying the order, linked both ways (`replaces` / `replacedBy`).

**Sage export** (`/ventes/commandes`): CSV of expedited sales lines and wholesaler sales over a
period; marks the orders as exported. Template columns are placeholders (Paramètres › Rapports).

### 3.3 Forecasts (`/ventes/previsions`)

1. Pick centre, granularity (week or month), view by customers or by categories.
2. Type in the grid or paste a spreadsheet block.
3. « Enregistrer » creates **a new version** (v1 « initiale », then « révision »); periods not in the
   grid keep the previous figures; refused if nothing changed (permission `forecast.edit`).
4. The page compares forecast vs **demand** (orders by requested date; for wholesalers, what they
   actually sold at passages): MAPE, bias, fill rate, OTIF, reliquats by reason.
5. **Fill plan vs line capacity** ([lib/sales/fill-plan.ts](lib/sales/fill-plan.ts)) per format:
   ```
   needed = forecast not yet ordered + recent reliquats − (fulls − reserved) + safety days × daily forecast
   ```
   bounded by own empties on hand + own empties expected back; tonnes vs capacity × useful hours.
   Flags: empties short, capacity > 100 %, load above the warning threshold, empties tight.

### 3.4 Wholesalers on consignment (`/ventes/grossistes`, wholesaler sheet, `/passage`)

A wholesaler's stock is **a site in the bottle ledger** (`client:<id>`): our fulls placed there are
valued (they count in exposure) but not billed until sold.

**How fulls get there:** a normal order for a wholesaler. At BL, the fulls move from the centre to
the wholesaler's site (`PLACEMENT`) instead of leaving as a sale. Wholesalers default to
« billing at sale », so the BL bills nothing.

**The passage (visit) is the settlement** ([lib/sales/consignment.ts](lib/sales/consignment.ts) `passage`).
Principle: a wholesaler cannot sell a full without taking back an empty, so **sold = empties returned,
whatever their brand.** Page `/ventes/grossistes/[id]/passage`, three steps:

1. **Vides rendues** — empties counted by brand × format. Competitor empties count as sales too.
   Refused if more empties than fulls held in a format.
2. **Pleins remis** — fulls handed over, defaults to what was sold (a one-for-one swap). Refused if the
   centre lacks the fulls. Above the float cap → only someone with `order.approve` may record it.
3. **Double confirmation** — two parties (commercial + wholesaler) with name and personal code.
   Then amount (sold × contract price on the settlement day, or on the placement day per setting)
   and cash received (pre-filled with the amount when payment is "at each passage").

Recorded effects (one passage, number `RG-…`):
```
EMPTIES_IN        centre: empties +n by brand        (reaches the authority report)
CONSIGNMENT_SALE  wholesaler site: fulls −sold
FULLS_OUT         centre fulls −given → wholesaler site +given (PLACEMENT)
BILL              debit = amount   (only if billing at sale AND invoiced per passage)
PAYMENT           credit = cash received (if any)
```
Refused on a closed day, without a contract in force, or with fewer than two confirmations.
Permission: `settlement.validate`.

**Periodic statement** (« Émettre un relevé », only for contracts invoiced « relevé périodique »):
one debit for every confirmed passage not yet billed.

**Float count** (tab « Comptages »): count of fulls at the wholesaler vs ledger. Within tolerance
(2 %) → settled at once and the ledger is adjusted; beyond → reason required and a manager decides
(§4.3). Expected every 30 days.

**Follow-up and escalation** ([lib/sales/alerts.ts](lib/sales/alerts.ts)):
- days since last passage vs threshold (contract › category › tenant, default 5 days);
- ladder 5 / 7 / 10 days: **Tâche** (call task for the rep) → **Notifier** (manager told) →
  **Bloquer** (no new placement orders until the next passage). The ladder shifts with a custom threshold;
- "late for them": beyond 1.5 × the wholesaler's own median rhythm, even under the threshold;
- days of stock left at the recent sell-out.

**Calls and declarations** (tab « Appels »): log a call (reached / unreachable / call back /
passage promised + date). A phone declaration of what was sold is a cross-check only, never billed.

### 3.5 Ventes dashboard (`/ventes`)

Read-only: bottles sold this week vs forecast pace, fill rate, OTIF, reliquats, forecast vs demand,
receivables ageing, wholesalers to call, today's trucks, fill plan.

---

## 4. Stock module

### 4.1 Truck / BL lifecycle (`/expeditions`, `/expeditions/[id]`)

```
 PLANIFIE ──gateIn──► EN_CHARGEMENT ──load──► CHARGE ──expedite (BL)──► EXPEDIE ──deliver──► LIVRE
                                                          └─ pick-up (ENLEVEMENT): straight to LIVRE
```
Rules in `DISPATCH_FLOW` ([lib/sales/lifecycle.ts](lib/sales/lifecycle.ts)); command
[lib/sales/commands/dispatch.ts](lib/sales/commands/dispatch.ts). The board (`/expeditions`) has one
column per stage; drag, keyboard or the card's button runs the same transition; skips and moves
back are refused with the reason.

**Step 1 — Camion** (PLANIFIE): plate, driver, slot editable.

**Step 2 — Vides reçues** (gate-in), « Valider les vides reçues »:
- empties brought by the customer, by **brand × format** (unknown brand allowed, never fillable),
  plus damaged/condemned ones; a dispute note can be kept;
- guards: order confirmed (or partly expedited) · approval given if required ·
  **two parties confirm** (magasinier + driver or customer) when the gate-inspection step is on (not for bulk);
- effect (always): `VIDES_ENTREE` movements at the centre (empties +, damaged +);
- after that the gate count is frozen.

**Step 3 — Chargement**, « Valider le chargement »:
- quantities loaded per format (can be lowered vs planned);
- guards: approval · something loaded · not above what remains · **bulk: weighbridge** tare and gross,
  net must equal the kg loaded · **bottles: filled by production** (fill-confirmation step) ·
  **cash customer: prepayment recorded** covering the load (prepayment step).

**Step 4 — BL numérique**, « Émettre le BL et expédier » (confirmation dialog):
- guard: the magasinier confirmed the loaded quantities;
- effects (always):
  - `PLEINS_SORTIE` own fulls − loaded (or `PLACEMENT` to the wholesaler's site);
  - **BILL** debit at the order's prices, due date from the contract term, when billing is « à l'expédition »;
- the BL PDF is generated ([lib/sales/bl-pdf.ts](lib/sales/bl-pdf.ts)), marked « Document interne : facturation dans Sage »;
- the dispatch is now **read-only**; any correction goes through cancelling the order;
- pick-up orders become LIVRE at once (« Enlevé par le client »).

**Step 5 — Livraison**, « Confirmer la livraison » (delivery mode): proof of delivery = the customer
confirms receipt (step `proofOfDelivery`). Allowed even after the day is closed.

No movement other than delivery is accepted on a closed day.

### 4.2 Stock et bouteilles (`/magasin`), tab « Stock »

Per centre, from the ledger: own fulls / own empties / competitor empties / condemned, by brand ×
format; ATP; competitor positions.

- **Ajustement**: one-off signed correction with a reason code (count gap, damage, brand requalified,
  typing error). Dated now.
- **Échange inter-marques**: give a competitor its empties back and receive ours (or partial). Two
  sets of `ECHANGE` movements so each competitor's net position stays visible.

Tab « Mouvements »: the ledger rows of the day / period.

### 4.3 Counts (tab « Comptage »)

1. Count a state (fulls, empties, condemned) at the centre, brand × format. Brands the ledger expects
   but you did not type count as zero.
2. Variance vs ledger (expected is frozen with the count). Within tolerance → **settled**, adjustments
   written at once. Beyond → reason required, status « À valider ».
3. A manager validates (ledger brought to the count, dated now) or rejects (recount needed).
   Permission `variance.approve`. Same flow for wholesaler float counts.

### 4.4 Day close (tab « Clôture »), authority report

1. The tab lists past working days (Mon–Sat) not closed; an alert appears in the bell.
2. « Clôturer la journée »: refused if a truck of that day is still EN_CHARGEMENT or CHARGE.
3. On close, the **authority report rows are frozen**: per brand × format, opening, in, out, closing,
   of which fulls / empties / condemned. Filling is internal (empty → full inside the site), so
   production is neither an entry nor an exit.
4. After close: no movement dated that day (gate, loading, BL, passage, adjustment, exchange, count).
5. Print view `/magasin/rapport?c=<centre>&jour=<date>` and CSV through the template (placeholder until
   the official format is entered). Permission `day.close` (Magasinier, Chef de production, Direction).

---

## 5. End-to-end walkthroughs

### A. Distributor, delivery, on credit
1. Ventes: new order, 400 × B12.5, delivery tomorrow → draft BC priced from the contract.
2. Ventes: confirm. Credit OK, stock OK → CONFIRMEE (no approval).
3. Production: Remplissage → confirm 400 filled.
4. Ventes: plan a truck → BL planned.
5. Stock: truck arrives, count its empties by brand, magasinier + driver confirm → EN_CHARGEMENT
   (empties enter the ledger).
6. Stock: load 400, confirm → CHARGE.
7. Stock: issue BL → EXPEDIE; fulls −400; customer debited, due in 30 days; order EXPEDIEE.
8. Stock: customer confirms receipt → LIVRE; order LIVREE.
9. Ventes: Sage export → order exported → « Clôturer » → CLOTUREE.
10. Ventes: payment recorded later → the debit is settled.
11. Stock: at day end, close the day → authority report frozen.

### B. Large order over the limit
Confirm → credit says APPROVAL (or BLOCK → forced with reason by a manager) → CONFIRMEE « en attente
de validation » → manager approves → the truck can now pass the gate.

### C. Cash station-service with prepayment
Cash contract → at loading, « Paiement attendu » until a payment covering the load is recorded on
the customer's account.

### D. Industrial bulk
Order in kg → no filling step → gate-in has no empties → loading needs tare + gross with net = kg →
BL → in Production, the « Sorties vrac » tab offers to take the day's weighbridge nets.

### E. Wholesaler cycle
Order → BL places fulls at the wholesaler's site (no bill) → days later, passage: empties returned
(any brand) = sold, fulls handed back, two confirmations, cash taken → bill + payment for the sold
part → if no passage for 5 / 7 / 10 days: call task, manager notified, placements blocked.

### F. Mistake after the BL
Cancel the order with a reason (manager) → movements and debit reversed → optionally « rectifier »
→ new draft linked to the old one.

---

## 6. Permissions (default matrix)

| Action | Who may |
|---|---|
| Force a credit overrun | Resp. commercial, Direction |
| Approve an order | Resp. commercial, Direction |
| Cancel / rectify a validated document, reverse an entry | Resp. commercial, Direction |
| Confirm filling | Chef de production, Direction |
| Close the warehouse day | Magasinier, Chef de production, Direction |
| Record a wholesaler passage | Commerciale, Resp. commercial, Magasinier |
| Approve a count variance | Resp. commercial, Direction |
| Edit forecasts | Commerciale, Resp. commercial, Direction |
| Edit prices | Comptable, Direction |

The admin account bypasses the matrix. Module access (which routes) is separate from permissions
(which actions): [lib/modules.ts](lib/modules.ts), [lib/settings-access.ts](lib/settings-access.ts).

## 7. Settings that change the processes (Paramètres)

| Section | Changes |
|---|---|
| Règles de calcul | Écart bands, lunch break, stop types |
| Réservoirs / correction | Tank profiles, out-of-table policy (block / warn), stock basis |
| Marques et bouteilles | Formats and weights, brands (one own), deposits |
| Clients et contrats | Categories, default terms, credit rules, price lists |
| Ventes et flux | The 9 optional steps / presets, approval threshold, numbering patterns, reliquat policy, ATP horizon, safety days |
| Consignation | Inactivity threshold, ladder, price basis, variance tolerance, count frequency, balance basis |
| Rapports | Authority report and Sage templates (placeholder flag) |
| Rôles | Permission matrix |

---

## 8. Points I noticed that may need a decision

These are observations from reading the code, not bugs I have verified in the browser.

1. **No way to start an inventory.** Today's inventory is generated by the demo seed; there is no
   "Nouvel inventaire" action, and `Stock initial` is not carried over from the previous day's
   physical stock by the app itself.
2. **Workflow version is recorded but not used.** Orders store `workflowVersion`, but trucks are
   checked against the *current* steps, so switching a step off in Paramètres affects orders
   already in progress.
3. **Bulk orders are not checked against tank stock** at confirmation (bottles only), as stated in the README.
4. **Trucks are recorded twice**: once as dispatches in Stock, again as counts in the inventory's
   Véhicules tab (Chargés COM / LIV). The README already proposes pre-filling that tab from the day's BLs.
5. **Passage centre** = the wholesaler's first centre (`centreIds[0]`); a wholesaler served by two
   centres always settles at the first.
6. **Delivery confirmation is allowed after day close** (by design, since it does not move stock),
   while every other step is refused.
7. **Filling has no ledger effect**: fulls come only from closed inventories, so a BC can be
   "rempli" before the inventory that produced the bottles is closed.
8. **Reliquat only after a partial shipment**: an order where nothing left must be cancelled, not
   written off.
