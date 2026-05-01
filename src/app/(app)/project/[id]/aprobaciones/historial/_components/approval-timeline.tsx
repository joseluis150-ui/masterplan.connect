"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CheckCircle2, XCircle, Send, FileEdit, Mail, ClipboardList,
  Loader2, ChevronRight,
} from "lucide-react";

/** Una etapa del proceso, devuelta por get_oc_timeline o get_award_timeline. */
interface TimelineStage {
  stage: string;       // 'created'|'submitted'|'approved'|'rejected'|'request_created'|'quotation_created'|'quotations_submitted'|'awarded'
  occurred_at: string;
  actor_email: string | null;
  detail: string | null;
}

/**
 * Timeline vertical compacto. Llama a la RPC apropiada según el tipo y
 * renderiza una etapa por fila con timestamp, autor (email) y descripción.
 *
 * Ordena cronológicamente — la RPC ya devuelve en orden, pero hacemos el
 * sort defensivo en cliente por si llegan rows mezclados.
 */
export function ApprovalTimeline({
  type,
  refId,
}: {
  type: "oc" | "award";
  /** OC id, o request_id en caso de adjudicación */
  refId: string;
}) {
  const supabase = createClient();
  const [stages, setStages] = useState<TimelineStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const fn = type === "oc" ? "get_oc_timeline" : "get_award_timeline";
      const arg = type === "oc" ? { p_oc_id: refId } : { p_request_id: refId };
      const { data, error } = await supabase.rpc(fn, arg);
      if (cancelled) return;
      if (error) {
        console.error("Timeline error", error);
        setStages([]);
      } else {
        const sorted = (data as TimelineStage[] | null ?? [])
          .filter((s) => s.occurred_at)
          .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
        setStages(sorted);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [type, refId, supabase]);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground inline-flex items-center gap-2 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando línea de tiempo…
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground py-2">
        Sin eventos registrados.
      </p>
    );
  }

  return (
    <ol className="relative border-l-2 border-neutral-200 ml-3 space-y-3">
      {stages.map((s, i) => (
        <li key={i} className="ml-5 relative">
          {/* Dot a la izquierda con icono según etapa */}
          <span className={`absolute -left-[27px] top-0 h-5 w-5 rounded-full flex items-center justify-center ${stageBg(s.stage)}`}>
            {stageIcon(s.stage)}
          </span>
          <div className="text-xs">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold leading-tight">{stageLabel(s.stage)}</span>
              <span className="font-mono text-muted-foreground">
                {fmtFull(s.occurred_at)}
              </span>
            </div>
            {s.actor_email && (
              <p className="text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                <Mail className="h-3 w-3" />
                {s.actor_email}
              </p>
            )}
            {s.detail && (
              <p className="text-neutral-700 mt-0.5 leading-snug">{s.detail}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "created":              return "OC creada";
    case "submitted":            return "Enviada a aprobación";
    case "approved":             return "Aprobada";
    case "rejected":             return "Rechazada";
    case "request_created":      return "SC creada";
    case "quotation_created":    return "Cotización cargada";
    case "quotations_submitted": return "Enviadas a aprobación";
    case "awarded":              return "Adjudicación realizada";
    default:                     return stage;
  }
}

function stageBg(stage: string): string {
  switch (stage) {
    case "approved":
    case "awarded":
      return "bg-emerald-100 text-emerald-700";
    case "rejected":
      return "bg-red-100 text-red-700";
    case "submitted":
    case "quotations_submitted":
      return "bg-[#E87722]/10 text-[#E87722]";
    case "created":
    case "request_created":
    case "quotation_created":
      return "bg-neutral-200 text-neutral-700";
    default:
      return "bg-neutral-200 text-neutral-700";
  }
}

function stageIcon(stage: string) {
  const cls = "h-3 w-3";
  switch (stage) {
    case "approved":
    case "awarded":
      return <CheckCircle2 className={cls} />;
    case "rejected":
      return <XCircle className={cls} />;
    case "submitted":
    case "quotations_submitted":
      return <Send className={cls} />;
    case "request_created":
      return <ClipboardList className={cls} />;
    case "quotation_created":
      return <FileEdit className={cls} />;
    case "created":
      return <FileEdit className={cls} />;
    default:
      return <ChevronRight className={cls} />;
  }
}

function fmtFull(when: string): string {
  const d = new Date(when);
  return (
    d.toLocaleDateString() +
    " · " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );
}
