"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { ArrowRight, TrendingUp, AlertTriangle, Clock, Zap, CheckCircle2, Download, LayoutGrid, List } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

type Alert = any;

export default function AlertsDashboard({ initialAlerts, activeTenantId }: { initialAlerts: Alert[], activeTenantId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [assetFilter, setAssetFilter] = useState("");
  const [venueFilter, setVenueFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"open" | "treated">("open");
  const [mounted, setMounted] = useState(false);
  const supabase = createSupabaseBrowserClient();

  useEffect(() => {
    setMounted(true);
    // Realtime subscription on tenant_alert_access for current tenant
    const channel = supabase
      .channel('dashboard-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tenant_alert_access', filter: `tenant_id=eq.${activeTenantId}` },
        async (payload) => {
          // Fetch full alert details when a new access row is granted
          const alertId = payload.new.alert_id;
          const { data, error } = await supabase
            .from("market_alerts")
            .select(`
              *,
              assets (symbol),
              tenant_alert_access!inner(read_at, tenant_id)
            `)
            .eq("id", alertId)
            .eq("tenant_alert_access.tenant_id", activeTenantId)
            .single();

          if (data && !error) {
            setAlerts((prev) => {
              // Avoid duplicates
              if (prev.find(a => a.id === data.id)) return prev;
              return [data, ...prev];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tenant_alert_access', filter: `tenant_id=eq.${activeTenantId}` },
        (payload) => {
          setAlerts((prev) => prev.map(a => 
            a.id === payload.new.alert_id 
              ? { ...a, tenant_alert_access: [{ ...a.tenant_alert_access[0], read_at: payload.new.read_at }] } 
              : a
          ));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, activeTenantId]);

  const markAsRead = async (alertId: string) => {
    // Optimistic UI update
    const now = new Date().toISOString();
    setAlerts((prev) => prev.map(a => 
      a.id === alertId 
        ? { ...a, tenant_alert_access: [{ ...a.tenant_alert_access[0], read_at: now }] } 
        : a
    ));

    await supabase
      .from("tenant_alert_access")
      .update({ read_at: now })
      .eq("alert_id", alertId)
      .eq("tenant_id", activeTenantId);
  };

  const filteredAlerts = alerts.filter(a => {
    const isTreated = a.tenant_alert_access?.[0]?.read_at !== null;
    if (statusFilter === "open" && isTreated) return false;
    if (statusFilter === "treated" && !isTreated) return false;

    const symbol = a.assets?.symbol?.toLowerCase() || "";
    if (assetFilter && !symbol.includes(assetFilter.toLowerCase())) return false;

    const buyVenue = a.payload?.buy_venue?.toLowerCase() || "";
    const sellVenue = a.payload?.sell_venue?.toLowerCase() || "";
    if (venueFilter && !buyVenue.includes(venueFilter.toLowerCase()) && !sellVenue.includes(venueFilter.toLowerCase())) return false;

    return true;
  }).sort((a, b) => {
    return parseFloat(b.confidence_score) - parseFloat(a.confidence_score);
  });

  const exportCSV = () => {
    if (filteredAlerts.length === 0) return;

    const headers = [
      "Date/Heure", "Paire", "Achat", "Prix Achat", "Vente", "Prix Vente", "Marge Brute (bps)", "Marge Nette (%)"
    ];

    const rows = filteredAlerts.map(a => [
      a.observed_at,
      a.assets?.symbol || a.headline,
      a.payload?.buy_venue,
      a.buy_price,
      a.payload?.sell_venue,
      a.sell_price,
      a.gross_edge_bps,
      (parseFloat(a.net_edge_pct) * 100).toFixed(2)
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `arbitrage-alerts-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      {/* Barre d'outils et filtres */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <Input 
            placeholder="Filtrer par paire (ex: BTC-USD)..." 
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            className="w-full sm:max-w-xs"
          />
          <Input 
            placeholder="Filtrer par exchange..." 
            value={venueFilter}
            onChange={(e) => setVenueFilter(e.target.value)}
            className="w-full sm:max-w-xs"
          />
          <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Non traité</SelectItem>
              <SelectItem value="treated">Traité</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" className="px-3 py-1.5 text-sm" onClick={exportCSV} disabled={filteredAlerts.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <div className="flex border border-gray-200 rounded-md overflow-hidden bg-white">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 text-gray-600 hover:bg-gray-50 transition-colors ${viewMode === 'grid' ? 'bg-gray-100 text-gray-900 shadow-inner' : ''}`}
              title="Vue Grille"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-2 text-gray-600 hover:bg-gray-50 transition-colors border-l border-gray-200 ${viewMode === 'table' ? 'bg-gray-100 text-gray-900 shadow-inner' : ''}`}
              title="Vue Tableau"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center shadow-sm">
          <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900">Aucune alerte trouvée</h3>
          <p className="text-gray-500 mt-2">Aucune opportunité ne correspond à vos filtres actuels.</p>
        </div>
      ) : (
        viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredAlerts.map((alert) => {
              const payload = alert.payload as any;
              const netEdgePct = parseFloat(alert.net_edge_pct);
              const confidence = parseFloat(alert.confidence_score);
              const isHighConfidence = confidence > 75;
              const symbol = alert.assets?.symbol || alert.headline.split(' ')[0];

              return (
                <Card key={alert.id} className="hover:shadow-md transition-shadow duration-200 flex flex-col h-full relative group">
                  <CardHeader className="pb-4">
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-lg text-gray-900">
                        {symbol}
                      </CardTitle>
                      <Badge variant={isHighConfidence ? "default" : "secondary"} className={isHighConfidence ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-blue-100 text-blue-800 hover:bg-blue-100"}>
                        Score: {confidence.toFixed(0)}/100
                      </Badge>
                    </div>
                    <CardDescription className="flex items-center gap-1 mt-1">
                      <Clock className="h-3.5 w-3.5" />
                      {mounted ? format(new Date(alert.observed_at + (alert.observed_at.includes('Z') || alert.observed_at.includes('+') ? '' : 'Z')), 'dd/MM HH:mm:ss') : '...'}
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="flex-1 flex flex-col">
                    <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100">
                      <div className="text-center w-1/3">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Achat</div>
                        <div className="font-semibold text-gray-900 capitalize truncate" title={payload.buy_venue?.replace('_', ' ')}>{payload.buy_venue?.replace('_', ' ')}</div>
                        <div className="text-sm text-gray-600">${parseFloat(alert.buy_price).toFixed(4)}</div>
                      </div>
                      
                      <div className="flex flex-col items-center px-2">
                        <ArrowRight className="h-5 w-5 text-gray-400" />
                      </div>

                      <div className="text-center w-1/3">
                        <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Vente</div>
                        <div className="font-semibold text-gray-900 capitalize truncate" title={payload.sell_venue?.replace('_', ' ')}>{payload.sell_venue?.replace('_', ' ')}</div>
                        <div className="text-sm text-gray-600">${parseFloat(alert.sell_price).toFixed(4)}</div>
                      </div>
                    </div>

                    <div className="mt-auto space-y-3">
                      <div className="flex justify-between items-center text-sm border-b border-gray-100 pb-2">
                        <span className="text-gray-500">Marge brute</span>
                        <span className="font-medium text-gray-900">{parseFloat(alert.gross_edge_bps).toFixed(1)} bps</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mb-4">
                        <span className="text-gray-500">Marge nette (après frais)</span>
                        <span className="font-bold text-emerald-600 text-base">{(netEdgePct * 100).toFixed(2)} %</span>
                      </div>
                      
                      {statusFilter === "open" && (
                        <Button 
                          variant="outline" 
                          className="w-full mt-2" 
                          onClick={() => markAsRead(alert.id)}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-500" />
                          Marquer comme lu
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Heure</TableHead>
                  <TableHead>Paire</TableHead>
                  <TableHead>Achat</TableHead>
                  <TableHead>Vente</TableHead>
                  <TableHead className="text-right">Marge Brute</TableHead>
                  <TableHead className="text-right">Marge Nette</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAlerts.map((alert) => {
                  const payload = alert.payload as any;
                  const netEdgePct = parseFloat(alert.net_edge_pct);
                  const confidence = parseFloat(alert.confidence_score);
                  const symbol = alert.assets?.symbol || alert.headline.split(' ')[0];

                  return (
                    <TableRow key={alert.id}>
                      <TableCell className="text-sm text-gray-500 whitespace-nowrap">
                        {mounted ? format(new Date(alert.observed_at + (alert.observed_at.includes('Z') || alert.observed_at.includes('+') ? '' : 'Z')), 'dd/MM HH:mm:ss') : '...'}
                      </TableCell>
                      <TableCell className="font-medium text-gray-900 whitespace-nowrap">
                        {symbol}
                      </TableCell>
                      <TableCell>
                        <div className="capitalize text-gray-900 text-sm">{payload.buy_venue?.replace('_', ' ')}</div>
                        <div className="text-xs text-gray-500">${parseFloat(alert.buy_price).toFixed(4)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="capitalize text-gray-900 text-sm">{payload.sell_venue?.replace('_', ' ')}</div>
                        <div className="text-xs text-gray-500">${parseFloat(alert.sell_price).toFixed(4)}</div>
                      </TableCell>
                      <TableCell className="text-right text-gray-900 text-sm">
                        {parseFloat(alert.gross_edge_bps).toFixed(1)} bps
                      </TableCell>
                      <TableCell className="text-right font-bold text-emerald-600 text-sm">
                        {(netEdgePct * 100).toFixed(2)} %
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-xs">
                          {confidence.toFixed(0)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {statusFilter === "open" ? (
                          <Button 
                            variant="ghost" 
                            className="h-8 px-2"
                            onClick={() => markAsRead(alert.id)}
                            title="Marquer comme lu"
                          >
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          </Button>
                        ) : (
                          <span className="text-xs text-gray-400">Traité</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </div>
  );
}