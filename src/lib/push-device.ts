// Remembers which push subscription this browser holds, so logging out can remove it: a
// shared shop phone must not keep getting the last person's reminders (with customer
// names in them) after they log out. Kept out of the "use server" actions file, which
// may export async functions only.
export const PUSH_COOKIE = "push-endpoint";
