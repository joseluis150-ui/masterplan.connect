import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectSidebar } from "@/components/layout/project-sidebar";
import { NumberLocaleHydrator } from "@/components/shared/number-locale-hydrator";
import { PermissionsProvider, type PermissionId, type RoleSlug } from "@/lib/permissions";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS limita el SELECT al proyecto del que el usuario es miembro (o app admin).
  // Si no es miembro, project queda vacío y disparamos notFound().
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  // En paralelo: rol del usuario en este proyecto + lista de permisos.
  const [roleRes, permsRes] = await Promise.all([
    supabase.rpc("user_role_in_project", { p_project_id: id }),
    supabase.rpc("user_permissions_in_project", { p_project_id: id }),
  ]);
  const role = (roleRes.data as RoleSlug | null) ?? null;
  const permissions = ((permsRes.data as PermissionId[] | null) ?? []) as PermissionId[];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NumberLocaleHydrator locale={(project.number_format as "es" | "en") || "es"} />
      <PermissionsProvider role={role} permissions={permissions}>
        <ProjectSidebar project={project} projectId={id} />
        <main className="flex-1 overflow-auto">
          <div className="px-8 py-6 max-w-[1600px] mx-auto">{children}</div>
        </main>
      </PermissionsProvider>
    </div>
  );
}
