"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Ellipsis, ListTree, Plus } from "@multica/ui/icons";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import {
  ADVANCED_FILTER_MAX_CONDITIONS,
  advancedFilterConditionSlots,
  createFilterCondition,
  createFilterGroup,
  editAdvancedFilter,
  simpleFromAdvancedFilter,
  type AdvancedFilterCondition,
  type AdvancedFilterGroup,
  type AdvancedFilterNode,
  type NegatableFilterDimension,
} from "@multica/core/issues/stores/filter-tree";
import { useViewStore } from "@multica/core/issues/stores/view-store-context";
import { useT } from "../../i18n";
import { FILTER_ITEM_CLASS, HoverCheck } from "../../common/hover-check";
import {
  FILTER_FIELD_ICONS,
  matchesFilterQuery,
  useFilterFieldLabels,
  useFilterValueCatalog,
  type FilterValueOption,
} from "./filter-field-options";

/** Navigation keys move into the list; everything else stays in the input
 *  instead of feeding the menu's typeahead. */
export function stopMenuSearchKeys(event: React.KeyboardEvent) {
  if (["Escape", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.stopPropagation();
}

type Catalog = (field: NegatableFilterDimension) => FilterValueOption[];

const CONNECTOR_CLASS = "flex h-7 w-14 shrink-0 items-center text-caption text-muted-foreground";
const ROW_SELECT_CLASS = "h-7 rounded-md text-caption";

function FieldPickerMenu({
  fields,
  trigger,
  onPick,
}: {
  fields: readonly NegatableFilterDimension[];
  trigger: React.ReactElement;
  onPick: (field: NegatableFilterDimension) => void;
}) {
  const labels = useFilterFieldLabels();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="start" className="w-48">
        {fields.map((field) => {
          const Icon = FILTER_FIELD_ICONS[field];
          return (
            <DropdownMenuItem key={field} onClick={() => onPick(field)}>
              <Icon className="size-3.5" />
              {labels[field]}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MatchSelect({
  value,
  onChange,
  className,
}: {
  value: "all" | "any";
  onChange: (value: "all" | "any") => void;
  className?: string;
}) {
  const { t } = useT("issues");
  const items = [
    { value: "all", label: t(($) => $.filters.match_all) },
    { value: "any", label: t(($) => $.filters.match_any) },
  ];
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next === "all" || next === "any") onChange(next);
      }}
    >
      <SelectTrigger size="sm" className={cn(ROW_SELECT_CLASS, "w-auto", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="text-caption">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Where" before the first row, then the group's word for joining rows; the
 *  second row of a nested group is where that word is chosen. */
function RowConnector({
  index,
  group,
  editable,
  onMatchChange,
}: {
  index: number;
  group: AdvancedFilterGroup;
  editable: boolean;
  onMatchChange: (match: "all" | "any") => void;
}) {
  const { t } = useT("issues");
  if (index === 0) return <span className={CONNECTOR_CLASS}>{t(($) => $.filters.advanced_where)}</span>;
  if (index === 1 && editable) {
    const items = [
      { value: "all", label: t(($) => $.filters.advanced_and) },
      { value: "any", label: t(($) => $.filters.advanced_or) },
    ];
    return (
      <span className={CONNECTOR_CLASS}>
        <Select
          items={items}
          value={group.match}
          onValueChange={(next) => {
            if (next === "all" || next === "any") onMatchChange(next);
          }}
        >
          <SelectTrigger size="sm" aria-label={t(($) => $.filters.operator_label)} className={cn(ROW_SELECT_CLASS, "w-13 px-1.5")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} className="text-caption">
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    );
  }
  return (
    <span className={CONNECTOR_CLASS}>
      {group.match === "any" ? t(($) => $.filters.advanced_or) : t(($) => $.filters.advanced_and)}
    </span>
  );
}

function ValuePicker({
  condition,
  catalog,
  onChange,
}: {
  condition: AdvancedFilterCondition;
  catalog: Catalog;
  onChange: (values: string[]) => void;
}) {
  const { t } = useT("issues");
  const [search, setSearch] = useState("");
  const options = catalog(condition.field);
  const query = search.trim().toLowerCase();
  const visible = options.filter((option) => matchesFilterQuery(option.label, query));
  const selected = options.filter((option) => condition.values.includes(option.value));
  const toggle = (value: string) =>
    onChange(
      condition.values.includes(value)
        ? condition.values.filter((v) => v !== value)
        : [...condition.values, value],
    );
  const [first] = selected;
  const summary =
    condition.values.length === 0
      ? null
      : first
        ? condition.values.length > 1
          ? `${first.label} +${condition.values.length - 1}`
          : first.label
        : String(condition.values.length);

  let lastGroup: string | undefined;
  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch("")}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t(($) => $.filters.advanced_values_label)}
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input px-2 text-left text-caption outline-none hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        }
      >
        {selected.slice(0, 3).map((option) => (
          <span key={option.value} className="flex shrink-0 items-center">
            {option.icon}
          </span>
        ))}
        <span className={cn("min-w-0 flex-1 truncate", summary ? "font-medium" : "text-muted-foreground")}>
          {summary ?? t(($) => $.filters.advanced_values_placeholder)}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-0">
        <div className="border-b border-foreground/5 px-2 py-1.5">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={stopMenuSearchKeys}
            placeholder={t(($) => $.filters.placeholder)}
            className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {visible.map((option) => {
            const checked = condition.values.includes(option.value);
            const heading =
              option.group && option.group !== lastGroup ? option.group : undefined;
            lastGroup = option.group;
            return (
              <div key={option.value}>
                {heading && <DropdownMenuLabel>{heading}</DropdownMenuLabel>}
                <DropdownMenuCheckboxItem
                  checked={checked}
                  onCheckedChange={() => toggle(option.value)}
                  className={FILTER_ITEM_CLASS}
                >
                  <HoverCheck checked={checked} />
                  {option.icon}
                  <span className="truncate">{option.label}</span>
                </DropdownMenuCheckboxItem>
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="px-2 py-3 text-center text-body text-muted-foreground">
              {t(($) => $.filters.no_results)}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowActions({ children }: { children: ReactNode }) {
  const { t } = useT("issues");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t(($) => $.filters.advanced_actions)}
            className="size-7 shrink-0 text-muted-foreground"
          />
        }
      >
        <Ellipsis className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConditionRow({
  condition,
  fields,
  catalog,
  canAdd,
  onEdit,
}: {
  condition: AdvancedFilterCondition;
  fields: readonly NegatableFilterDimension[];
  catalog: Catalog;
  canAdd: boolean;
  onEdit: (edit: (node: AdvancedFilterNode) => AdvancedFilterNode[]) => void;
}) {
  const { t } = useT("issues");
  const labels = useFilterFieldLabels();
  // A stored condition on a field this surface hides still renders, so it
  // can be seen and removed.
  const fieldItems = (fields.includes(condition.field) ? fields : [...fields, condition.field]).map(
    (field) => ({ value: field, label: labels[field] }),
  );
  const operatorItems = [
    { value: "is", label: t(($) => $.filters.operator_is) },
    { value: "is_not", label: t(($) => $.filters.operator_is_not) },
  ];
  const update = (patch: Partial<AdvancedFilterCondition>) =>
    onEdit((node) => [{ ...(node as AdvancedFilterCondition), ...patch }]);
  const FieldIcon = FILTER_FIELD_ICONS[condition.field];
  return (
    <>
      <Select
        items={fieldItems}
        value={condition.field}
        onValueChange={(next) => {
          if (next && next !== condition.field) {
            update({ field: next as NegatableFilterDimension, values: [], negated: false });
          }
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={t(($) => $.filters.advanced_field_label)}
          className={cn(ROW_SELECT_CLASS, "w-36 shrink-0")}
        >
          <FieldIcon className="size-3.5 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">
          {fieldItems.map((item) => {
            const Icon = FILTER_FIELD_ICONS[item.value];
            return (
              <SelectItem key={item.value} value={item.value} className="text-caption">
                <Icon className="size-3.5 text-muted-foreground" />
                {item.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <Select
        items={operatorItems}
        value={condition.negated ? "is_not" : "is"}
        onValueChange={(next) => update({ negated: next === "is_not" })}
      >
        <SelectTrigger
          size="sm"
          aria-label={t(($) => $.filters.operator_label)}
          className={cn(ROW_SELECT_CLASS, "w-20 shrink-0")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">
          {operatorItems.map((item) => (
            <SelectItem key={item.value} value={item.value} className="text-caption">
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ValuePicker condition={condition} catalog={catalog} onChange={(values) => update({ values })} />
      <RowActions>
        <DropdownMenuItem
          disabled={!canAdd}
          onClick={() =>
            onEdit((node) => [
              node,
              createFilterCondition(condition.field, [...condition.values], condition.negated),
            ])
          }
        >
          {t(($) => $.filters.advanced_duplicate)}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onEdit(() => [])}>
          {t(($) => $.filters.advanced_delete)}
        </DropdownMenuItem>
      </RowActions>
    </>
  );
}

function AddButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-caption text-muted-foreground" {...props}>
      <Plus className="size-3.5" />
      {children}
    </Button>
  );
}

/**
 * The advanced filter: a rule list with "all" / "any" and one level of
 * groups, edited in place on the view store. Edits apply live, like the
 * simple menu; rows without values filter nothing until they get one.
 */
export function AdvancedFilterPanel({
  fields,
}: {
  /** Fields the surface offers; a scope that fixes one leaves it out. */
  fields: readonly NegatableFilterDimension[];
}) {
  const { t } = useT("issues");
  const stored = useViewStore((s) => s.advancedFilter);
  const setAdvancedFilter = useViewStore((s) => s.setAdvancedFilter);
  const exitAdvancedFilter = useViewStore((s) => s.exitAdvancedFilter);
  const emptyRoot = useMemo(() => createFilterGroup(), []);
  const root = stored ?? emptyRoot;
  const catalog = useFilterValueCatalog(true);
  const canAdd = advancedFilterConditionSlots(root) < ADVANCED_FILTER_MAX_CONDITIONS;
  const representable = simpleFromAdvancedFilter(root) !== null;

  const edit = (id: string) => (fn: (node: AdvancedFilterNode) => AdvancedFilterNode[]) =>
    setAdvancedFilter(editAdvancedFilter(root, id, fn));
  const append = (groupId: string, node: AdvancedFilterNode) =>
    edit(groupId)((group) => [
      { ...(group as AdvancedFilterGroup), children: [...(group as AdvancedFilterGroup).children, node] },
    ]);
  const setMatch = (groupId: string) => (match: "all" | "any") =>
    edit(groupId)((group) => [{ ...(group as AdvancedFilterGroup), match }]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        <ListTree className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{t(($) => $.filters.advanced_title)}</span>
        <span className="ml-2 text-caption text-muted-foreground">
          {t(($) => $.filters.advanced_match_leading)}
        </span>
        <MatchSelect value={root.match} onChange={setMatch(root.id)} />
        <span className="text-caption text-muted-foreground">
          {t(($) => $.filters.advanced_match_trailing)}
        </span>
      </div>

      <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto px-3 py-1">
        {root.children.length === 0 && (
          <p className="py-3 text-caption text-muted-foreground">{t(($) => $.filters.advanced_empty)}</p>
        )}
        {root.children.map((child, index) => (
          <div key={child.id} className="flex items-start gap-1.5" data-testid="advanced-filter-row">
            <RowConnector index={index} group={root} editable={false} onMatchChange={setMatch(root.id)} />
            {child.type === "condition" ? (
              <ConditionRow
                condition={child}
                fields={fields}
                catalog={catalog}
                canAdd={canAdd}
                onEdit={edit(child.id)}
              />
            ) : (
              <div
                className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-2"
                data-testid="advanced-filter-group"
              >
                {child.children.map((grandchild, inner) =>
                  grandchild.type === "condition" ? (
                    <div key={grandchild.id} className="flex items-start gap-1.5">
                      <RowConnector
                        index={inner}
                        group={child}
                        editable
                        onMatchChange={setMatch(child.id)}
                      />
                      <ConditionRow
                        condition={grandchild}
                        fields={fields}
                        catalog={catalog}
                        canAdd={canAdd}
                        onEdit={edit(grandchild.id)}
                      />
                    </div>
                  ) : null,
                )}
                <div className="flex items-center justify-between">
                  <FieldPickerMenu
                    fields={fields}
                    trigger={<AddButton disabled={!canAdd}>{t(($) => $.filters.advanced_add_condition)}</AddButton>}
                    onPick={(field) => append(child.id, createFilterCondition(field))}
                  />
                  <RowActions>
                    <DropdownMenuItem variant="destructive" onClick={() => edit(child.id)(() => [])}>
                      {t(($) => $.filters.advanced_delete_group)}
                    </DropdownMenuItem>
                  </RowActions>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5">
        <FieldPickerMenu
          fields={fields}
          trigger={<AddButton disabled={!canAdd}>{t(($) => $.filters.advanced_add_condition)}</AddButton>}
          onPick={(field) => append(root.id, createFilterCondition(field))}
        />
        <FieldPickerMenu
          fields={fields}
          trigger={<AddButton disabled={!canAdd}>{t(($) => $.filters.advanced_add_group)}</AddButton>}
          onPick={(field) =>
            append(
              root.id,
              // A group is usually the other word: "and" rules holding an "or".
              createFilterGroup(root.match === "all" ? "any" : "all", [createFilterCondition(field)]),
            )
          }
        />
      </div>

      <div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-caption"
          disabled={!representable}
          onClick={exitAdvancedFilter}
        >
          {t(($) => $.filters.advanced_to_simple)}
        </Button>
        {!representable && (
          <span className="min-w-0 truncate text-caption text-muted-foreground" title={t(($) => $.filters.advanced_to_simple_blocked)}>
            {t(($) => $.filters.advanced_to_simple_blocked)}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 shrink-0 px-2 text-caption text-muted-foreground"
          disabled={root.children.length === 0}
          onClick={() => setAdvancedFilter(createFilterGroup(root.match))}
        >
          {t(($) => $.filters.advanced_clear)}
        </Button>
      </div>
    </div>
  );
}

