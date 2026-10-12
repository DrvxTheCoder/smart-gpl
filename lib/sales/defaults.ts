import type { Action, ContractTerms, CustomerCategory, SalesConfig, WorkflowConfig, WorkflowStep } from "./types";

/* Sales defaults for a new tenant. Brands, prices and people are fictional;
   report templates are placeholders until the real specifications arrive. */

const terms = (patch: Partial<ContractTerms>): ContractTerms => ({
  payment: { kind: "DIFFERE", days: 30 },
  methods: ["VIREMENT", "CHEQUE"],
  creditLimit: 10_000_000,
  guarantees: 0,
  priceListId: "pl-std",
  billing: "A_L_EXPEDITION",
  paymentTrigger: "A_L_ECHEANCE",
  invoicing: "PAR_PASSAGE",
  floatCap: {},
  inactivityDays: null,
  ...patch,
});

export const DEFAULT_CATEGORIES: CustomerCategory[] = [
  {
    id: "distributeur",
    label: "Distributeur",
    kind: "STANDARD",
    defaults: terms({ creditLimit: 15_000_000 }),
    credit: { onLimit: "APPROVAL", overdueDays: 15, onOverdue: "APPROVAL" },
    inactivityDays: null,
  },
  {
    id: "station",
    label: "Station-service",
    kind: "STANDARD",
    defaults: terms({ creditLimit: 4_000_000, methods: ["VIREMENT", "CHEQUE", "MOBILE_MONEY"] }),
    credit: { onLimit: "WARN", overdueDays: 10, onOverdue: "APPROVAL" },
    inactivityDays: null,
  },
  {
    id: "industriel",
    label: "Industriel",
    kind: "STANDARD",
    defaults: terms({ payment: { kind: "DIFFERE", days: 60 }, creditLimit: 30_000_000, priceListId: "pl-ind", methods: ["VIREMENT", "EFFET"] }),
    credit: { onLimit: "APPROVAL", overdueDays: 30, onOverdue: "BLOCK" },
    inactivityDays: null,
  },
  {
    id: "grossiste",
    label: "Grossiste (consignation)",
    kind: "GROSSISTE",
    defaults: terms({
      payment: { kind: "COMPTANT", days: 0 },
      methods: ["ESPECES", "MOBILE_MONEY"],
      creditLimit: 3_000_000,
      priceListId: "pl-gros",
      billing: "A_LA_VENTE",
      paymentTrigger: "A_CHAQUE_PASSAGE",
      floatCap: { b27: 300, b6: 500, b125: 600 },
    }),
    credit: { onLimit: "APPROVAL", overdueDays: 0, onOverdue: "BLOCK" },
    inactivityDays: null,
  },
];

export const WORKFLOW_STEPS: { id: WorkflowStep; label: string; sub: string }[] = [
  { id: "creditCheck", label: "Contrôle du crédit", sub: "Encours et retards vérifiés à la confirmation de la commande." },
  { id: "prepayment", label: "Paiement avant chargement", sub: "Clients au comptant : le camion ne charge qu'une fois le règlement enregistré." },
  { id: "approval", label: "Validation du responsable", sub: "Au-delà d'un montant, une commande attend la validation d'un responsable." },
  { id: "reserveOnConfirm", label: "Réservation à la confirmation", sub: "Les pleins d'une commande confirmée ne sont plus disponibles à la vente." },
  { id: "gateInspection", label: "Contrôle des vides à l'entrée", sub: "Comptage des vides par marque, confirmé par le magasinier et le chauffeur." },
  { id: "weighbridge", label: "Pont-bascule (vrac)", sub: "Pesées à vide et en charge obligatoires pour expédier du vrac." },
  { id: "proofOfDelivery", label: "Preuve de livraison", sub: "La livraison est confirmée par le client à réception." },
  { id: "accountingExport", label: "Export comptable", sub: "Une commande se clôture une fois exportée vers Sage." },
];

