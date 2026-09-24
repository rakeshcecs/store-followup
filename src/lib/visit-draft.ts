// The Record visit screen's draft (M07). "Yes, bought" and "No, decide later" do not save
// anything: the visit is kept here and sent together with the sale (M10) or the
// follow-up (M08) in one call, so a visit can never exist without them (BR-03, BR-04).
//
// sessionStorage, per person and customer: it lives as long as the tab, which is what "the draft is
// kept for that screen session" asks for. Every access can throw (private mode, blocked
// storage), and then there is simply no draft. The person is part of the key because
// shops share phones: whoever signs in next on the same tab must not get someone
// else's half-recorded visit.

export type VisitDraft = {
  userId: string;
  clientId: string;
  customerId: string;
  categoryIds: string[];
  expectedPurchase?: string;
  remarks?: string;
  outcome: "PURCHASED" | "DECIDE_LATER";
};

const PREFIX = "visit-draft:";
const key = (userId: string, customerId: string) => `${PREFIX}${userId}:${customerId}`;

// The stored text, not the parsed object: useSyncExternalStore compares snapshots by
// identity, and the same string is the same snapshot, where a fresh object never is.
export function readVisitDraftRaw(userId: string, customerId: string): string | null {
  try {
    return window.sessionStorage.getItem(key(userId, customerId));
  } catch {
    return null;
  }
}

export function parseVisitDraft(
  raw: string | null,
  userId: string,
  customerId: string,
): VisitDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as VisitDraft;
    return draft.userId === userId &&
      draft.customerId === customerId &&
      Array.isArray(draft.categoryIds)
      ? draft
      : null;
  } catch {
    return null;
  }
}

export function readVisitDraft(userId: string, customerId: string): VisitDraft | null {
  return parseVisitDraft(readVisitDraftRaw(userId, customerId), userId, customerId);
}

export function writeVisitDraft(draft: VisitDraft): boolean {
  try {
    window.sessionStorage.setItem(key(draft.userId, draft.customerId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearVisitDraft(userId: string, customerId: string): void {
  try {
    window.sessionStorage.removeItem(key(userId, customerId));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

// Update follow-up's note, carried to the Sale screen when the customer "already bought"
// (M09.07): the follow-up is saved with the sale, so its note waits here until then.
// Same rules as the visit draft: per person, per tab, gone at the login screen.
const NOTE_PREFIX = "followup-note:";
const noteKey = (userId: string, followUpId: string) => `${NOTE_PREFIX}${userId}:${followUpId}`;

export function writeFollowUpNote(userId: string, followUpId: string, note: string): void {
  try {
    if (note) window.sessionStorage.setItem(noteKey(userId, followUpId), note);
    else window.sessionStorage.removeItem(noteKey(userId, followUpId));
  } catch {
    // Without storage the note is simply not carried across.
  }
}

export function readFollowUpNote(userId: string, followUpId: string): string | null {
  try {
    return window.sessionStorage.getItem(noteKey(userId, followUpId));
  } catch {
    return null;
  }
}

export function clearFollowUpNote(userId: string, followUpId: string): void {
  try {
    window.sessionStorage.removeItem(noteKey(userId, followUpId));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

// "Data kept on the phone is cleared on log out and when a user is deactivated" (SOW M19;
// NFR: no customer data on the phone beyond the current screen). Both end on the login
// screen — log out goes there, and a deactivated person's next request is sent there —
// so the login screen calls this and every half-recorded visit on the tab is gone.
export function clearAllVisitDrafts(): void {
  try {
    const storage = window.sessionStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      if (name?.startsWith(PREFIX) || name?.startsWith(NOTE_PREFIX)) keys.push(name);
    }
    for (const name of keys) storage.removeItem(name);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
