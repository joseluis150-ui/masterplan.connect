"use client";

import { useState, use } from "react";
import { cn } from "@/lib/utils";
import { FileText, ClipboardList, Receipt, HandCoins, Users } from "lucide-react";
import { ProveedoresTab } from "./_components/proveedores-tab";
import { SolicitudesTab } from "./_components/solicitudes-tab";
import { OrdenesTab } from "./_components/ordenes-tab";
import { FacturacionTab } from "./_components/facturacion-tab";
import { AnticiposTab } from "./_components/anticipos-tab";
import { HistoryDrawer } from "./_components/history-drawer";

type TabKey = "proveedores" | "solicitudes" | "ordenes" | "anticipos" | "facturacion";

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: "proveedores", label: "Proveedores", icon: Users },
  { key: "solicitudes", label: "Solicitudes", icon: ClipboardList },
  { key: "ordenes", label: "Órdenes de Compra", icon: FileText },
  { key: "anticipos", label: "Anticipos dados", icon: HandCoins },
  { key: "facturacion", label: "Facturación", icon: Receipt },
];

export default function ComprasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [activeTab, setActiveTab] = useState<TabKey>("proveedores");
  // Force refresh of active tab when an undo happens
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar — brandbook §10 H1 + tabs con Signal Amber */}
      <div className="pt-4 border-b border-border">
        <h1 className="mb-3">Compras</h1>
        <div className="flex gap-1 -mb-px">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium transition-colors relative",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 -bottom-px h-[2px]"
                    style={{ background: "#E87722" }}
                  />
                )}
                <tab.icon className={cn("h-4 w-4", active && "text-[#E87722]")} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1">
        {activeTab === "proveedores" && <ProveedoresTab key={`prov-${refreshKey}`} projectId={projectId} />}
        {activeTab === "solicitudes" && <SolicitudesTab key={`sol-${refreshKey}`} projectId={projectId} />}
        {activeTab === "ordenes" && <OrdenesTab key={`ord-${refreshKey}`} projectId={projectId} />}
        {activeTab === "anticipos" && <AnticiposTab key={`ant-${refreshKey}`} projectId={projectId} />}
        {activeTab === "facturacion" && <FacturacionTab key={`fac-${refreshKey}`} projectId={projectId} />}
      </div>

      <HistoryDrawer projectId={projectId} onUndo={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}
