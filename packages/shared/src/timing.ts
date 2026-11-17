/**
 * 每种事件在客户端的动画时长（毫秒）。服务端据此等待动画播完再让机器人行动、
 * 再开始计时，保证所有客户端节奏一致。客户端动画实现应不超过这里的预算。
 */
import type { GameEvent } from './types';

export const ANIM = {
  turn: 700,
  roll: 1700,
  stepMs: 250,
  warp: 900,
  fly: 1100,
  salary: 500,
  doubles: 700,
  island: 1100,
  islandStay: 900,
  islandEscape: 800,
  pay: 1300,
  shieldUsed: 900,
  buy: 1100,
  upgrade: 1000,
  takeover: 1300,
  sell: 500,
  bankrupt: 1500,
  card: 1400,
  bonus: 600,
  festival: 1000,
  airport: 1000,
  itemGained: 600,
  itemUsed: 900,
  skillUsed: 1000,
  roadblockPlaced: 800,
  roadblockHit: 1000,
  demolish: 1000,
  globalEvent: 800,
  auctionStart: 900,
  auctionBid: 800,
  auctionPass: 500,
  auctionWin: 1000,
  auctionFail: 700,
  mortgage: 800,
  redeem: 800,
  prompt: 0,
  decline: 150,
  end: 0,
} as const;

export function animBudget(events: GameEvent[]): number {
  let ms = 0;
  for (const e of events) {
    if (e.t === 'move') ms += e.via === 'walk' ? e.path.length * ANIM.stepMs + 300 : e.via === 'fly' ? ANIM.fly : ANIM.warp;
    else ms += ANIM[e.t];
  }
  return ms;
}
