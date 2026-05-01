"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, AlertTriangle } from "lucide-react";
import { formatNumber } from "@/lib/utils/formula";

interface SnapshotRow {
  subcategory_id: string;
  subcategory_code: string;
  subcategory_name: string;
  budgeted_usd: number;
  ordered_before_usd: number;
  decision_amount_usd: number;
  available_before_usd: number;
  available_after_usd: number;
  exchange_rate: number | null;
  local_currency: string | null;
  decided_at: string;
}

/**
 * Panel que muestra el snapshot del presupuesto al momento de una decisión.
 * Si la decisión es vieja (anterior al sistema de snapshots) muestra un aviso
 * explicativo en lugar de números actuales (que serían engañosos).
 */
export function BudgetSnapshotPanel({
  decisionType,
  refId,
}: {
  decisionType: "oc" | "award";
  refId: string;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_decision_budget_snapshot", {
        p_decision_type: decisionType,
        p_decision_ref_id: refId,
      });
      if (cancelled) return;
      if (error) {
        console.error("[snapshot] error", error);
        setRows([]);
      } else {
        setRows((data as SnapshotRow[] | null) ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [decisionType, refId, supabase]);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground inline-flex items-center gap-2 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando estado del presupuesto al momento…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic flex items-start gap-2 px-3 py-2 rounded-md border bg-neutral-50">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
        <span>
          No hay snapshot del presupuesto guardado para esta decisión. Es probable
          que se haya tomado antes de que el sistema empezara a registrar
          el estado al momento de cada autorización.
        </span>
      </div>
    );
  }

  const localCur = rows[0]?.local_currency ?? "LOCAL";
  const fx = Number(rows[0]?.exchange_rate ?? 0);

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground italic">
        Datos capturados al momento de la decisión.
        {fx > 0 && (
          <> TC del proyecto en ese momento: 1 USD = {formatNumber(fx, 0)} {localCur}.</>
        )}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.map((s) => {
          const budget   = Number(s.budgeted_usd);
          const before   = Number(s.ordered_before_usd);
          const decision = Number(s.decision_amount_usd);
          const availBefore = Number(s.available_before_usd);
          const availAfter  = Number(s.available_after_usd);
          const noBudget = budget <= 0;
          const status: "ok" | "warn" | "over" | "none" =
            noBudget ? "none"
            : availAfter < 0 ? "over"
            : availAfter < budget * 0.3 ? "warn"
            : "ok";
          const statusBg =
            status === "over" ? "bg-red-50 border-red-200"
            : status === "warn" ? "bg-amber-50 border-amber-200"
            : status === "ok" ? "bg-emerald-50 border-emerald-200"
            : "bg-neutral-50";
          const statusText =
            status === "over" ? "text-red-800"
            : status === "warn" ? "text-amber-800"
            : status === "ok" ? "text-emerald-800"
            : "text-muted-foreground";
          const orderedPct = budget > 0 ? Math.min(100, (before / budget) * 100) : 0;
          const decisionPct = budget > 0 ? Math.min(100 - orderedPct, (decision / budget) * 100) : 0;
          return (
            <div key={s.subcategory_id} className={`border rounded-md p-2.5 text-xs ${statusBg}`}>
              <div className="flex items-center justify-between">
                <p className="font-semibold leading-snug">
                  <span className="font-mono text-muted-foreground">{s.subcategory_code}</span>
                  {" · "}
                  {s.subcategory_name}
                </p>
                <span className={`text-[10px] uppercase tracking-wider font-bold ${statusText}`}>
                  {status === "over"
                    ? "⚠ excedió presupuesto"
                    : status === "warn"
                      ? "Margen ajustado"
                      : status === "ok"
                        ? "OK"
                        : "Sin presupuesto"}
                </span>
              </div>
              {noBudget ? (
                <p className="text-muted-foreground italic mt-1">
                  Sin cuantificación cargada en ese momento — no había presupuesto contra el cual comparar.
                </p>
              ) : (
                <>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-neutral-200 overflow-hidden flex">
                    <div className="bg-neutral-700 h-full" style={{ width: `${orderedPct}%` }} />
                    <div
                      className={`h-full ${status === "over" ? "bg-red-600" : "bg-[#E87722]"}`}
                      style={{ width: `${decisionPct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10px]">
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Presup.</p>
                      <p className="font-mono font-semibold">{formatNumber(budget, 0)} USD</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Antes ya comp.</p>
                      <p className="font-mono">{formatNumber(before, 0)} USD</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Esta decisión</p>
                      <p className={`font-mono font-semibold ${decision > 0 ? "text-[#E87722]" : "text-muted-foreground"}`}>
                        {decision > 0 ? "+" : ""}{formatNumber(decision, 0)} USD
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground uppercase tracking-wider">Disp. tras decidir</p>
                      <p className={`font-mono font-bold ${statusText}`}>
                        {formatNumber(availAfter, 0)} USD
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 pt-1 border-t flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Disponible al iniciar la decisión:</span>
                    <span className="font-mono">{formatNumber(availBefore, 0)} USD</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
