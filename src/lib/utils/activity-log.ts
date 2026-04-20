import { createClient } from "@/lib/supabase/client";

export type ActivityActionType =
  | "package_approved"
  | "sc_created_manual"
  | "sc_created_from_package"
  | "sc_cancelled"
  | "oc_generated"
  | "oc_edited"
  | "oc_line_deleted"
  | "oc_closed"
  | "reception_created"
  | "invoice_registered"
  | "payment_registered";

export interface ActivityLogEntry {
  id: string;
  project_id: string;
  user_id: string | null;
  action_type: ActivityActionType;
  entity_type: string;
  entity_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  undoable: boolean;
  undone_at: string | null;
  undone_by: string | null;
  created_at: string;
}

interface LogActivityInput {
  projectId: string;
  actionType: ActivityActionType;
  entityType: string;
  entityId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  undoable?: boolean;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  const supabase = createClient();
  try {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("activity_log").insert({
      project_id: input.projectId,
      user_id: userData?.user?.id || null,
      action_type: input.actionType,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      description: input.description,
      metadata: input.metadata || {},
      undoable: input.undoable ?? true,
    });
  } catch {
    // Logging should never break the main flow
  }
}

export async function markActivityUndone(activityId: string): Promise<void> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  await supabase
    .from("activity_log")
    .update({ undone_at: new Date().toISOString(), undone_by: userData?.user?.id || null })
    .eq("id", activityId);
}
