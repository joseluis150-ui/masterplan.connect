import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { AcceptForm } from "./_form";

interface InvitationInfo {
  project_id: string;
  project_name: string;
  email: string;
  role_slug: string;
  role_name: string;
  expires_at: string;
  accepted_at: string | null;
  is_expired: boolean;
  is_accepted: boolean;
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: rawData, error } = await supabase.rpc("get_invitation_by_token", { p_token: token });
  const data = rawData as InvitationInfo | null;
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: "#0A0A0A" }}
    >
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-vertical.svg" alt="MasterPlan Connect" className="h-20 mx-auto mb-3" />
          <CardTitle>Invitación a un proyecto</CardTitle>
          {data && !data.is_expired && !data.is_accepted && (
            <CardDescription className="pt-2">
              Te invitaron a <span className="font-semibold text-foreground">{data.project_name}</span> como{" "}
              <span className="font-semibold text-foreground">{data.role_name}</span>.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error || !data ? (
            <Notice
              kind="error"
              title="Invitación no encontrada"
              text="El link es inválido o ya fue eliminado. Pedile al administrador que te genere una nueva invitación."
            />
          ) : data.is_expired ? (
            <Notice
              kind="error"
              title="Invitación expirada"
              text={`Esta invitación venció el ${new Date(data.expires_at).toLocaleDateString()}. Pedile al administrador que te genere una nueva.`}
            />
          ) : data.is_accepted ? (
            <Notice
              kind="info"
              title="Invitación ya aceptada"
              text="Esta invitación ya fue utilizada. Si necesitás acceso, contactá al administrador."
            />
          ) : !user ? (
            <UnauthFlow email={data.email} token={token} />
          ) : user.email?.toLowerCase() !== data.email.toLowerCase() ? (
            <WrongUser
              loggedAs={user.email ?? "(desconocido)"}
              expected={data.email}
            />
          ) : (
            <AcceptForm token={token} projectId={data.project_id} projectName={data.project_name} roleName={data.role_name} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Notice({ kind, title, text }: { kind: "error" | "info"; title: string; text: string }) {
  const isError = kind === "error";
  return (
    <div
      className={`rounded-md border p-3 ${
        isError ? "border-red-200 bg-red-50" : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <div className="flex items-start gap-2">
        {isError ? (
          <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-neutral-600 mt-0.5 shrink-0" />
        )}
        <div>
          <p className={`text-sm font-medium ${isError ? "text-red-900" : "text-neutral-900"}`}>{title}</p>
          <p className={`text-xs mt-1 ${isError ? "text-red-700" : "text-neutral-600"}`}>{text}</p>
        </div>
      </div>
      <Link href="/login" className="block mt-3">
        <Button variant="outline" size="sm" className="w-full">Ir al login</Button>
      </Link>
    </div>
  );
}

function UnauthFlow({ email, token }: { email: string; token: string }) {
  const returnTo = `/accept-invitation/${token}`;
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-sm flex items-start gap-2">
        <Mail className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <p>
            Iniciá sesión o creá una cuenta con el email{" "}
            <span className="font-mono text-foreground">{email}</span> para aceptar la invitación.
          </p>
        </div>
      </div>
      <Link href={`/login?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`}>
        <Button className="w-full">Iniciar sesión / Crear cuenta</Button>
      </Link>
    </div>
  );
}

function WrongUser({ loggedAs, expected }: { loggedAs: string; expected: string }) {
  return (
    <div className="space-y-3">
      <Notice
        kind="error"
        title="La invitación no es para esta cuenta"
        text={`Estás logueado como ${loggedAs}, pero la invitación es para ${expected}. Cerrá sesión e iniciá con el email correcto.`}
      />
    </div>
  );
}
