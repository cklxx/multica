import type { IssueView } from "../api/schemas";
import { baselineFromQuery } from "../issue-views/baseline";
import type { IssueStatusCategory, ListIssuesParams, Project } from "../types";
import { assigneeTypesForActorKind } from "./surface/scope";
import { effectiveNegatedFilters } from "./stores/view-store";
import { pruneAdvancedFilter } from "./stores/filter-tree";
import type { SidebarIssueSettings, SidebarProjectSettings } from "./stores/sidebar-tree-store";

/** Rows an expanded sidebar list shows before "Load more". */
export const SIDEBAR_FIRST_PAGE = 5;
/** Rows each "Load more" adds. */
export const SIDEBAR_PAGE_STEP = 10;

export const projectSidebarSource = (projectId: string) => `project:${projectId}`;
export const viewSidebarSource = (viewId: string) => `view:${viewId}`;

interface StatusRef {
  key: string;
  category: IssueStatusCategory;
}

const FINISHED: ReadonlySet<IssueStatusCategory> = new Set(["done", "closed"]);

/** Status keys an expanded project lists, in catalog order. */
export function shownSidebarStatuses(
  settings: Pick<SidebarIssueSettings, "hiddenStatuses">,
  statuses: readonly StatusRef[],
): string[] {
  const hidden = new Set(
    settings.hiddenStatuses ?? statuses.filter((s) => FINISHED.has(s.category)).map((s) => s.key),
  );
  return statuses.filter((s) => !hidden.has(s.key)).map((s) => s.key);
}

/** List params for an expanded project, or `null` when the settings leave nothing to list. */
export function projectSidebarParams(
  projectId: string,
  settings: SidebarIssueSettings,
  statuses: readonly StatusRef[],
  userId: string | undefined,
): ListIssuesParams | null {
  const shown = shownSidebarStatuses(settings, statuses);
  if (shown.length === 0) return null;
  if (settings.assignee !== "anyone" && !userId) return null;
  return {
    project_id: projectId,
    ...(shown.length < statuses.length ? { statuses: shown } : {}),
    ...(settings.assignee === "me" ? { assignee_id: userId } : {}),
    ...(settings.assignee === "my_agents" ? { involves_user_id: userId } : {}),
    ...(settings.showSubIssues ? {} : { top_level_only: true }),
    sort_by: settings.sortBy,
    sort_direction: settings.sortDirection,
  };
}

const VIEW_SORTS = new Set<string>([
  "position",
  "status",
  "priority",
  "title",
  "created_at",
  "updated_at",
  "last_activity",
  "start_date",
  "due_date",
]);

type SidebarViewFields = Pick<IssueView, "query" | "display" | "scope_variant"> &
  Partial<Pick<IssueView, "scope_type" | "scope_id">>;

/**
 * Whether the list endpoint can express the view's scope. "My issues → any"
 * is a union of relations only the table channel answers, so its sidebar row
 * opens the page instead of expanding.
 */
export function viewHasSidebarPreview(view: SidebarViewFields): boolean {
  if (view.scope_type === "my" && (view.scope_variant ?? "any") === "any") return false;
  // The list endpoint has no "is not", viewer-relation, due-date or rule-tree
  // filter; a preview that ignored them would list issues the view excludes.
  const { raw } = baselineFromQuery(view.query);
  return (
    raw.relationFilters.length === 0 &&
    raw.dueDateFilters.length === 0 &&
    !pruneAdvancedFilter(raw.advancedFilter) &&
    effectiveNegatedFilters(raw).length === 0
  );
}

function viewScopeParams(view: SidebarViewFields, userId: string | undefined): ListIssuesParams | null {
  if (view.scope_type === "project") return view.scope_id ? { project_id: view.scope_id } : null;
  if (view.scope_type !== "my") return {};
  if (!userId) return null;
  switch (view.scope_variant) {
    case "assigned":
      return { assignee_id: userId };
    case "created":
      return { creator_id: userId };
    case "involved":
      return { involves_user_id: userId };
    default:
      return null;
  }
}

