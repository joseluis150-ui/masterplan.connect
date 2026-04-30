"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function AcceptForm({
  token,
  projectId,
  projectName,
  roleName,
}: {
  token: string;
  projectId: string;
  projectName: string;
  roleName: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function accept() {
    setSubmitting(true);
    const { error } = await supabase.rpc("accept_invitation", { p_token: token });
    if (error) {
      toast.error(error.message);
      setSubmitting(false);
      return;
    }
    toast.success(`¡Bienvenido a ${projectName}!`);
    router.push(`/project/${projectId}/consultas`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-emerald-50 p-3 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
        <p className="text-sm text-emerald-900">
          Confirmá para entrar al proyecto <span className="font-semibold">{projectName}</span> como{" "}
          <span className="font-semibold">{roleName}</span>.
        </p>
      </div>
      <Button onClick={accept} disabled={submitting} className="w-full">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Aceptando…
          </>
        ) : (
          "Aceptar invitación"
        )}
      </Button>
    </div>
  );
}
