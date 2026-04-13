"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Settings,
  FolderTree,
  Package,
  Puzzle,
  Calculator,
  Calendar,
  Truck,
  BarChart3,
  ChevronLeft,
  ChevronDown,
  ClipboardList,
  ShoppingCart,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project } from "@/lib/types/database";

const PLANNING_ITEMS = [
  { label: "EDT", href: "edt", icon: FolderTree },
  { label: "Insumos", href: "insumos", icon: Package },
  { label: "Artículos (APU)", href: "articulos", icon: Puzzle },
  { label: "Cuantificación", href: "cuantificacion", icon: Calculator },
  { label: "Cronograma", href: "cronograma", icon: Calendar },
  { label: "Paquetes", href: "paquetes", icon: Truck },
];

interface ProjectSidebarProps {
  project: Project;
  projectId: string;
}

export function ProjectSidebar({ project, projectId }: ProjectSidebarProps) {
  const pathname = usePathname();

  const isPlanningActive = PLANNING_ITEMS.some(
    (item) => pathname === `/project/${projectId}/${item.href}`
  );

  const [planningOpen, setPlanningOpen] = useState(isPlanningActive);

  const renderNavLink = (
    item: { label: string; href: string; icon: typeof Settings },
    indented?: boolean
  ) => {
    const href = `/project/${projectId}/${item.href}`;
    const isActive = pathname === href;
    return (
      <Link key={item.href} href={href}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors relative",
            indented && "pl-9",
            isActive
              ? "bg-white/[0.15] text-white"
              : "text-white/60 hover:bg-white/[0.08] hover:text-white/90"
          )}
        >
          {isActive && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r"
              style={{ background: "#1E3A8A" }}
            />
          )}
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </div>
      </Link>
    );
  };

  return (
    <div className="flex h-full w-[240px] flex-col" style={{ background: "#0F0F0F" }}>
      {/* Header */}
      <div className="p-4 pb-3">
        <Link
          href="/projects"
          className="flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition-colors mb-3"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Proyectos
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/isotipo-white.svg" alt="MasterPlan Connect" className="h-7 mb-2" />
        <h2 className="font-semibold text-sm text-white truncate">{project.name}</h2>
        <p className="text-xs text-white/40">
          v{project.current_version} &middot; {project.project_type === "venta" ? "Venta" : "Costo"}
        </p>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-white/10" />

      {/* Navigation */}
      <ScrollArea className="flex-1 py-2">
        <nav className="px-2 space-y-0.5">
          {/* 1. Configuración */}
          {renderNavLink({ label: "Configuración", href: "settings", icon: Settings })}

          {/* 2. Planificación (collapsible group) */}
          <button
            onClick={() => setPlanningOpen(!planningOpen)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors w-full text-left",
              isPlanningActive
                ? "text-white"
                : "text-white/60 hover:bg-white/[0.08] hover:text-white/90"
            )}
          >
            <ClipboardList className="h-4 w-4 shrink-0" />
            <span className="truncate flex-1">Planificación</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                !planningOpen && "-rotate-90"
              )}
            />
          </button>

          {planningOpen && (
            <div className="space-y-0.5">
              {PLANNING_ITEMS.map((item) => renderNavLink(item, true))}
            </div>
          )}

          {/* 3. Compras (conditional) */}
          {project.compras_enabled &&
            renderNavLink({ label: "Compras", href: "compras", icon: ShoppingCart })}

          {/* 4. Consultas */}
          {renderNavLink({ label: "Consultas", href: "consultas", icon: BarChart3 })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="mx-4 border-t border-white/10" />
      <div className="p-4">
        <div className="text-[11px] text-white/30 space-y-0.5">
          <p>{project.local_currency} &middot; TC: {Number(project.exchange_rate).toLocaleString()}</p>
          <p className="text-white/20">MasterPlan Connect</p>
        </div>
      </div>
    </div>
  );
}
