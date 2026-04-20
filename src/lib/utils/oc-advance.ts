import type { SupabaseClient } from "@supabase/supabase-js";

interface CreateAdvanceReceptionInput {
  supabase: SupabaseClient;
  orderId: string;
  advanceAmountAbsolute: number;  // Already resolved (not %)
  dateISO?: string;               // Defaults to today
  note?: string;
}

/**
 * Creates an auto-generated "advance" reception note for an OC.
 * Returns the new reception_note id, or null on failure.
 *
 * A single delivery_note line is inserted with quantity_received=1 and unit_price=advanceAmount,
 * so the DB-generated gross_amount and payable_amount equal the advance amount.
 * No amortization or retention is applied on this line (an advance doesn't amortize itself).
 */
export async function createAdvanceReception({
  supabase,
  orderId,
  advanceAmountAbsolute,
  dateISO,
  note,
}: CreateAdvanceReceptionInput): Promise<string | null> {
  if (advanceAmountAbsolute <= 0) return null;

  const date = dateISO || new Date().toISOString().slice(0, 10);

  // Next reception number for this order (normally = 1 because this is the first)
  const { data: numData } = await supabase.rpc("next_reception_number", {
    p_order_id: orderId,
  });
  const number = numData || 1;

  // Advance starts in 'pending_approval' — user must explicitly approve before it
  // enters the billing circuit (Facturación → Recibido no Facturado)
  const { data: rec, error: recErr } = await supabase
    .from("reception_notes")
    .insert({
      order_id: orderId,
      number,
      date,
      status: "pending_approval",
      type: "advance",
      comment: note || "Anticipo pactado en OC · pendiente de aprobación",
    })
    .select()
    .single();

  if (recErr || !rec) return null;

  const { error: lErr } = await supabase.from("delivery_notes").insert({
    reception_id: rec.id,
    order_line_id: null,
    date,
    quantity_received: 1,
    unit_price: advanceAmountAbsolute,
    amortization_pct: 0,
    retention_pct: 0,
  });

  if (lErr) {
    // Roll back header if line fails
    await supabase.from("reception_notes").delete().eq("id", rec.id);
    return null;
  }

  return rec.id as string;
}

/**
 * Resolves the absolute advance amount from OC fields + line total.
 */
export function resolveAdvanceAmount(
  advanceType: string | null | undefined,
  advanceValue: number,
  ocTotal: number
): number {
  if (advanceType === "percentage") {
    return (ocTotal * advanceValue) / 100;
  }
  return advanceValue;
}
