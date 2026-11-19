import { totalAssets, type GameState } from '@dt/shared';

/**
 * v1.3 对局结算上报：对战服只把「谁拿了第几名」发给业务服，段位分/奖励的计算都在业务服（Go）。
 * - 只上报带有效票据的真人（匿名玩家、机器人不参与）。
 * - 需同时配置 ACCOUNT_URL 与 INTERNAL_TOKEN，否则静默跳过。失败只记日志，不影响对局。
 */
export interface PlaceResult { accountId: string; place: number; char: string }

/** 名次：赢家第 1；其余未破产者在前、按总资产降序；破产者在后，后破产的名次更靠前（无记录则按座位号）。 */
export function computePlaces(g: GameState): number[] {
  const n = g.seats.length;
  const order = g.seats.map((p, i) => i).sort((a, b) => {
    if (a === g.winner) return -1;
    if (b === g.winner) return 1;
    const ba = g.seats[a].bankrupt, bb = g.seats[b].bankrupt;
    if (ba !== bb) return ba ? 1 : -1;
    const d = totalAssets(g, b) - totalAssets(g, a);
    return d !== 0 ? d : a - b;
  });
  const places = new Array<number>(n).fill(0);
  order.forEach((seat, k) => { places[seat] = k + 1; });
  return places;
}

export function buildResults(g: GameState, accountOfSeat: (seat: number) => string | undefined): PlaceResult[] {
  const places = computePlaces(g);
  const out: PlaceResult[] = [];
  g.seats.forEach((p, i) => {
    const id = accountOfSeat(i);
    if (!id || p.isBot) return;
    out.push({ accountId: id, place: Math.min(places[i], 4), char: p.charId });
  });
  return out;
}

export async function postSettle(matchId: string, results: PlaceResult[], log: (m: string) => void = console.error): Promise<boolean> {
  const base = (process.env.ACCOUNT_URL || '').replace(/\/$/, '');
  const token = process.env.INTERNAL_TOKEN || '';
  if (!base || !token || results.length === 0) return false;
  try {
    const r = await fetch(`${base}/internal/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchId, results }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { log(`[settle] 业务服返回 ${r.status} match=${matchId}`); return false; }
    return true;
  } catch (e) {
    log(`[settle] 上报失败 match=${matchId}: ${(e as Error).message}`);
    return false;
  }
}
