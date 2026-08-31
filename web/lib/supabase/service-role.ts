import { createClient } from "@supabase/supabase-js";

// Client privilégié (bypass RLS) réservé aux handlers server-to-server dont la
// confiance est établie autrement qu'une session utilisateur (ex : signature
// Stripe vérifiée). Ne JAMAIS importer ce module depuis un composant, une
// Server Action ou une route qui sert des requêtes utilisateur authentifiées
// — utiliser web/lib/supabase/server.ts pour ces cas-là.
export function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL est requis.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY est requis.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
