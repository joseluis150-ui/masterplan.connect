import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectSidebar } from "@/components/layout/project-sidebar";
import { NumberLocaleHydrator } from "@/components/shared/number-locale-hydrator";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <NumberLocaleHydrator locale={(project.number_format as "es" | "en") || "es"} />
      <ProjectSidebar project={project} projectId={id} />
      <main className="flex-1 overflow-auto">
        <div className="px-8 py-6 max-w-[1600px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
