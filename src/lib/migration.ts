export function withoutWorkspace<T>(record: T): T {
  const {
    workspaceId: _id,
    workspaces: _groups,
    activeWorkspaceId: _active,
    ...rest
  } = record as T & {
    workspaceId?: string;
    workspaces?: unknown;
    activeWorkspaceId?: string;
  };
  return rest as T;
}
