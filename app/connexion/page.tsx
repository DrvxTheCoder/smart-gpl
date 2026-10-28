"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChevronRight } from "@/components/ui/icons";
import { Button, Field, inputCls } from "@/components/ui/primitives";
import { Logo, PRODUCT } from "@/components/shell/app-shell";
import { ACCOUNTS, DEMO_PASSWORD, useAuth, type Account } from "@/lib/auth";
import { canOpen, moduleDef } from "@/lib/modules";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/format";

/** Where to land after signing in: the page asked for if allowed, else the first module's home. */
const landing = (a: Account, next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") && canOpen(a.modules, next) ? next : moduleDef(a.modules[0]).home);

function Inner() {
  const { account, login } = useAuth();
  const { config } = useStore();
  const router = useRouter();
  const next = useSearchParams().get("suite");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account) router.replace(landing(account, next));
  }, [account, next, router]);

  const submit = (e: string, p: string) => {
    const err = login(e, p);
    setError(err);
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="w-full max-w-[920px]">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-11 place-items-center text-brand-ink">
            <Logo className="size-10" />
          </span>
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">{PRODUCT}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="rounded-card bg-card p-6 sm:p-8">
            <h1 className="text-[30px] font-semibold tracking-[-0.03em]">Connexion</h1>
            <p className="mt-1 text-[15px] text-muted">{config.branding.companyName}</p>
            <form
              className="mt-6 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit(email, password);
              }}
            >
              <Field label="Adresse e-mail">
                <input className={cn(inputCls, "h-11")} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Mot de passe">
                <input className={cn(inputCls, "h-11")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && (
                <p role="alert" className="rounded-2xl border border-alert/40 bg-alert/6 p-3 text-[14px] text-alert">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={!email || !password}>
                Se connecter
              </Button>
            </form>
            <p className="mt-6 text-[12px] text-faint">Prototype : connexion simulée sur cet appareil, rien n&apos;est envoyé à un serveur.</p>
          </section>

          <section className="rounded-card bg-board p-6 sm:p-8">
            <h2 className="text-[17px] font-medium tracking-[-0.01em]">Comptes de démonstration</h2>
            <p className="mt-1 text-[13px] text-muted">Un responsable par module, et l&apos;administrateur. Mot de passe&nbsp;: «&nbsp;{DEMO_PASSWORD}&nbsp;».</p>
            <ul className="mt-4 space-y-2">
              {ACCOUNTS.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO_PASSWORD);
                      submit(a.email, DEMO_PASSWORD);
                    }}
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-card p-3 text-left transition-colors hover:bg-brand-50"
                  >
                    <span className={cn("grid size-11 shrink-0 place-items-center rounded-full text-[14px] font-semibold", a.admin ? "bg-brand-800 text-white" : "bg-brand-100 text-brand-ink")}>
                      {a.name
                        .split(" ")
                        .map((p) => p[0])
                        .join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{a.title}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {a.name} · {a.admin ? "tous les modules et paramètres" : `module ${moduleDef(a.modules[0]).label}`}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function ConnexionPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
