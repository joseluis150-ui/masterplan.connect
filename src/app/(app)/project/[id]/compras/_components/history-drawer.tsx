"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  History,
  Undo2,
  X,
  Package as PackageIcon,
  FileText,
  ShoppingCart,
  PackageCheck,
  Receipt,
  Wallet,
  Pencil,
  XCircle,
  CheckCircle2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { markActivityUndone, type ActivityLogEntry, type ActivityActionType } from "@/lib/utils/activity-log";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  onUndo?: () => void; // Called after successful undo so parent can reload
}

const ICON_BY_ACTION: Record<ActivityActionType, typeof History> = {
  package_approved: PackageIcon,
  sc_created_manual: FileText,
  sc_created_from_package: FileText,
  sc_cancelled: XCircle,
  oc_generated: ShoppingCart,
  oc_edited: Pencil,
  oc_line_deleted: Pencil,
  oc_closed: CheckCircle2,
  reception_created: PackageCheck,
  invoice_registered: Receipt,
  payment_registered: Wallet,
  supplier_created: Users,
};

const COLOR_BY_ACTION: Record<ActivityActionType, string> = {
  package_approved: "text-emerald-600",
  sc_created_manual: "text-amber-600",
  sc_created_from_package: "text-amber-600",
  sc_cancelled: "text-red-600",
  oc_generated: "text-amber-600",
  oc_edited: "text-amber-600",
  oc_line_deleted: "text-red-600",
  oc_closed: "text-emerald-600",
  reception_created: "text-amber-600",
  invoice_registered: "text-[#B85A0F]",
  payment_registered: "text-green-600",
  supplier_created: "text-muted-foreground",
};

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "hace un momento";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} días`;
  return date.toLocaleDateString("es");
}

export function HistoryDrawer({ projectId, onUndo }: Props) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("activity_log")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20);
    setEntries((data || []) as ActivityLogEntry[]);
    setLoading(false);
  }, [projectId, supabase]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Undo handlers per action type
  async function undoEntry(entry: ActivityLogEntry) {
    if (!entry.undoable || entry.undone_at) return;
    if (!confirm(`¿Deshacer la acción "${entry.description}"?`)) return;

    setUndoing(entry.id);
    try {
      const meta = entry.metadata as Record<string, unknown>;
      let success = false;

      switch (entry.action_type) {
        case "package_approved": {
          const pkgId = meta.packageId as string;
          const scId = meta.createdScId as string | undefined;
          if (scId) {
            await supabase.from("purchase_request_lines").delete().eq("request_id", scId);
            await supabase.from("purchase_requests").delete().eq("id", scId);
          }
          await supabase.from("procurement_packages").update({ status: "borrador" }).eq("id", pkgId);
          success = true;
          break;
        }

        case "sc_created_manual":
        case "sc_created_from_package": {
          const scId = meta.scId as string;
          // Check if SC has any OCs linked — abort if so
          const { count } = await supabase
            .from("purchase_orders")
            .select("id", { count: "exact", head: true })
            .eq("request_id", scId);
          if ((count || 0) > 0) {
            toast.error("No se puede deshacer: la SC ya tiene OC generada");
            return;
          }
          await supabase.from("purchase_request_lines").delete().eq("request_id", scId);
          await supabase.from("purchase_requests").delete().eq("id", scId);
          success = true;
          break;
        }

        case "sc_cancelled": {
          const scId = meta.scId as string;
          await supabase.from("purchase_requests").update({ status: "pending" }).eq("id", scId);
          success = true;
          break;
        }

        case "oc_generated": {
          const ocId = meta.ocId as string;
          // Check receptions — abort if any exist
          const { count } = await supabase
            .from("reception_notes")
            .select("id", { count: "exact", head: true })
            .eq("order_id", ocId);
          if ((count || 0) > 0) {
            toast.error("No se puede deshacer: la OC ya tiene recepciones");
            return;
          }
          await supabase.from("purchase_order_lines").delete().eq("order_id", ocId);
          await supabase.from("purchase_orders").delete().eq("id", ocId);
          success = true;
          break;
        }

        case "oc_closed": {
          const ocId = meta.ocId as string;
          // Revert to previous status (usually "open")
          const prev = (meta.previousStatus as string) || "open";
          await supabase.from("purchase_orders").update({ status: prev }).eq("id", ocId);
          success = true;
          break;
        }

        case "reception_created": {
          const recId = meta.receptionId as string;
          const ocId = meta.orderId as string;
          const wasAutoClosed = meta.wasAutoClosed as boolean | undefined;
          // Abort if invoice exists for this reception
          const { count } = await supabase
            .from("invoices")
            .select("id", { count: "exact", head: true })
            .eq("reception_id", recId);
          if ((count || 0) > 0) {
            toast.error("No se puede deshacer: la recepción ya fue facturada");
            return;
          }
          await supabase.from("delivery_notes").delete().eq("reception_id", recId);
          await supabase.from("reception_notes").delete().eq("id", recId);
          // If the OC was auto-closed because of this reception, reopen it
          if (wasAutoClosed && ocId) {
            await supabase.from("purchase_orders").update({ status: "open" }).eq("id", ocId);
          }
          success = true;
          break;
        }

        case "invoice_registered": {
          const invoiceId = meta.invoiceId as string;
          const receptionId = meta.receptionId as string;
          const attachmentUrl = meta.attachmentUrl as string | undefined;
          // Abort if any payment exists
          const { count } = await supabase
            .from("payments")
            .select("id", { count: "exact", head: true })
            .eq("invoice_id", invoiceId);
          if ((count || 0) > 0) {
            toast.error("No se puede deshacer: la factura ya tiene pagos registrados");
            return;
          }
          // Delete invoice + attachment
          await supabase.from("invoices").delete().eq("id", invoiceId);
          if (attachmentUrl) {
            await supabase.storage.from("invoice-attachments").remove([attachmentUrl]);
          }
          // Revert reception status
          await supabase.from("reception_notes").update({ status: "received" }).eq("id", receptionId);
          success = true;
          break;
        }

        case "payment_registered": {
          const paymentId = meta.paymentId as string;
          const invoiceId = meta.invoiceId as string;
          const wasInvoiceMarkedPaid = meta.wasInvoiceMarkedPaid as boolean | undefined;
          await supabase.from("payments").delete().eq("id", paymentId);
          if (wasInvoiceMarkedPaid && invoiceId) {
            await supabase.from("invoices").update({ status: "pending" }).eq("id", invoiceId);
          }
          success = true;
          break;
        }

        default:
          toast.error("Este tipo de acción no se puede deshacer automáticamente");
          return;
      }

      if (success) {
        await markActivityUndone(entry.id);
        toast.success("Acción deshecha");
        load();
        if (onUndo) onUndo();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Error desconocido";
      toast.error(`Error al deshacer: ${errorMessage}`);
    } finally {
      setUndoing(null);
    }
  }

  const activeCount = entries.filter((e) => e.undoable && !e.undone_at).length;

  return (
    <>
      {/* Floating button */}
      <Button
        variant="outline"
        size="sm"
        className="fixed bottom-6 right-6 shadow-lg z-40 gap-2"
        onClick={() => setOpen(true)}
      >
        <History className="h-4 w-4" />
        Historial
        {activeCount > 0 && (
          <Badge className="bg-primary text-primary-foreground hover:bg-primary text-[10px] h-5 px-1.5">
            {activeCount}
          </Badge>
        )}
      </Button>

      {/* Drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-50"
            onClick={() => setOpen(false)}
          />
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-background shadow-xl z-50 flex flex-col border-l">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5" />
                <h3 className="font-semibold">Historial</h3>
                <span className="text-xs text-muted-foreground">(últimas 20 acciones)</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-2">
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-8">Cargando...</p>
              ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Aún no hay acciones registradas en este proyecto.
                </p>
              ) : (
                entries.map((entry) => {
                  const Icon = ICON_BY_ACTION[entry.action_type] || History;
                  const iconColor = COLOR_BY_ACTION[entry.action_type] || "text-muted-foreground";
                  const canUndo = entry.undoable && !entry.undone_at;
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        "border rounded-md p-3 space-y-1.5 transition-colors",
                        entry.undone_at ? "bg-muted/30 opacity-60" : "bg-background hover:bg-muted/20"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className={cn("mt-0.5 shrink-0", iconColor)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "text-sm",
                            entry.undone_at && "line-through text-muted-foreground"
                          )}>
                            {entry.description}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {relativeTime(entry.created_at)}
                            {entry.undone_at && (
                              <span className="ml-2 text-red-600">· Deshecho {relativeTime(entry.undone_at)}</span>
                            )}
                          </p>
                        </div>
                        {canUndo && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs shrink-0"
                            onClick={() => undoEntry(entry)}
                            disabled={undoing === entry.id}
                          >
                            <Undo2 className="h-3 w-3 mr-1" />
                            {undoing === entry.id ? "..." : "Deshacer"}
                          </Button>
                        )}
                        {!canUndo && entry.undoable && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            Deshecho
                          </Badge>
                        )}
                        {!entry.undoable && !entry.undone_at && (
                          <Badge variant="outline" className="text-[10px] shrink-0 opacity-60">
                            No reversible
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t p-3 text-[10px] text-muted-foreground">
              Algunas acciones no pueden deshacerse si otras tareas posteriores dependen de ellas
              (ej. no puedes deshacer una OC que ya tiene recepciones).
            </div>
          </div>
        </>
      )}
    </>
  );
}
