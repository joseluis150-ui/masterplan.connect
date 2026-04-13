"use client";

import { useState, use } from "react";
import { cn } from "@/lib/utils";
import { FileText, ClipboardList, TrendingUp } from "lucide-react";
import { SolicitudesTab } from "./_components/solicitudes-tab";
import { OrdenesTab } from "./_components/ordenes-tab";
import { AvanceTab } from "./_components/avance-tab";

type TabKey = "solicitudes" | "ordenes" | "avance";

const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: "solicitudes", label: "Solicitudes", icon: ClipboardList },
  { key: "ordenes", label: "Órdenes de Compra", icon: FileText },
  { key: "avance", label: "Avance Financiero", icon: TrendingUp },
];

export default function ComprasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [activeTab, setActiveTab] = useState<TabKey>("solicitudes");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b border-border px-6 flex gap-6">
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex items-center gap-2 py-3 text-sm font-medium border-b-2 -mb-[1px] transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "solicitudes" && <SolicitudesTab projectId={projectId} />}
        {activeTab === "ordenes" && <OrdenesTab projectId={projectId} />}
        {activeTab === "avance" && <AvanceTab projectId={projectId} />}
      </div>
    </div>
  );
}
