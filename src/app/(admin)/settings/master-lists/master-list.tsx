"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  createItem,
  deleteItem,
  renameItem,
  reorderItems,
  setItemActive,
} from "@/app/(admin)/settings/master-lists/actions";
import { SortableRow } from "@/app/(admin)/settings/master-lists/sortable-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { TextInput } from "@/components/ui/text-input";
import { toast } from "@/components/ui/toast";
import { useActionForm } from "@/hooks/use-action-form";
import { useErrorMessage } from "@/hooks/use-error-message";
import { localizedName } from "@/lib/localized-name";
import { ALL_BRANCHES } from "@/lib/permissions";
import { reorderedIds } from "@/lib/reorder";
import { createItemInput, renameItemInput, type ListKind } from "@/lib/validation/master-list";

export type MasterListRow = {
  id: string;
  nameEn: string;
  nameHi: string;
  nameGu: string;
  active: boolean;
  branchId: string | null;
  usageCount: number;
};

type MasterListProps = {
  kind: ListKind;
  items: MasterListRow[];
  // Empty for the reasons list, which has no branch column in the schema.
  branches: { id: string; name: string }[];
};

// Both master lists (SOW M04). They differ only in the branch select, so one component
// serves both rather than two files that drift apart.
export function MasterList({ kind, items, branches }: MasterListProps) {
  const t = useTranslations("masterLists");
  const tError = useErrorMessage();
  const locale = useLocale();
  const [order, setOrder] = useState(items);
  const [editing, setEditing] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Keyboard sensor as well as pointer: a list you can only reorder with a mouse cannot
  // be reordered on a keyboard at all.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The list comes from the server on every render; this keeps it in step after a save.
  if (items !== order && items.map((i) => i.id).join() !== order.map((i) => i.id).join()) {
    setOrder(items);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = reorderedIds(
      order.map((item) => item.id),
      String(active.id),
      String(over.id),
    );
    const byId = new Map(order.map((item) => [item.id, item]));
    const moved = ids.map((id) => byId.get(id)!);
    const previous = order;

    // Moves under the finger immediately; the server owns sortOrder 1..n.
    setOrder(moved);
    startTransition(async () => {
      const result = await reorderItems({ kind, ids });
      if (!result.ok) {
        setOrder(previous); // put it back where it was rather than lie about the order
        toast.error(tError(result.message, result.values));
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <ItemForm kind={kind} branches={branches} onSaved={() => setEditing(null)} />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={order.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-2.5">
            {order.map((item) => (
              <SortableRow key={item.id} id={item.id} dragLabel={t("dragHandle")}>
                {editing === item.id ? (
                  <ItemForm
                    kind={kind}
                    branches={branches}
                    item={item}
                    onSaved={() => setEditing(null)}
                  />
                ) : (
                  <ItemRow
                    kind={kind}
                    item={item}
                    branches={branches}
                    locale={locale}
                    onEdit={() => setEditing(item.id)}
                  />
                )}
              </SortableRow>
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {order.length === 0 && (
        <Card className="p-4">
          <p className="text-muted-foreground">{t("empty")}</p>
        </Card>
      )}
    </div>
  );
}

function ItemRow({
  kind,
  item,
  branches,
  locale,
  onEdit,
}: {
  kind: ListKind;
  item: MasterListRow;
  branches: { id: string; name: string }[];
  locale: string;
  onEdit: () => void;
}) {
  const t = useTranslations("masterLists");
  const tError = useErrorMessage();
  const [pending, startTransition] = useTransition();

  const branchName = item.branchId
    ? (branches.find((branch) => branch.id === item.branchId)?.name ?? "")
    : t("allBranches");

  function toggleActive() {
    startTransition(async () => {
      const result = await setItemActive({ kind, id: item.id, active: !item.active });
      if (result.ok) toast(item.active ? t("deactivated") : t("activated"));
      else toast.error(tError(result.message, result.values));
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteItem({ kind, id: item.id });
      if (result.ok) toast(t("deleted"));
      else toast.error(tError(result.message, result.values));
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading-style text-lg">
            {localizedName(item, locale as "en" | "hi" | "gu")}
          </p>
          <p className="text-sm text-muted-foreground">
            {branches.length > 0 ? `${branchName} · ` : ""}
            {t("usage", { count: item.usageCount })}
          </p>
        </div>
        {!item.active && <Pill tone="grey">{t("inactive")}</Pill>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onEdit} disabled={pending}>
          <Pencil aria-hidden />
          {t("rename")}
        </Button>
        <Button variant="secondary" size="sm" onClick={toggleActive} disabled={pending}>
          {item.active ? t("deactivate") : t("activate")}
        </Button>

        {item.usageCount > 0 ? (
          // In use: deactivating is the only honest option, because deleting would take
          // the records that point at it with it. The action refuses this too.
          <p className="self-center text-sm text-muted-foreground">
            {t("cannotDelete", { count: item.usageCount })}
          </p>
        ) : (
          <ConfirmDialog
            trigger={
              <Button variant="secondary" size="sm" disabled={pending}>
                <Trash2 aria-hidden />
                {t("delete")}
              </Button>
            }
            title={t("confirmDelete.title")}
            description={t("confirmDelete.text")}
            confirmLabel={t("confirmDelete.confirm")}
            cancelLabel={t("confirmDelete.cancel")}
            danger
            onConfirm={remove}
          />
        )}
      </div>
    </div>
  );
}

function ItemForm({
  kind,
  branches,
  item,
  onSaved,
}: {
  kind: ListKind;
  branches: { id: string; name: string }[];
  item?: MasterListRow;
  onSaved: () => void;
}) {
  const t = useTranslations("masterLists");
  const tError = useErrorMessage();

  const { formAction, pending, errors, formError, errorValues } = useActionForm(
    item ? renameItem : createItem,
    item ? renameItemInput : createItemInput,
    () => {
      toast(item ? t("renamed") : t("added"));
      onSaved();
    },
  );

  const errorFor = (field: string) =>
    errors[field] ? tError(errors[field], errorValues) : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="kind" value={kind} />
      {item && <input type="hidden" name="id" value={item.id} />}

      {/* All three languages are required: a missing one would show English on a
          Gujarati screen and nobody would ever notice it was missing (SOW M18.03). */}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput
          name="nameEn"
          label={t("fields.nameEn")}
          defaultValue={item?.nameEn}
          autoComplete="off"
          error={errorFor("nameEn")}
        />
        <TextInput
          name="nameHi"
          label={t("fields.nameHi")}
          defaultValue={item?.nameHi}
          autoComplete="off"
          lang="hi"
          error={errorFor("nameHi")}
        />
        <TextInput
          name="nameGu"
          label={t("fields.nameGu")}
          defaultValue={item?.nameGu}
          autoComplete="off"
          lang="gu"
          error={errorFor("nameGu")}
        />
      </div>

      {branches.length > 0 ? (
        <Select
          name="branchId"
          label={t("fields.branch")}
          hint={t("hints.branch")}
          defaultValue={item?.branchId ?? ALL_BRANCHES}
          options={[
            { value: ALL_BRANCHES, label: t("allBranches") },
            ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
          ]}
          error={errorFor("branchId")}
        />
      ) : (
        // Reasons have no branch column; the schema decides, not the screen.
        <input type="hidden" name="branchId" value={ALL_BRANCHES} />
      )}

      <FieldError>{formError ? tError(formError, errorValues) : undefined}</FieldError>

      <div className="flex gap-2.5">
        <Button type="submit" disabled={pending} className="sm:w-auto sm:px-6">
          {item ? <Pencil aria-hidden /> : <Plus aria-hidden />}
          {item ? t("save") : t("add")}
        </Button>
        {item && (
          <Button type="button" variant="secondary" onClick={onSaved} className="sm:w-auto sm:px-6">
            {t("cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
