"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useIsSuperAdmin } from "@/lib/permissions";
import { Plus, Trash2, Copy as CopyIcon, Check, Mail, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Member {
  user_id: string;
  email: string | null;
  role_id: string;
  role_slug: string;
  role_name: string;
  accepted_at: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role_id: string;
  role_slug: string;
  role_name: string;
  token: string;
  invited_at: string;
  expires_at: string;
  accepted_at: string | null;
}

interface RoleOption {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

const SUPER_ADMIN_FAKE_ROLE: RoleOption = {
  id: "_super_admin",
  slug: "super_admin",
  name: "Super Admin",
  description: "Vendor del SaaS — ve todos los proyectos",
};

export function MembersSection({ projectId }: { projectId: string }) {
  const isSuperAdmin = useIsSuperAdmin();
  const supabase = createClient();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("");
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [latestInvitationLink, setLatestInvitationLink] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [mRes, iRes, rRes] = await Promise.all([
      supabase.rpc("list_project_members", { p_project_id: projectId }),
      isSuperAdmin
        ? supabase.rpc("list_project_invitations", { p_project_id: projectId })
        : Promise.resolve({ data: [] }),
      supabase.from("roles").select("id, slug, name, description").order("name"),
    ]);
    setMembers((mRes.data ?? []) as Member[]);
    setInvitations((iRes.data ?? []) as Invitation[]);
    setRoles((rRes.data ?? []) as RoleOption[]);
    if (!inviteRole && rRes.data?.length) setInviteRole(rRes.data[0].slug);
    setLoading(false);
  }, [projectId, isSuperAdmin, inviteRole, supabase]);

  useEffect(() => { load(); }, [load]);

  function buildInvitationLink(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/accept-invitation/${token}`;
  }

  async function copyLink(token: string) {
    const link = buildInvitationLink(token);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedToken(token);
      toast.success("Link copiado al portapapeles");
      setTimeout(() => setCopiedToken((cur) => (cur === token ? null : cur)), 2000);
    } catch {
      toast.error("No se pudo copiar. Selecciónalo manualmente.");
    }
  }

  async function submitInvite() {
    if (!inviteEmail.trim() || !inviteRole) {
      toast.error("Completá email y rol");
      return;
    }
    setSubmittingInvite(true);
    setLatestInvitationLink(null);
    try {
      const { data, error } = await supabase.rpc("invite_to_project", {
        p_project_id: projectId,
        p_email: inviteEmail.trim().toLowerCase(),
        p_role_slug: inviteRole,
      });
      if (error) {
        toast.error(`Error: ${error.message}`);
        return;
      }
      const result = data as { kind: string; token?: string };
      if (result.kind === "added") {
        toast.success("Usuario agregado al proyecto");
        setInviteEmail("");
        setInviteOpen(false);
      } else if (result.kind === "role_updated") {
        toast.success("Rol actualizado para el usuario existente");
        setInviteEmail("");
        setInviteOpen(false);
      } else if (result.kind === "invited" && result.token) {
        const link = buildInvitationLink(result.token);
        setLatestInvitationLink(link);
        toast.success("Invitación creada. Copiá el link y pasáselo al usuario.");
      }
      await load();
    } finally {
      setSubmittingInvite(false);
    }
  }

  async function changeRole(member: Member, newSlug: string) {
    if (newSlug === member.role_slug) return;
    const { error } = await supabase.rpc("update_member_role", {
      p_project_id: projectId,
      p_user_id: member.user_id,
      p_role_slug: newSlug,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Rol actualizado");
    load();
  }

  async function removeMember(member: Member) {
    if (!confirm(`¿Quitar a ${member.email ?? "este usuario"} del proyecto?`)) return;
    const { error } = await supabase.rpc("remove_member", {
      p_project_id: projectId,
      p_user_id: member.user_id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Miembro removido");
    load();
  }

  async function cancelInvitation(inv: Invitation) {
    if (!confirm(`¿Cancelar invitación a ${inv.email}?`)) return;
    const { error } = await supabase.rpc("cancel_invitation", { p_invitation_id: inv.id });
    if (error) { toast.error(error.message); return; }
    toast.success("Invitación cancelada");
    load();
  }

  // Para el rol del super admin no mostramos opciones de cambio.
  // El display de "Super Admin" en la lista cuando algún miembro tiene ese rol
  // (no debería pasar, pero por si acaso).
  const roleOptions = [
    ...roles,
    ...(members.some((m) => m.role_slug === "super_admin") ? [SUPER_ADMIN_FAKE_ROLE] : []),
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Miembros del proyecto</CardTitle>
            <CardDescription>
              Personas con acceso al proyecto y su rol. Sólo el Super Admin puede invitar o cambiar roles.
            </CardDescription>
          </div>
          {isSuperAdmin && (
            <Button onClick={() => setInviteOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Agregar usuario
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Lista de miembros */}
        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Cargando…</div>
        ) : members.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 italic">
            Aún no hay miembros con acceso al proyecto (más allá del Super Admin).
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 p-3 border rounded-lg">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.email ?? m.user_id}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {m.accepted_at ? "Activo" : "Pendiente"}
                  </p>
                </div>
                {m.role_slug === "super_admin" ? (
                  <span className="text-sm font-medium px-3 py-1.5 rounded-md bg-neutral-900 text-white">
                    Super Admin
                  </span>
                ) : isSuperAdmin ? (
                  <Select
                    value={m.role_slug}
                    onValueChange={(v) => v && changeRole(m, v)}
                  >
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions
                        .filter((r) => r.slug !== "super_admin")
                        .map((r) => (
                          <SelectItem key={r.id} value={r.slug}>
                            {r.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-sm text-muted-foreground">{m.role_name}</span>
                )}
                {isSuperAdmin && m.role_slug !== "super_admin" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMember(m)}
                    title="Quitar miembro"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Lista de invitaciones pendientes */}
        {isSuperAdmin && invitations.filter((i) => !i.accepted_at).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Invitaciones pendientes
            </h4>
            {invitations
              .filter((i) => !i.accepted_at)
              .map((inv) => {
                const link = buildInvitationLink(inv.token);
                const expired = new Date(inv.expires_at) < new Date();
                return (
                  <div
                    key={inv.id}
                    className="p-3 border rounded-lg space-y-2 bg-amber-50/30"
                  >
                    <div className="flex items-center gap-3">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{inv.email}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Rol: {inv.role_name}
                          {expired && <span className="ml-2 text-red-600">· Expirada</span>}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyLink(inv.token)}
                      >
                        {copiedToken === inv.token ? (
                          <>
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <CopyIcon className="h-3.5 w-3.5 mr-1" />
                            Copiar link
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => cancelInvitation(inv)}
                        title="Cancelar invitación"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="text-[11px] font-mono break-all bg-background border rounded px-2 py-1">
                      {link}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </CardContent>

      {/* Modal de invitación */}
      <Dialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o) setLatestInvitationLink(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Agregar usuario al proyecto</DialogTitle>
            <DialogDescription>
              Si el email ya tiene cuenta, se agrega directamente. Si no, se genera un link de invitación que tendrás que copiar y enviarle al usuario por mail / WhatsApp.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Email del usuario</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                disabled={submittingInvite}
              />
            </div>

            <div className="space-y-2">
              <Label>Rol</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => v && setInviteRole(v)}
                disabled={submittingInvite}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.slug}>
                      <div>
                        <div className="font-medium">{r.name}</div>
                        {r.description && (
                          <div className="text-[11px] text-muted-foreground">{r.description}</div>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {latestInvitationLink && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                <p className="text-sm font-medium text-emerald-900 flex items-center gap-2">
                  <Check className="h-4 w-4" />
                  Invitación creada
                </p>
                <p className="text-xs text-emerald-800">
                  Copiá este link y mandáselo al usuario. Tiene validez de 14 días.
                </p>
                <div className="text-[11px] font-mono break-all bg-background border rounded px-2 py-1">
                  {latestInvitationLink}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(latestInvitationLink);
                    toast.success("Link copiado");
                  }}
                >
                  <CopyIcon className="h-3.5 w-3.5 mr-2" />
                  Copiar al portapapeles
                </Button>
              </div>
            )}

            <Button
              type="button"
              className="w-full"
              onClick={submitInvite}
              disabled={submittingInvite}
            >
              {submittingInvite ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Procesando…
                </>
              ) : (
                "Agregar usuario"
              )}
            </Button>

            {!isSuperAdmin && (
              <div className="text-xs text-muted-foreground flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Sólo el Super Admin puede agregar miembros. Si necesitás agregar a alguien, contactá al administrador del sistema.</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