const ALL_ON = Object.fromEntries(WORKFLOW_STEPS.map((s) => [s.id, true])) as Record<WorkflowStep, boolean>;

export const PRESETS: { id: "simple" | "complet"; label: string; sub: string; steps: Record<WorkflowStep, boolean> }[] = [
  {
    id: "simple",
    label: "Dépôt simple",
    sub: "Contrôle du crédit seulement. Pour un dépôt qui vend surtout au comptant.",
    steps: { ...Object.fromEntries(WORKFLOW_STEPS.map((s) => [s.id, false])), creditCheck: true } as Record<WorkflowStep, boolean>,
  },
  {
    id: "complet",
    label: "Usine complète",
    sub: "Toutes les étapes : validation, contrôle des vides, pesées, preuve de livraison, export.",
    steps: ALL_ON,
  },
];

export const DEFAULT_WORKFLOW: WorkflowConfig = {
  version: 1,
  steps: ALL_ON,
  approvalThreshold: 10_000_000,
  numbering: { order: "BC-{CENTRE}-{AAAA}-{N:5}", dispatch: "BL-{CENTRE}-{AAAA}-{N:5}", settlement: "RG-{CENTRE}-{AAAA}-{N:5}" },
};

export const ACTIONS: { id: Action; label: string }[] = [
  { id: "credit.override", label: "Forcer un dépassement de crédit" },
  { id: "order.approve", label: "Valider une commande" },
  { id: "order.cancel", label: "Annuler ou rectifier un document validé" },
  { id: "day.close", label: "Clôturer la journée du magasin" },
  { id: "settlement.validate", label: "Enregistrer un passage grossiste" },
  { id: "variance.approve", label: "Valider un écart de comptage" },
  { id: "forecast.edit", label: "Saisir les prévisions" },
  { id: "price.edit", label: "Modifier les tarifs" },
];

