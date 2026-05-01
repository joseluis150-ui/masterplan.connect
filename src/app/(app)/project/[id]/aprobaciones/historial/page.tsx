import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { History, ArrowLeft } from "lucide-react";
import { ApprovalHistoryList } from "./_components/history-list";

/**
 * Histórico de aprobaciones / adjudicaciones del usuario logueado en este
 * proyecto. Solo lectura; sin acciones. Pensado como "carpeta personal" del
 * aprobador con acceso rápido a los adjuntos de cada decisión.
 */
export default async function HistorialAprobacionesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const supabase = await createClient();

  // Sólo aprobadores pueden entrar — mismo gate que /aprobaciones.
  const { data: perms } = await supabase.rpc("user_permissions_in_project", {
    p_project_id: projectId,
  });
  const permList = (perms as string[] | null) ?? [];
  if (!permList.includes("oc.approve")) {
    redirect(`/project/${projectId}/consultas`);
  }

  // El client component se encarga del fetch — todo es read-only y se filtra
  // server-side via RLS + decided_by = auth.uid() para mostrar sólo lo del
  // usuario actual.
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/project/${projectId}/aprobaciones`}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver a la bandeja
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6 text-[#E87722]" />
            Historial de aprobaciones
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tus decisiones pasadas en este proyecto. Acá podés revisar cualquier
            adjudicación o aprobación de OC y abrir los archivos adjuntos.
          </p>
        </div>
      </div>

      <ApprovalHistoryList projectId={projectId} />
    </div>
  );
}