/**
 * List params for an expanded saved view: its scope, filters and ordering, so
 * the sidebar lists what opening the view shows. `null` when the view can
 * match nothing.
 */
export function viewSidebarParams(
  view: SidebarViewFields,
  projects: readonly Pick<Project, "id" | "status">[],
  userId?: string,
): ListIssuesParams | null {
  const scopeParams = viewScopeParams(view, userId);
  if (!scopeParams) return null;
  const { raw } = baselineFromQuery(view.query);
  let projectIds = raw.projectFilters;
  // The list endpoint has no project-status facet; resolve it to project ids.
  if (raw.projectStatusFilters.length > 0) {
    const statuses = new Set<string>(raw.projectStatusFilters);
    const matching = projects.filter((p) => statuses.has(p.status)).map((p) => p.id);
    projectIds = projectIds.length > 0 ? projectIds.filter((id) => matching.includes(id)) : matching;
    if (projectIds.length === 0 && !raw.includeNoProject) return null;
  }

  const display = view.display ?? {};
  const sortBy =
    typeof display.sortBy === "string" &&
    (VIEW_SORTS.has(display.sortBy) || display.sortBy.startsWith("property:"))
      ? (display.sortBy as ListIssuesParams["sort_by"])
      : "position";
  const assigneeTypes = assigneeTypesForActorKind(
    view.scope_variant === "members" || view.scope_variant === "agents" ? view.scope_variant : undefined,
  );

  return {
    ...scopeParams,
    ...(raw.statusFilters.length > 0 ? { statuses: raw.statusFilters } : {}),
    ...(raw.priorityFilters.length > 0 ? { priorities: raw.priorityFilters } : {}),
    ...(raw.assigneeFilters.length > 0 ? { assignee_filters: raw.assigneeFilters } : {}),
    ...(raw.includeNoAssignee ? { include_no_assignee: true } : {}),
    ...(raw.creatorFilters.length > 0 ? { creator_filters: raw.creatorFilters } : {}),
    ...(projectIds.length > 0 ? { project_ids: projectIds } : {}),
    ...(raw.includeNoProject ? { include_no_project: true } : {}),
    ...(raw.labelFilters.length > 0 ? { label_ids: raw.labelFilters } : {}),
    ...(Object.keys(raw.propertyFilters).length > 0 ? { properties: raw.propertyFilters } : {}),
    ...(assigneeTypes ? { assignee_types: assigneeTypes } : {}),
    ...(display.showSubIssues === false ? { top_level_only: true } : {}),
    sort_by: sortBy,
    sort_direction: display.sortDirection === "desc" ? "desc" : "asc",
  };
}

/** The projects the sidebar lists, filtered and ordered by its settings. */
export function sidebarProjects<P extends Pick<Project, "id" | "title" | "status" | "lead_type" | "lead_id" | "created_at" | "updated_at">>(
  projects: readonly P[],
  settings: SidebarProjectSettings,
  manualOrder: readonly string[],
  userId: string | undefined,
): P[] {
  const statuses = new Set<string>(settings.statuses);
  const shown = projects.filter(
    (p) =>
      statuses.has(p.status) &&
      (!settings.onlyMine || (p.lead_type === "member" && !!userId && p.lead_id === userId)),
  );
  switch (settings.ordering) {
    case "name":
      return shown.sort((a, b) => a.title.localeCompare(b.title));
    case "updated":
      return shown.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    case "created":
      return shown.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "manual": {
      const rank = new Map(manualOrder.map((id, i) => [id, i]));
      return shown
        .map((p, i) => ({ p, i }))
        .sort((a, b) => (rank.get(a.p.id) ?? manualOrder.length + a.i) - (rank.get(b.p.id) ?? manualOrder.length + b.i))
        .map(({ p }) => p);
    }
  }
}
