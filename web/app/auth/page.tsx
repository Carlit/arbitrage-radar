import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { signInAction, signUpAction } from "./actions";

type AuthPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getMessage(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const params = await searchParams;
  const error = getMessage(params.error);
  const success = getMessage(params.success);

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center px-6 py-16">
      <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-center gap-6">
          <span className="inline-flex w-fit rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            Arbitrage Radar
          </span>
          <div className="space-y-4">
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
              Authentification Supabase SSR pour le futur front multi-tenant
            </h1>
            <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
              Cette page constitue la première brique du frontend Next.js 15. Elle permet de créer un compte
              ou de se connecter via Supabase Auth, avec conservation de session côté serveur grâce au setup
              SSR.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <p>Stack active : `Next.js 15`, `React 19`, `TypeScript`, `Tailwind CSS 4`, `shadcn/ui`.</p>
            <p>Pas encore de dashboard ni de pricing dans cette phase.</p>
            <Link className="text-zinc-950 underline underline-offset-4 dark:text-zinc-50" href="/">
              Revenir à l'accueil technique
            </Link>
          </div>
        </section>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Sign In / Sign Up</CardTitle>
            <CardDescription>
              Utilisez votre e-mail et votre mot de passe. La session sera réhydratée côté serveur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-300">
                {success}
              </div>
            ) : null}

            <form className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" placeholder="team@arbitrage-radar.io" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Mot de passe</Label>
                <Input id="password" name="password" type="password" placeholder="••••••••" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button formAction={signInAction} type="submit">
                  Se connecter
                </Button>
                <Button formAction={signUpAction} type="submit" variant="outline">
                  Créer un compte
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
