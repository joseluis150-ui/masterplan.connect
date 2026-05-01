import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Inbox, History } from "lucide-react";
import { ApprovalQueue } from "./_components/queue";

interface PendingOC {
  id: string;
  number: string | null;
  issue_date: string | null;
  supplier_name: string | null;
  total: number | string | null;
  currency: string | null;
  submitted_by: string | null;
  submitted_by_email: string | null;
  submitted_at: string | null;
}

/**
 * Cotización pendiente de adjudicar — agrupada por SC. Una sola SC suele
 * mandar varias cotizaciones (una por proveedor), así que la entrada
 * representa "esta SC tiene N cotizaciones esperando que el aprobador
 * adjudique cuál(es) gana(n)".
 */
interface PendingQuotation {
  request_id: string;
  request_number: string | null;
  quotation_count: number;
  total_lines: number;
  earliest_submitted: string | null;
}

export default async function AprobacionesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const supabase = await createClient();

  // Verifico permiso oc.approve. Si no lo tiene, redirijo a Consultas.
  const { data: perms } = await supabase.rpc("user_permissions_in_project", {
    p_project_id: projectId,
  });
  const permList = (perms as string[] | null) ?? [];
  if (!permList.includes("oc.approve")) {
    redirect(`/project/${projectId}/consultas`);
  }

  const [ocsRes, quotesRes] = await Promise.all([
    supabase.rpc("list_pending_oc_approvals", { p_project_id: projectId }),
    supabase.rpc("list_pending_quotation_approvals", { p_project_id: projectId }),
  ]);
  const pendingOcs = (ocsRes.data as PendingOC[] | null) ?? [];
  const pendingQuotations = (quotesRes.data as PendingQuotation[] | null) ?? [];
  const total = pendingOcs.length + pendingQuotations.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6 text-[#E87722]" />
            Aprobaciones pendientes
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Cotizaciones por adjudicar y órdenes de compra esperando tu firma
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/project/${projectId}/aprobaciones/historial`}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 border rounded-md px-3 py-1.5 hover:border-[#E87722]/40 transition-colors"
          >
            <History className="h-3.5 w-3.5" />
            Ver historial
          </Link>
          <div className="text-3xl font-bold" style={{ color: "#E87722" }}>
            {total}
          </div>
        </div>
      </div>

      <ApprovalQueue
        projectId={projectId}
        initialPendingOcs={pendingOcs}
        initialPendingQuotations={pendingQuotations}
      />
    </div>
  );
}
