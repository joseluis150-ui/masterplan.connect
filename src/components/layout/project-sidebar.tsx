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
  FileText,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project } from "@/lib/types/database";
import { useAnyPermission, usePermission, type PermissionId } from "@/lib/permissions";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Settings;
  /** Permiso necesario para ver el link. Si lista, alcanza con tener UNO. */
  perm?: PermissionId | PermissionId[];
}

const PLANNING_ITEMS: NavItem[] = [
  { label: "EDT", href: "edt", icon: FolderTree, perm: "edt.read" },
  { label: "Insumos", href: "insumos", icon: Package, perm: "insumos.read" },
  { label: "Artículos (APU)", href: "articulos", icon: Puzzle, perm: "articulos.read" },
  { label: "Cuantificación", href: "cuantificacion", icon: Calculator, perm: "cuantificacion.read" },
  { label: "Cronograma", href: "cronograma", icon: Calendar, perm: "cronograma.read" },
  { label: "Paquetes", href: "paquetes", icon: Truck, perm: "paquetes.read" },
  { label: "Reportes", href: "reportes", icon: FileText, perm: "consultas.read" },
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

  // Permisos por sección (gates a nivel sidebar)
  const canSeeConsultas = usePermission("consultas.read");
  const canSeeSettings = usePermission("settings.read");
  const canSeeCompras = useAnyPermission(
    "oc.read", "solicitudes.read", "recepciones.read",
    "facturacion.read", "proveedores.read", "pagos.read"
  );
  const canSeePlanning = useAnyPermission(
    "edt.read", "insumos.read", "articulos.read",
    "cuantificacion.read", "cronograma.read", "paquetes.read", "consultas.read"
  );

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
            "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
            indented && "pl-9 text-[12.5px]",
            isActive
              ? "text-white bg-white/[0.05]"
              : "text-white/70 hover:text-white hover:bg-white/[0.03]"
          )}
        >
          {/* Active indicator: amber dot (Signal Amber as spec says) */}
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r"
              style={{ background: "#E87722" }}
            />
          )}
          <item.icon
            className={cn(
              "h-[15px] w-[15px] shrink-0 transition-colors",
              isActive ? "text-[#E87722]" : "text-white/55 group-hover:text-white/85"
            )}
          />
          <span className="truncate">{item.label}</span>
        </div>
      </Link>
    );
  };

  return (
    <div
      className="flex h-full w-[232px] flex-col"
      style={{ background: "#0A0A0A" /* Ink Black */ }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <Link
          href="/projects"
          className="flex items-center gap-1 text-[10px] font-medium text-white/45 hover:text-white/80 transition-colors mb-4 uppercase tracking-[0.1em] font-mono"
        >
          <ChevronLeft className="h-3 w-3" />
          Proyectos
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/isotipo-white.svg"
          alt="MasterPlan Connect"
          className="h-10 mb-4"
        />
        <h2 className="font-semibold text-[14px] text-white truncate leading-tight tracking-tight">
          {project.name}
        </h2>
        <p
          className="text-[10px] text-white/45 mt-1 font-mono uppercase tracking-wider"
        >
          v{project.current_version} · {project.project_type === "venta" ? "Venta" : "Costo"}
        </p>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-white/[0.06]" />

      {/* Navigation */}
      <ScrollArea className="flex-1 py-3">
        <nav className="px-2 space-y-0.5">
          {canSeeConsultas &&
            renderNavLink({ label: "Consultas", href: "consultas", icon: BarChart3 })}

          {canSeeSettings &&
            renderNavLink({ label: "Configuración", href: "settings", icon: Settings })}

          {/* Planificación group: sólo si tiene al menos UN permiso de planning */}
          {canSeePlanning && (
            <>
              <button
                onClick={() => setPlanningOpen(!planningOpen)}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors w-full text-left",
                  isPlanningActive
                    ? "text-white"
                    : "text-white/70 hover:text-white hover:bg-white/[0.03]"
                )}
              >
                <ClipboardList
                  className={cn(
                    "h-[15px] w-[15px] shrink-0",
                    isPlanningActive ? "text-[#E87722]" : "text-white/55 group-hover:text-white/85"
                  )}
                />
                <span className="truncate flex-1">Planificación</span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 shrink-0 text-white/40 transition-transform duration-200",
                    !planningOpen && "-rotate-90"
                  )}
                />
              </button>

              {planningOpen && (
                <div className="space-y-0.5">
                  {PLANNING_ITEMS.map((item) => (
                    <PlanningNavLink
                      key={item.href}
                      item={item}
                      projectId={projectId}
                      pathname={pathname}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {project.compras_enabled && canSeeCompras &&
            renderNavLink({ label: "Compras", href: "compras", icon: ShoppingCart })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="mx-4 border-t border-white/[0.06]" />
      <div className="px-4 py-3">
        <div className="text-[10px] text-white/40 leading-tight space-y-0.5 font-mono tracking-wide">
          <p>
            {project.local_currency} · TC {Number(project.exchange_rate).toLocaleString()}
          </p>
          <p className="text-white/25">MASTERPLAN · CONNECT</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Item del grupo Planificación. Como necesitamos chequear el permiso de cada
 * item por separado, lo encapsulamos en un componente para que el orden de
 * hooks (`usePermission`) sea estable por instancia.
 */
function PlanningNavLink({
  item,
  projectId,
  pathname,
}: {
  item: NavItem;
  projectId: string;
  pathname: string;
}) {
  // Si el item declara perm: chequearlo. Si no, mostrar siempre.
  const perms = Array.isArray(item.perm) ? item.perm : item.perm ? [item.perm] : [];
  const canSeeAny = useAnyPermission(...(perms.length ? perms : ["consultas.read"] as PermissionId[]));
  const visible = perms.length === 0 ? true : canSeeAny;
  if (!visible) return null;

  const href = `/project/${projectId}/${item.href}`;
  const isActive = pathname === href;
  return (
    <Link key={item.href} href={href}>
      <div
        className={cn(
          "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors pl-9 text-[12.5px]",
          isActive
            ? "text-white bg-white/[0.05]"
            : "text-white/70 hover:text-white hover:bg-white/[0.03]"
        )}
      >
        {isActive && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r"
            style={{ background: "#E87722" }}
          />
        )}
        <item.icon
          className={cn(
            "h-[15px] w-[15px] shrink-0 transition-colors",
            isActive ? "text-[#E87722]" : "text-white/55 group-hover:text-white/85"
          )}
        />
        <span className="truncate">{item.label}</span>
      </div>
    </Link>
  );
}
