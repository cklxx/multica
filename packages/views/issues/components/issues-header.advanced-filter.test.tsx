// @vitest-environment jsdom

/**
 * The filter menu's search and its way into advanced mode, against the real
 * Base UI primitives (see issues-header.property-filter.test.tsx).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, type StoreApi } from "zustand/vanilla";
import { setApiInstance } from "@multica/core/api";
import type { ApiClient } from "@multica/core/api/client";
import { createAuthStore, registerAuthStore } from "@multica/core/auth";
import { type IssueViewState, viewStoreSlice } from "@multica/core/issues/stores/view-store";
import { ViewStoreProvider } from "@multica/core/issues/stores/view-store-context";
import { createFilterCondition, createFilterGroup } from "@multica/core/issues/stores/filter-tree";
import { renderWithI18n } from "../../test/i18n";
import { IssueFilterMenu } from "./issues-header";

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => null,
}));

function renderFilterMenu(setup?: (store: StoreApi<IssueViewState>) => void, withProperty = false) {
  setApiInstance({
    listIssueStatuses: async () => ({ statuses: [], categories: [], total: 0 }),
    listProperties: async () => ({ properties: withProperty ? [{
      id: "estimate", workspace_id: "ws-1", name: "Estimate", type: "number",
      config: {}, position: 1, archived: false, created_at: "", updated_at: "",
    }] : [] }),
    listMembers: async () => [],
    listAgents: async () => [
      { id: "agent-lambda", name: "Lambda", archived_at: null, owner_id: "u-1" },
    ],
    listSquads: async () => [],
    listProjects: async () => ({ projects: [], total: 0 }),
    listLabels: async () => ({ labels: [{ id: "label-bug", name: "Bug", color: "#f00" }], total: 1 }),
  } as unknown as ApiClient);
  registerAuthStore(
    createAuthStore({
      api: {} as ApiClient,
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const store = createStore<IssueViewState>()(viewStoreSlice);
  setup?.(store);
  renderWithI18n(
    <QueryClientProvider client={qc}>
      <ViewStoreProvider store={store}>
        <IssueFilterMenu trigger={<button type="button">Filter</button>} />
      </ViewStoreProvider>
    </QueryClientProvider>,
  );
  return store;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("IssueFilterMenu search", () => {
  it("offers values as conditions and toggles them", async () => {
    const store = renderFilterMenu();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const search = await screen.findByRole("textbox", { name: "Filter by field or value…" });
    await userEvent.type(search, "lamb");

    const row = await screen.findByRole("menuitemcheckbox", { name: /Assignee\s*is\s*Lambda/ });
    fireEvent.click(row);
    expect(store.getState().assigneeFilters).toEqual([{ type: "agent", id: "agent-lambda" }]);
    // Creator offers the same agent as its own condition.
    expect(screen.getByRole("menuitemcheckbox", { name: /Creator\s*is\s*Lambda/ })).toBeInTheDocument();
  });

  it("matches fields by name and buckets by label", async () => {
    const store = renderFilterMenu();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const search = await screen.findByRole("textbox", { name: "Filter by field or value…" });
    await userEvent.type(search, "overdue");
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: /Due date\s*is\s*Overdue/ }));
    expect(store.getState().dueDateFilters).toEqual(["overdue"]);

    await userEvent.clear(search);
    await userEvent.type(search, "due");
    expect(await screen.findByRole("menuitem", { name: /Due date/ })).toBeInTheDocument();
  });
});

describe("IssueFilterMenu advanced mode", () => {
  it("shows property filters in the panel, and Clear all clears them too", async () => {
    const store = renderFilterMenu((s) => {
      s.getState().setPropertyFilterValues("estimate", ["3"]);
      s.getState().togglePriorityFilter("urgent");
    }, true);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("menuitem", { name: /Estimate/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Switch to advanced filter/ }));
    await screen.findByTestId("advanced-filter-panel");
    expect(store.getState().propertyFilters).toEqual({ estimate: ["3"] });
    expect(screen.getByTestId("advanced-property-row")).toHaveTextContent("Estimate");
    expect(screen.getByRole("button", { name: "Add property filter" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(store.getState().advancedFilter?.children).toEqual([]);
    expect(store.getState().propertyFilters).toEqual({});
    expect(screen.queryByTestId("advanced-property-row")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeDisabled();
  });

  it("switches to advanced with the current filters and opens the panel", async () => {
    const store = renderFilterMenu((s) => {
      s.getState().togglePriorityFilter("urgent");
      s.getState().toggleLabelFilter("label-bug");
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Switch to advanced filter/ }));

    expect(store.getState().priorityFilters).toEqual([]);
    expect(store.getState().advancedFilter?.children).toHaveLength(2);
    const panel = await screen.findByTestId("advanced-filter-panel");
    expect(panel).toHaveTextContent("Advanced filter");
    expect(screen.getAllByTestId("advanced-filter-row")).toHaveLength(2);
    // Two plain "and" rows are still simple filters.
    expect(screen.getByRole("button", { name: "Switch to simple filter" })).toBeEnabled();
  });

  it("disables switching back with the reason when the tree has a group", async () => {
    renderFilterMenu((s) =>
      s.getState().setAdvancedFilter(
        createFilterGroup("all", [
          createFilterCondition("project", ["p1"]),
          createFilterGroup("any", [
            createFilterCondition("priority", ["urgent"]),
            createFilterCondition("label", ["label-bug"]),
          ]),
        ]),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await screen.findByTestId("advanced-filter-panel");
    expect(screen.getByTestId("advanced-filter-group")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to simple filter" })).toBeDisabled();
    expect(screen.getByText(/Simple filters can't show groups/)).toBeInTheDocument();
  });

  it("goes back to the simple menu with the same filters", async () => {
    const store = renderFilterMenu((s) =>
      s.getState().setAdvancedFilter(createFilterGroup("all", [createFilterCondition("status", ["todo"], true)])),
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await screen.findByTestId("advanced-filter-panel");
    fireEvent.click(screen.getByRole("button", { name: "Switch to simple filter" }));
    await waitFor(() => expect(store.getState().advancedFilter).toBeNull());
    expect(store.getState().statusFilters).toEqual(["todo"]);
    expect(store.getState().negatedFilters).toEqual(["status"]);
  });
});
