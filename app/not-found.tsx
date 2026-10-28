import type { Metadata } from "next";
import { ArrowLeft } from "@/components/ui/icons";
import { ButtonLink } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Page introuvable · Smart GPL" };

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="text-[64px] font-semibold leading-none tracking-[-0.04em] text-brand-ink sm:text-[88px]">404</p>
        <h1 className="mt-4 text-[22px] font-medium tracking-[-0.01em] sm:text-[26px]">Page introuvable</h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-muted">
          L&apos;adresse demandée n&apos;existe pas ou a été déplacée.
        </p>
        <ButtonLink href="/" className="mt-6">
          <ArrowLeft className="size-4" />
          Retour au tableau de bord
        </ButtonLink>
      </div>
    </div>
  );
}
