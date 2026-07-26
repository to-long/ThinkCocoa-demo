import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { PermissionGroup } from '@/components/ui/permission-list';
import { PermissionList } from '@/components/ui/permission-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRoleDescription, useRoleLabel } from '../../lib/use-role-label';
import type { RoleOption } from '../../types/users';

interface RolesPermissionsPickerProps {
  roles: RoleOption[];
  permissionGroups: PermissionGroup[];
  selectedRoles: Set<string>;
  onToggleRole: (roleId: string) => void;
  selectedPermissions: Set<string>;
  onPermissionsChange: (selected: Set<string>) => void;
  /** When true, parent is applying server state — do not sync permissions from roles. */
  roleSyncLocked?: boolean;
}

export function RolesPermissionsPicker({
  roles,
  permissionGroups,
  selectedRoles,
  onToggleRole,
  selectedPermissions,
  onPermissionsChange,
  roleSyncLocked = false,
}: RolesPermissionsPickerProps) {
  const intl = useIntl();
  const roleLabel = useRoleLabel();
  const roleDescription = useRoleDescription();

  // Replace-on-role-change sync: every time the ROLE set changes, wipe the
  // permission selection and rebuild it as the union of all currently
  // selected roles' permissions. Manual permission toggles (add/remove in
  // the Permissions tab) must NOT trigger this effect, so `selectedPermissions`
  // is intentionally excluded from the deps; we gate re-runs on a stable key
  // derived from the role set alone.
  const prevRolesKeyRef = useRef<string>('');
  const isInitialRoleEffectRef = useRef(true);

  useEffect(() => {
    const key = [...selectedRoles].sort().join('|');

    if (roleSyncLocked) {
      prevRolesKeyRef.current = key;
      return;
    }
    if (isInitialRoleEffectRef.current) {
      isInitialRoleEffectRef.current = false;
      prevRolesKeyRef.current = key;
      return;
    }
    if (key === prevRolesKeyRef.current) return; // role set unchanged
    prevRolesKeyRef.current = key;

    // Rebuild permission selection from scratch: union of all selected roles.
    const next = new Set<string>();
    for (const roleId of selectedRoles) {
      const role = roles.find((r) => r.id === roleId);
      if (!role) continue;
      for (const pid of role.permissionIds) next.add(pid);
    }
    onPermissionsChange(next);
  }, [selectedRoles, roleSyncLocked, roles, onPermissionsChange]);

  return (
    <Tabs defaultValue="roles">
      <TabsList className="z-10 w-full">
        <TabsTrigger value="roles">
          {intl.formatMessage({ id: 'users.userDialog.tabs.roles' })} ({selectedRoles.size})
        </TabsTrigger>
        <TabsTrigger value="permissions">
          {intl.formatMessage({ id: 'users.userDialog.tabs.permissions' })} (
          {selectedPermissions.size})
        </TabsTrigger>
      </TabsList>

      {/* Roles list */}
      <TabsContent value="roles">
        <div className="flex flex-col gap-3">
          {roles.map((role) => (
            <div key={role.id} className="flex items-start gap-3">
              <Checkbox
                id={`picker-role-${role.id}`}
                checked={selectedRoles.has(role.id)}
                onCheckedChange={() => onToggleRole(role.id)}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`picker-role-${role.id}`} className="font-medium text-sm">
                  {roleLabel(role.id, role.name)}
                </Label>
                {(role.description || true) && (
                  <span className="text-muted-foreground text-[13px]">
                    {roleDescription(role.id, role.description)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {roles.length === 0 && (
            <span className="text-muted-foreground text-sm">
              {intl.formatMessage({ id: 'users.userDialog.noRoles' })}
            </span>
          )}
        </div>
      </TabsContent>

      {/* Permissions list — grouped by resource */}
      <TabsContent value="permissions">
        <PermissionList
          groups={permissionGroups}
          value={selectedPermissions}
          onChange={onPermissionsChange}
          selectAllLabel={intl.formatMessage({
            id: 'users.userDialog.permissionsTab.selectAll',
          })}
          deselectAllLabel={intl.formatMessage({
            id: 'users.userDialog.permissionsTab.deselectAll',
          })}
        />
      </TabsContent>
    </Tabs>
  );
}
