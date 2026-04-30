import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Inbox } from "lucide-react";
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

  const { data: pendingRaw } = await supabase.rpc("list_pending_oc_approvals", {
    p_project_id: projectId,
  });
  const pending = (pendingRaw as PendingOC[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6 text-[#E87722]" />
            Aprobaciones pendientes
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Órdenes de compra esperando tu firma
          </p>
        </div>
        <div className="text-3xl font-bold" style={{ color: "#E87722" }}>
          {pending.length}
        </div>
      </div>

      <ApprovalQueue projectId={projectId} initialPending={pending} />
    </div>
  );
}
