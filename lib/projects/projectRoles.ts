/** Role hierarchy for project permissions (same as dashboard project page). */
export const roleHierarchy = ['viewer', 'editor', 'admin', 'owner'] as const

export function getRoleLevel(role: string) {
  return roleHierarchy.indexOf(role as (typeof roleHierarchy)[number])
}
