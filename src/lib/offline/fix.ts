// M19 "Needs your attention": what each button does to the outbox. Every fix puts the
// entry back in the queue; the caller then syncs.
import { putOutboxEntry, readOutbox, removeFromOutbox } from "@/lib/offline/store";
import type { OutboxEntry } from "@/lib/offline/types";
import { dependentsOf } from "@/lib/offline/view";

const again = (entry: OutboxEntry): OutboxEntry => ({
  ...entry,
  status: "waiting",
  problem: undefined,
});

// Throws the entry away, and whatever cannot be sent without it.
export async function discardEntry(id: string): Promise<void> {
  const outbox = await readOutbox();
  await removeFromOutbox([id, ...dependentsOf(outbox, id).map((entry) => entry.id)]);
}

// "Use existing customer": the number belongs to someone already, so the visits and
// follow-ups saved for the new customer go to them instead, and the new one is dropped.
export async function moveToExistingCustomer(id: string, existingId: string): Promise<void> {
  const outbox = await readOutbox();
  for (const entry of outbox) {
    if (entry.input["customerId"] !== id) continue;
    await putOutboxEntry(again({ ...entry, input: { ...entry.input, customerId: existingId } }));
  }
  await removeFromOutbox([id]);
}

// "Change bill number" (BR-07): the same sale under a number not used in the branch.
export async function changeBillNumber(id: string, billNumber: string): Promise<void> {
  const entry = (await readOutbox()).find((item) => item.id === id);
  const sale = entry?.input["sale"] as Record<string, unknown> | undefined;
  if (!entry || !sale) return;
  await putOutboxEntry(
    again({
      ...entry,
      input: { ...entry.input, sale: { ...sale, billNumber: billNumber.trim().toUpperCase() } },
    }),
  );
}

// "Save anyway": the person has seen that someone else changed the follow-up.
export async function saveAnyway(id: string): Promise<void> {
  const entry = (await readOutbox()).find((item) => item.id === id);
  if (entry) await putOutboxEntry(again({ ...entry, force: true }));
}
