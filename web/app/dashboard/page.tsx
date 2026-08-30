import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, TrendingUp, AlertTriangle, Clock, Zap } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect("/auth");
  }

  // Récupération des informations de membership
  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  // Les alertes doivent être récupérées via RLS de manière standard.
  // Pour l'instant, si le tenant_alert_access n'est pas rempli, cela renverra une liste vide.
  const { data: alerts } = await supabase
    .from("market_alerts")
    .select("*")
    .eq("status", "open")
    .order("confidence_score", { ascending: false })
    .limit(12);

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header / Navbar */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Arbitrage Radar</h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="hidden md:block text-gray-500">
            <span className="font-medium text-gray-700">{user.email}</span>
            {membership?.role && <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">{membership.role}</span>}
          </div>
          {/* Un simple lien ou bouton pour se déconnecter pourrait aller ici plus tard */}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8">
        
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-emerald-500" />
              Opportunités en temps réel
            </h2>
            <p className="text-gray-500 mt-1">
              Les meilleures opportunités d'arbitrage cross-exchange scannées récemment.
            </p>
          </div>
        </div>

        {(!alerts || alerts.length === 0) ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center shadow-sm">
            <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">Aucune alerte trouvée</h3>
            <p className="text-gray-500 mt-2">Le moteur de scan n'a remonté aucune opportunité ouverte pour le moment.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {alerts.map((alert) => {
              const payload = alert.payload as any;
              const netEdgePct = parseFloat(alert.net_edge_pct);
              const confidence = parseFloat(alert.confidence_score);
              const isHighConfidence = confidence > 75;

              return (
                <Card key={alert.id} className="hover:shadow-md transition-shadow duration-200 flex flex-col h-full">
                  <CardHeader className="pb-4">
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-lg text-gray-900">
                        {alert.headline.split(' ')[0]} {/* Affiche ex: "ARB-USD" */}
                      </CardTitle>
                      <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                        isHighConfidence ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        Score: {confidence.toFixed(0)}/100
                      </span>
                    </div>
                    <CardDescription className="flex items-center gap-1 mt-1">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(alert.observed_at).toLocaleTimeString()}
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100">
                      <div className="text-center">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Achat</div>
                        <div className="font-semibold text-gray-900 capitalize">{payload.buy_venue?.replace('_', ' ')}</div>
                        <div className="text-sm text-gray-600">${parseFloat(alert.buy_price).toFixed(4)}</div>
                      </div>
                      
                      <div className="flex flex-col items-center px-2">
                        <ArrowRight className="h-5 w-5 text-gray-400" />
                      </div>

                      <div className="text-center">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Vente</div>
                        <div className="font-semibold text-gray-900 capitalize">{payload.sell_venue?.replace('_', ' ')}</div>
                        <div className="text-sm text-gray-600">${parseFloat(alert.sell_price).toFixed(4)}</div>
                      </div>
                    </div>

                    <div className="mt-auto space-y-3">
                      <div className="flex justify-between items-center text-sm border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Marge brute</span>
                        <span className="font-medium text-gray-900">{parseFloat(alert.gross_edge_bps).toFixed(1)} bps</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">Marge nette (après frais)</span>
                        <span className="font-bold text-emerald-600 text-base">{(netEdgePct * 100).toFixed(2)} %</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
