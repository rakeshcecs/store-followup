// Moving one row of a sortable list. Kept apart from the screen because it is the only
// part of a drag that can be tested honestly: dnd-kit needs real layout boxes, and jsdom
// reports every element as 0x0, so a "drag" there proves nothing.
export function reorderedIds(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return ids;

  const moved = [...ids];
  const [row] = moved.splice(from, 1);
  moved.splice(to, 0, row as string);
  return moved;
}
