import { cache } from "react";
import { db } from "@/lib/db";

// The signed-in person's name, for the avatar in the top bar and the Today greeting.
// Kept out of SessionUser: the session is read on every request, the name only on screens.
export const staffName = cache(async (userId: string): Promise<string> => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return user?.fullName ?? "";
});
