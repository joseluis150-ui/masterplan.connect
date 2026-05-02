"use client";

import { useState, use } from "react";
import { cn } from "@/lib/utils";
import { DollarSign, TrendingUp, Activity } from "lucide-react";
import { PresupuestoTab } from "./_components/presupuesto-tab";
import { FlujoTab } from "./_components/flujo-tab";
import { AvanceTab } from "./_components/avance-tab";

type TabKey = "presupuesto" | "flujo" | "avance";

const TABS: { key: TabKey; label: string; icon: typeof DollarSign }[] = [
  { key: "presupuesto", label: "Presupuesto", icon: DollarSign },
  { key: "flujo", label: "Flujo de Efectivo", icon: TrendingUp },
  { key: "avance", label: "Avance Financiero", icon: Activity },
];

export default function ConsultasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [activeTab, setActiveTab] = useState<TabKey>("presupuesto");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Consultas</h1>
        <p className="text-muted-foreground text-sm mt-1">Presupuesto, flujo de efectivo y avance financiero del proyecto</p>
      </div>

      {/* Tab bar */}
      <div className="border-b">
        <div className="flex gap-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
                  isActive
                    ? "border-[#E87722] text-[#E87722]"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content. PresupuestoTab maneja internamente el toggle
          Absoluto/Por m² (antes era una pestaña aparte). */}
      {activeTab === "presupuesto" && <PresupuestoTab projectId={projectId} />}
      {activeTab === "flujo" && <FlujoTab projectId={projectId} />}
      {activeTab === "avance" && <AvanceTab projectId={projectId} />}
    </div>
  );
}