export const DEFAULT_SALES: SalesConfig = {
  currency: { code: "XOF", label: "F CFA" },
  brands: [
    { id: "baobab", name: "Baobab Gaz", own: true, deposit: { b27: 4_000, b6: 8_000, b9: 10_000, b125: 12_500, b38: 35_000 } },
    { id: "sahel", name: "Sahel Gaz", own: false, deposit: { b27: 4_000, b6: 7_500, b9: 10_000, b125: 12_000, b38: 35_000 } },
    { id: "teranga", name: "Teranga Gaz", own: false, deposit: { b27: 3_500, b6: 7_500, b9: 9_500, b125: 12_000, b38: 33_000 } },
    { id: "delta", name: "Delta Butane", own: false, deposit: { b27: 3_500, b6: 7_000, b9: 9_500, b125: 11_500, b38: 33_000 } },
  ],
  categories: DEFAULT_CATEGORIES,
  priceLists: [
    {
      id: "pl-std",
      label: "Tarif distributeurs",
      lines: [
        { formatId: "b27", from: "2025-01-01", price: 1_300 },
        { formatId: "b6", from: "2025-01-01", price: 2_900 },
        { formatId: "b9", from: "2025-01-01", price: 4_350 },
        { formatId: "b125", from: "2025-01-01", price: 5_900 },
        { formatId: "b125", from: "2026-09-01", price: 6_050 },
        { formatId: "b38", from: "2025-01-01", price: 18_900 },
      ],
    },
    {
      id: "pl-gros",
      label: "Tarif grossistes",
      lines: [
        { formatId: "b27", from: "2025-01-01", price: 1_250 },
        { formatId: "b6", from: "2025-01-01", price: 2_800 },
        { formatId: "b9", from: "2025-01-01", price: 4_200 },
        { formatId: "b125", from: "2025-01-01", price: 5_750 },
        { formatId: "b125", from: "2026-09-01", price: 5_900 },
        { formatId: "b38", from: "2025-01-01", price: 18_400 },
      ],
    },
    {
      id: "pl-ind",
      label: "Tarif industriels",
      lines: [
        { formatId: "b125", from: "2025-01-01", price: 5_800 },
        { formatId: "b38", from: "2025-01-01", price: 18_200 },
        { formatId: "vrac", from: "2025-01-01", price: 470 },
        { formatId: "vrac", from: "2026-09-01", price: 485 },
      ],
    },
  ],
  workflow: DEFAULT_WORKFLOW,
  solvency: { weights: { delay: 35, overdue: 30, utilization: 20, incidents: 15 }, okFrom: 70, warnFrom: 45, lookbackDays: 90 },
  consignment: {
    inactivityDays: 5,
    ladder: [
      { day: 5, action: "TACHE" },
      { day: 7, action: "NOTIFIER" },
      { day: 10, action: "BLOQUER" },
    ],
    priceBasis: "SETTLEMENT",
    varianceTolerancePct: 2,
    countEveryDays: 30,
    balanceBasis: "FORMAT",
  },
  stock: { backorder: "RELIQUAT", safetyDays: 2, atpHorizonDays: 1 },
  targets: { fillRate: [98, 95], otif: [95, 90], mape: [15, 30], capacityWarnPct: 85 },
  reasons: {
    variance: [
      { code: "PERTE", label: "Perte" },
      { code: "VOL", label: "Vol" },
      { code: "NON_RENDU", label: "Bouteilles non rendues" },
      { code: "ERREUR_SAISIE", label: "Erreur de saisie" },
      { code: "AUTRE", label: "Autre" },
    ],
    reliquat: [
      { code: "STOCK", label: "Stock insuffisant" },
      { code: "VIDES", label: "Vides insuffisants" },
      { code: "CAMION", label: "Capacité du camion" },
      { code: "CREDIT", label: "Crédit" },
      { code: "AUTRE", label: "Autre" },
    ],
    adjustment: [
      { code: "COMPTAGE", label: "Écart de comptage" },
      { code: "CASSE", label: "Casse constatée" },
      { code: "REQUALIFICATION", label: "Marque requalifiée" },
      { code: "ERREUR_SAISIE", label: "Erreur de saisie" },
    ],
  },
  reports: {
    authority: {
      placeholder: true,
      title: "État journalier des bouteilles par marque",
      header: "Modèle provisoire : à remplacer par le format exigé par l'autorité.",
      filename: "etat-bouteilles-{CENTRE}-{DATE}.csv",
      columns: ["marque", "format", "ouverture", "entrees", "sorties", "cloture", "pleins", "vides", "casse"],
      separator: ";",
    },
    sage: {
      placeholder: true,
      title: "Export des ventes vers Sage",
      header: "Colonnes provisoires : à aligner sur l'import Sage Gestion Commerciale du client.",
      filename: "ventes-sage-{CENTRE}-{DATE}.csv",
      columns: ["date", "piece", "bl", "client_code", "client", "article", "quantite", "prix_unitaire", "montant", "centre"],
      separator: ";",
    },
  },
  roles: [
    { id: "production", label: "Chef de production", person: "Awa Ndiaye" },
    { id: "commercial", label: "Commerciale", person: "Fatou Diop" },
    { id: "resp_commercial", label: "Responsable commercial", person: "Cheikh Mbaye" },
    { id: "magasinier", label: "Magasinier", person: "Ousmane Ba" },
    { id: "comptable", label: "Comptable", person: "Mariama Sow" },
    { id: "direction", label: "Direction", person: "Aliou Kane" },
  ],
  permissions: {
    "credit.override": ["resp_commercial", "direction"],
    "order.approve": ["resp_commercial", "direction"],
    "order.cancel": ["resp_commercial", "direction"],
    "day.close": ["magasinier", "production", "direction"],
    "settlement.validate": ["commercial", "resp_commercial", "magasinier"],
    "variance.approve": ["resp_commercial", "direction"],
    "forecast.edit": ["commercial", "resp_commercial", "direction"],
    "price.edit": ["comptable", "direction"],
  },
  openingStock: {},
};
