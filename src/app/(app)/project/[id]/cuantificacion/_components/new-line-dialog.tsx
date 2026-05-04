"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { FormulaInput } from "@/components/shared/formula-input";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { Articulo, EdtCategory, EdtSubcategory, Sector } from "@/lib/types/database";

/**
 * Modal para crear una nueva línea de cuantificación con todos sus
 * campos: sector, categoría, subcategoría, artículo (opcional),
 * cantidad y comentario opcional.
 *
 * Reemplaza al botón "+ Nueva Línea" del fondo de la tabla — más
 * controlado, no requiere scrollear hasta abajo, y validamos antes
 * de hacer el INSERT (vs. el flujo anterior donde la línea se
 * creaba con defaults y el usuario tenía que ajustarlos en la fila).
 */
export function NewLineDialog({
  sectors,
  categories,
  subcategories,
  articulos,
  /** Pre-fill opcional — útil cuando el usuario abre el dialog desde
   *  un contexto específico (ej. botón en header de subcategoría). */
  initial,
  onClose,
  onCreate,
}: {
  sectors: Sector[];
  categories: EdtCategory[];
  subcategories: EdtSubcategory[];
  articulos: Articulo[];
  initial?: {
    sector_id?: string;
    category_id?: string;
    subcategory_id?: string;
  };
  onClose: () => void;
  /** Llama al handler de la página padre con los valores. El padre
   *  hace el INSERT y refresca el state. Devuelve true si OK. */
  onCreate: (data: {
    sector_id: string;
    category_id: string;
    subcategory_id: string;
    articulo_id: string | null;
    quantity: number | null;
    comment: string | null;
  }) => Promise<boolean>;
}) {
  const [sectorId, setSectorId]           = useState<string>(initial?.sector_id ?? sectors[0]?.id ?? "");
  const [categoryId, setCategoryId]       = useState<string>(initial?.category_id ?? categories[0]?.id ?? "");
  const [subcategoryId, setSubcategoryId] = useState<string>(initial?.subcategory_id ?? "");
  const [articuloId, setArticuloId]       = useState<string>("");
  const [quantity, setQuantity]           = useState<number>(0);
  const [comment, setComment]             = useState<string>("");
  const [saving, setSaving]               = useState(false);

  // Auto-set primera subcategoría cuando cambia la categoría (o al montar
  // si no hay initial.subcategory_id). Si la subcat actual ya pertenece
  // a la categoría elegida, la respetamos.
  useEffect(() => {
    const subsOfCat = subcategories.filter((s) => s.category_id === categoryId);
    if (!subcategoryId || !subsOfCat.some((s) => s.id === subcategoryId)) {
      setSubcategoryId(subsOfCat[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const subsOfCat = subcategories.filter((s) => s.category_id === categoryId);

  async function handleSave() {
    if (!sectorId || !categoryId || !subcategoryId) {
      toast.error("Sector, categoría y subcategoría son obligatorios");
      return;
    }
    setSaving(true);
    const ok = await onCreate({
      sector_id: sectorId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      articulo_id: articuloId || null,
      quantity: quantity > 0 ? quantity : null,
      comment: comment.trim() || null,
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-[#E87722]" />
            Nueva línea de cuantificación
          </DialogTitle>
          <DialogDescription>
            Asigná un EDT (categoría + subcategoría), un sector y un artículo.
            La cantidad y el comentario son opcionales — los podés cargar después.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Sector *</Label>
            <SearchableSelect
              options={sectors.map((s) => ({ value: s.id, label: s.name }))}
              value={sectorId}
              onChange={(v) => setSectorId(v)}
              placeholder="Elegir sector"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Categoría *</Label>
            <SearchableSelect
              options={categories.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))}
              value={categoryId}
              onChange={(v) => setCategoryId(v)}
              placeholder="Elegir categoría"
            />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Subcategoría *</Label>
            <SearchableSelect
              options={subsOfCat.map((s) => ({ value: s.id, label: `${s.code} ${s.name}` }))}
              value={subcategoryId}
              onChange={(v) => setSubcategoryId(v)}
              placeholder={subsOfCat.length ? "Elegir subcategoría" : "(sin subcategorías en esta categoría)"}
            />
            {subsOfCat.length === 0 && categoryId && (
              <p className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                La categoría seleccionada no tiene subcategorías. Agregalas desde EDT.
              </p>
            )}
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Artículo (opcional)</Label>
            <SearchableSelect
              options={articulos.map((a) => ({
                value: a.id,
                label: `#${a.number} ${a.description}`,
                sublabel: a.unit,
              }))}
              value={articuloId}
              onChange={(v) => setArticuloId(v)}
              placeholder="Seleccionar artículo (o dejar vacío para provisional)"
              allowEmpty
              emptyLabel="(Provisional — sin artículo asignado)"
              emptyValue=""
              multiline
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cantidad (opcional)</Label>
            <FormulaInput
              value={quantity}
              onValueChange={(v) => setQuantity(v)}
              className="h-9"
            />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Comentario (opcional)</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Notas, justificación, recordatorio..."
              rows={2}
              className="text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !sectorId || !categoryId || !subcategoryId}
            className="bg-[#E87722] hover:bg-[#E87722]/90 text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Crear línea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
