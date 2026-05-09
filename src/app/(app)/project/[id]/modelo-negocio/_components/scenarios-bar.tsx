"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Copy, Trash2, Star, Loader2, Edit2 } from "lucide-react";
import { toast } from "sonner";
import type { Scenario } from "../_lib/types";

/**
 * Selector de escenarios — siempre visible. Permite cambiar entre
 * escenarios (chip horizontal), agregar nuevos (vacío o duplicando),
 * renombrar, eliminar y marcar como default.
 *
 * No se puede eliminar el último escenario.
 */
export function ScenariosBar({
  scenarios,
  activeId,
  onSelect,
  onAdd,
  onDuplicate,
  onRename,
  onDelete,
  onSetDefault,
  canEdit,
}: {
  scenarios: Scenario[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string) => Promise<void>;
  onDuplicate: (sourceId: string, name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
  canEdit: boolean;
}) {
  const [addDialog, setAddDialog] = useState<null | "new" | "duplicate">(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  const active = scenarios.find((s) => s.id === activeId);

  async function handleAddSubmit() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      if (addDialog === "duplicate" && active) {
        await onDuplicate(active.id, newName.trim());
      } else {
        await onAdd(newName.trim());
      }
      setAddDialog(null);
      setNewName("");
      toast.success("Escenario creado");
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  async function handleRenameSubmit() {
    if (!renamingId || !renameValue.trim()) return;
    setBusy(true);
    try {
      await onRename(renamingId, renameValue.trim());
      setRenamingId(null);
      setRenameValue("");
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  async function handleDelete(s: Scenario) {
    if (scenarios.length === 1) {
      toast.error("No se puede eliminar el último escenario");
      return;
    }
    if (!confirm(`¿Eliminar el escenario "${s.name}" y todos sus datos? Esta acción es irreversible.`)) return;
    try {
      await onDelete(s.id);
      toast.success("Escenario eliminado");
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap py-3 px-4 bg-muted/30 border-b">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono mr-1">
        Escenario:
      </span>
      {scenarios.map((s) => {
        const isActive = s.id === activeId;
        return (
          <div key={s.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-l-md border transition-colors inline-flex items-center gap-1.5",
                isActive
                  ? "bg-[#E87722] text-white border-[#E87722]"
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {s.isDefault && <Star className={cn("h-3 w-3", isActive ? "fill-white" : "fill-amber-400 text-amber-400")} />}
              {s.name}
              {s.scenarioType && s.scenarioType !== "custom" && (
                <span className={cn("text-[9px] uppercase tracking-wider opacity-70")}>
                  {s.scenarioType.slice(0, 3)}
                </span>
              )}
            </button>
            {canEdit && isActive && (
              <div className="inline-flex border-y border-r border-border bg-background rounded-r-md overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setRenamingId(s.id); setRenameValue(s.name); }}
                  className="px-1.5 py-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Renombrar"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
                {!s.isDefault && (
                  <button
                    type="button"
                    onClick={() => onSetDefault(s.id)}
                    className="px-1.5 py-1.5 hover:bg-muted text-muted-foreground hover:text-amber-500"
                    title="Marcar como default"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(s)}
                  disabled={scenarios.length === 1}
                  className="px-1.5 py-1.5 hover:bg-red-50 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                  title={scenarios.length === 1 ? "No se puede eliminar el último" : "Eliminar"}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {canEdit && (
        <div className="inline-flex gap-1 ml-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => { setAddDialog("new"); setNewName(""); }}
          >
            <Plus className="h-3 w-3 mr-1" /> Nuevo
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => { setAddDialog("duplicate"); setNewName(active ? `${active.name} (copia)` : ""); }}
            disabled={!active}
          >
            <Copy className="h-3 w-3 mr-1" /> Duplicar
          </Button>
        </div>
      )}

      {/* Dialog Agregar / Duplicar */}
      <Dialog open={!!addDialog} onOpenChange={(o) => { if (!o && !busy) setAddDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{addDialog === "duplicate" ? "Duplicar escenario" : "Nuevo escenario"}</DialogTitle>
            <DialogDescription>
              {addDialog === "duplicate"
                ? `Se copiarán todos los datos del escenario "${active?.name}" al nuevo.`
                : "Se crea vacío. Después podés agregar costos, ingresos y unidades."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs">Nombre</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej. Optimista"
              autoFocus
              disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddSubmit(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(null)} disabled={busy}>Cancelar</Button>
            <Button
              className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
              onClick={handleAddSubmit}
              disabled={busy || !newName.trim()}
            >
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {addDialog === "duplicate" ? "Duplicar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Renombrar */}
      <Dialog open={!!renamingId} onOpenChange={(o) => { if (!o && !busy) setRenamingId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renombrar escenario</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs">Nuevo nombre</Label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingId(null)} disabled={busy}>Cancelar</Button>
            <Button onClick={handleRenameSubmit} disabled={busy || !renameValue.trim()}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
