export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  memberCount: number;
}

export interface PermissionAction {
  id?: string;
  action: string;
}

export interface PermissionGroupRow {
  resource: string;
  actions: PermissionAction[];
}
