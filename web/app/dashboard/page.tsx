import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LogOut, TrendingUp, ShieldAlert, Zap } from "lucide-react";
import AlertsDashboard from "@/components/AlertsDashboard";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  // 1. Récupérer le tenant actif de l'utilisateur
  const { data: appUser } = await supabase
    .from("app_users")
    .select("default_tenant_id")
    .eq("user_id", user.id)
    .single();

  const activeTenantId = appUser?.default_tenant_id;

  if (!activeTenantId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-sm text-center max-w-md w-full">
          <ShieldAlert className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Accès refusé</h2>
          <p className="text-gray-600 mb-6">Votre compte n'est rattaché à aucun espace de travail (tenant). Veuillez contacter le support.</p>
          <form action="/auth/actions" method="post">
            <button formAction={async () => {
              "use server";
              const supabase = await createSupabaseServerClient();
              await supabase.auth.signOut();
              redirect("/auth");
            }} className="px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors w-full">
              Se déconnecter
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. Récupérer les alertes via la jointure INNER stricte (garantie par la RLS)
  // On inclut les symboles d'assets pour le filtrage et l'export
  const { data: alerts, error } = await supabase
    .from("market_alerts")
    .select(`
      *,
      assets (symbol),
      tenant_alert_access!inner(read_at, tenant_id)
    `)
    .eq("tenant_alert_access.tenant_id", activeTenantId)
    .order("observed_at", { ascending: false })
    .limit(50);

  return (
    <div className="min-h-screen bg-gray-50/50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-indigo-900">
              Arbitrage Radar
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline-block">
              {user.email}
            </span>
            <form action="/auth/actions" method="post">
              <button
                formAction={async () => {
                  "use server";
                  const supabase = await createSupabaseServerClient();
                  await supabase.auth.signOut();
                  redirect("/auth");
                }}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Déconnexion
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Zap className="h-6 w-6 text-indigo-500" />
            Opportunités en temps réel
          </h1>
          <p className="text-gray-500 mt-1">
            Détection algorithmique d'écarts de prix inter-exchanges.
          </p>
        </div>

        <AlertsDashboard initialAlerts={alerts || []} activeTenantId={activeTenantId} />
      </main>
    </div>
  );
}