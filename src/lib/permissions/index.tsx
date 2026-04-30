"use client";

/**
 * Sistema de permisos client-side. La fuente de verdad sigue siendo la DB
 * (RLS), pero precargamos los permisos del usuario en el proyecto para
 * mostrar/ocultar UI sin tener que ir contra la DB en cada render.
 *
 * Los permisos se cargan en el layout del proyecto vía RPC
 * `user_permissions_in_project(p_project_id)` y se pasan al Provider.
 *
 * El rol slug ("super_admin" | "directivo" | "aprobador" | …) se carga
 * en paralelo vía RPC `user_role_in_project(p_project_id)`. Sirve para
 * UI que sólo necesita saber el rol (ej. mostrar el badge "Aprobador").
 */

import * as React from "react";

export type PermissionId =
  | "settings.read" | "settings.write"
  | "edt.read" | "edt.write"
  | "insumos.read" | "insumos.write"
  | "articulos.read" | "articulos.write"
  | "cuantificacion.read" | "cuantificacion.write"
  | "cronograma.read" | "cronograma.write"
  | "paquetes.read" | "paquetes.write"
  | "solicitudes.read" | "solicitudes.create" | "solicitudes.write"
  | "oc.read" | "oc.write" | "oc.approve"
  | "recepciones.read" | "recepciones.write"
  | "facturacion.read" | "facturacion.write"
  | "pagos.read" | "pagos.write"
  | "proveedores.read" | "proveedores.write"
  | "consultas.read"
  | "presupuesto.approve"
  | "members.read" | "members.invite" | "members.remove";

export type RoleSlug =
  | "super_admin"
  | "directivo"
  | "aprobador"
  | "planificador"
  | "comprador"
  | "tesoreria"
  | "obra";

interface PermissionsContextValue {
  role: RoleSlug | null;
  permissions: Set<PermissionId>;
}

const PermissionsContext = React.createContext<PermissionsContextValue>({
  role: null,
  permissions: new Set(),
});

export function PermissionsProvider({
  role,
  permissions,
  children,
}: {
  role: RoleSlug | null;
  permissions: PermissionId[];
  children: React.ReactNode;
}) {
  const value = React.useMemo<PermissionsContextValue>(
    () => ({ role, permissions: new Set(permissions) }),
    [role, permissions]
  );
  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

/** Hook para consultar si el usuario tiene un permiso específico. */
export function usePermission(perm: PermissionId): boolean {
  const { permissions } = React.useContext(PermissionsContext);
  return permissions.has(perm);
}

/** Hook para consultar varios permisos a la vez. Devuelve true sólo si tiene TODOS. */
export function usePermissions(...perms: PermissionId[]): boolean {
  const { permissions } = React.useContext(PermissionsContext);
  return perms.every((p) => permissions.has(p));
}

/** ¿Tiene al menos uno de los permisos pasados? */
export function useAnyPermission(...perms: PermissionId[]): boolean {
  const { permissions } = React.useContext(PermissionsContext);
  return perms.some((p) => permissions.has(p));
}

/** Devuelve el rol del usuario en el proyecto actual. NULL si no es miembro. */
export function useRole(): RoleSlug | null {
  return React.useContext(PermissionsContext).role;
}

/** ¿Es super admin (vendor del SaaS)? */
export function useIsSuperAdmin(): boolean {
  return useRole() === "super_admin";
}
