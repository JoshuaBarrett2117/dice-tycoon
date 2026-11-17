import type { RoomBrief } from '@dt/shared';

/** 进程内的房间登记：GET /api/rooms 据此列出可观战的房间（不走 Colyseus 的公开房间查询，因为开局后房间是 private 的） */
const rooms = new Map<string, () => RoomBrief | null>();

export const registry = {
  add(id: string, brief: () => RoomBrief | null) { rooms.set(id, brief); },
  remove(id: string) { rooms.delete(id); },
  list(): RoomBrief[] {
    return [...rooms.values()].map((f) => f()).filter((x): x is RoomBrief => !!x)
      .sort((a, b) => Number(b.spectatable) - Number(a.spectatable) || a.roomId.localeCompare(b.roomId));
  },
};
