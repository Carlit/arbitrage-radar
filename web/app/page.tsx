import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { signOutAction } from "./auth/actions";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center px-6 py-16">
      <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <span className="inline-flex rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            Frontend foundation
          </span>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
              Base Next.js 15 initialisée pour le MVP Arbitrage Radar
            </h1>
            <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
              Le socle front est prêt avec App Router, TypeScript, Tailwind CSS 4, configuration SSR
              Supabase et un premier flux d&apos;authentification.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/auth"
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Ouvrir la page d&apos;authentification
            </Link>
            <Link
              href="https://supabase.com/docs/guides/auth/server-side/nextjs"
              target="_blank"
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
            >
              Documentation Supabase SSR
            </Link>
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>État de session</CardTitle>
            <CardDescription>
              Cette carte confirme que le client Supabase SSR est bien branché dans l&apos;application.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {session ? (
              <>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Utilisateur connecté</p>
                  <p className="mt-1 font-medium text-zinc-950 dark:text-zinc-50">{session.user.email}</p>
                </div>
                <form action={signOutAction}>
                  <Button type="submit" variant="outline">
                    Se déconnecter
                  </Button>
                </form>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                Aucune session active. Utilisez la page `Sign In / Sign Up` pour tester Supabase Auth.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
