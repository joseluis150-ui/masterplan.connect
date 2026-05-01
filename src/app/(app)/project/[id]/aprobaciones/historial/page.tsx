import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { History, ArrowLeft, Shield } from "lucide-react";
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
  // En paralelo chequeamos si el user es app admin para habilitar la vista
  // global de TODAS las decisiones del proyecto, ordenadas por aprobador.
  const [permsRes, adminRes] = await Promise.all([
    supabase.rpc("user_permissions_in_project", { p_project_id: projectId }),
    supabase.rpc("is_app_admin"),
  ]);
  const permList = (permsRes.data as string[] | null) ?? [];
  if (!permList.includes("oc.approve")) {
    redirect(`/project/${projectId}/consultas`);
  }
  const isAppAdmin = (adminRes.data as boolean | null) ?? false;

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
            {isAppAdmin && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#E87722]/10 text-[#E87722] font-semibold">
                <Shield className="h-3 w-3" />
                Super admin
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isAppAdmin
              ? "Como super admin podés ver tus decisiones o el listado completo del proyecto agrupado por aprobador."
              : "Tus decisiones pasadas en este proyecto. Acá podés revisar cualquier adjudicación o aprobación de OC y abrir los archivos adjuntos."}
          </p>
        </div>
      </div>

      <ApprovalHistoryList projectId={projectId} isAppAdmin={isAppAdmin} />
    </div>
  );
}
