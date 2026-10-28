import type { BillingTrigger, CallOutcome, Decision, DeliveryMode, Invoicing, LadderAction, PaymentMethod, PaymentTerm, PaymentTrigger } from "./types";

/* French wording of the sales enums, in one place for every screen. */

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  ESPECES: "Espèces",
  VIREMENT: "Virement",
  CHEQUE: "Chèque",
  MOBILE_MONEY: "Mobile money",
  EFFET: "Effet de commerce",
};

export const BILLING: Record<BillingTrigger, string> = {
  A_L_EXPEDITION: "À l'expédition",
  A_LA_VENTE: "À la vente (consignation)",
};

export const PAYMENT_TRIGGER: Record<PaymentTrigger, string> = {
  A_CHAQUE_PASSAGE: "À chaque passage",
  PERIODIQUE: "Périodique",
  A_L_ECHEANCE: "À l'échéance",
};

export const INVOICING: Record<Invoicing, string> = {
  PAR_PASSAGE: "Facture à chaque passage",
  RELEVE_PERIODIQUE: "Relevé périodique",
};

export const DECISION: Record<Decision, string> = {
  ALLOW: "Autoriser",
  WARN: "Avertir",
  APPROVAL: "Validation du responsable",
  BLOCK: "Bloquer",
};

export const LADDER: Record<LadderAction, string> = {
  TACHE: "Tâche d'appel pour le commercial",
  NOTIFIER: "Prévenir le responsable",
  BLOQUER: "Bloquer les mises en consignation",
};

export const MODE: Record<DeliveryMode, string> = {
  ENLEVEMENT: "Enlèvement",
  LIVRAISON: "Livraison",
};

export const CALL_OUTCOME: Record<CallOutcome, string> = {
  JOINT: "Joint",
  INJOIGNABLE: "Injoignable",
  RAPPELER: "À rappeler",
  PASSAGE_PROMIS: "Passage promis",
};

export const termLabel = (t: PaymentTerm) => (t.kind === "COMPTANT" ? "Comptant" : `${t.days} jours`);
