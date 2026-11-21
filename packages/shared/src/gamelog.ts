/**
 * v1.9 对局日志：把引擎事件流翻译成可读的日志条目（纯函数，客户端 / 观战 / 回放共用，单测覆盖）。
 * 日志不进引擎状态：对局内由客户端按事件顺序累积；回放与观战重放同一事件流即得同样的日志。
 */
import { boardOf } from './board';
import { GLOBAL_EVENTS, ITEMS, ZONES } from './config';
import { CHARACTERS } from './characters';
import type { GameEvent, GameState } from './types';

export type LogCat = 'turn' | 'roll' | 'trade' | 'money' | 'use' | 'auction' | 'misc';
export const LOG_CATS: { id: LogCat; name: string }[] = [
  { id: 'roll', name: '掷骰' }, { id: 'trade', name: '地产' }, { id: 'money', name: '收支' },
  { id: 'use', name: '道具技能' }, { id: 'auction', name: '竞拍' }, { id: 'misc', name: '事件' },
];

export interface LogEntry {
  round: number;
  /** 主体玩家座位；全局事件为 -1 */
  seat: number;
  cat: LogCat;
  text: string;
}

const LV = ['空地', '别墅', '公寓', '酒店', '地标'];
const REASON: Record<string, string> = { toll: '过路费', tax: '税费', fine: '罚款', takeover: '收购款', birthday: '生日礼金' };

/** 一条事件对应的日志；不值得记的（移动路径、提示、放弃）返回 null */
export function logOf(s: GameState, e: GameEvent, round: number): LogEntry | null {
  const n = (i: number) => s.seats[i]?.name ?? `玩家${i + 1}`;
  const t = (i: number) => boardOf(s).tiles[i]?.name ?? `格${i}`;
  const mk = (seat: number, cat: LogCat, text: string): LogEntry => ({ round, seat, cat, text });
  switch (e.t) {
    case 'turn': return mk(e.seat, 'turn', `${n(e.seat)} 的回合`);
    case 'roll': return mk(e.seat, 'roll', `掷出 ${e.dice[0]}+${e.dice[1]}=${e.dice[0] + e.dice[1]}，瞄准 ${ZONES[e.zone].lo}–${ZONES[e.zone].hi} ${e.hit ? '命中' : '未命中'}`);
    case 'doubles': return mk(e.seat, 'roll', `掷出双数（第 ${e.count} 次）`);
    case 'island': return mk(e.seat, 'misc', `漂流到无人岛，停留 ${e.turns} 回合`);
    case 'islandStay': return mk(e.seat, 'misc', `留在无人岛，剩余 ${e.left} 回合`);
    case 'islandEscape': return mk(e.seat, 'misc', '掷出双数，逃离无人岛');
    case 'special': return mk(e.seat, 'misc', e.kind === 'bonus' ? `踩中奖金格，领取 ¥${e.amount} 万` : `踩中传送门，传送到${t(e.to!)}`);
    case 'salary': return mk(e.seat, 'money', `经过起点，月薪 +¥${e.amount} 万`);
    case 'pay': {
      const to = e.to == null ? '银行' : n(e.to);
      return mk(e.from, 'money', `支付${REASON[e.reason] ?? '款项'} ¥${e.amount} 万给 ${to}${e.tile != null ? `（${t(e.tile)}）` : ''}`);
    }
    case 'shieldUsed': return mk(e.seat, 'use', `护盾生效，免付 ${t(e.tile)} 过路费`);
    case 'taxFreeUsed': return mk(e.seat, 'use', '免税卡生效，免缴税费');
    case 'frozen': return mk(e.by, 'use', `冻结了 ${n(e.seat)}，其下回合跳过`);
    case 'frozenSkip': return mk(e.seat, 'misc', '被冻结，本回合跳过');
    case 'swap': return mk(e.seat, 'use', `与 ${n(e.with)} 交换位置`);
    case 'buy': return mk(e.seat, 'trade', `购买 ${t(e.tile)}${e.lv > 0 ? `并建成${LV[e.lv]}` : ''}，花费 ¥${e.cost} 万`);
    case 'upgrade': return mk(e.seat, 'trade', `${t(e.tile)} 升级为${LV[e.lv]}${e.cost ? `，花费 ¥${e.cost} 万` : '（免费）'}`);
    case 'takeover': return mk(e.seat, 'trade', `${e.cost ? `收购` : '强制收购'} ${n(e.from)} 的 ${t(e.tile)}${e.cost ? `，支付 ¥${e.cost} 万` : ''}`);
    case 'takeoverShort': return mk(e.seat, 'trade', `想收购 ${t(e.tile)}，但现金不足（需 ¥${e.cost} 万，现有 ¥${e.cash} 万）`);
    case 'sell': return mk(e.seat, 'trade', `变卖 ${t(e.tile)}，得款 ¥${e.amount} 万`);
    case 'mortgage': return mk(e.seat, 'trade', `抵押 ${t(e.tile)}，得款 ¥${e.amount} 万`);
    case 'redeem': return mk(e.seat, 'trade', `赎回 ${t(e.tile)}，支付 ¥${e.cost} 万`);
    case 'demolish': return mk(e.seat, 'use', `强拆 ${n(e.from)} 的 ${t(e.tile)}，降为${LV[e.lv]}`);
    case 'bankrupt': return mk(e.seat, 'misc', '破产出局');
    case 'card': return mk(e.seat, 'misc', `机会卡：${e.text}`);
    case 'bonus': return mk(e.seat, 'money', `获得 ¥${e.amount} 万`);
    case 'festival': return mk(e.seat, 'misc', `在 ${t(e.tile)} 举办环球节庆`);
    case 'airport': return mk(e.seat, 'misc', '抵达环球航班，下回合可起飞');
    case 'itemGained': return mk(e.seat, 'use', `获得道具「${ITEMS[e.item].name}」`);
    case 'itemUsed': return mk(e.seat, 'use', `使用道具「${ITEMS[e.item].name}」`);
    case 'shopBuy': return mk(e.seat, 'use', `在商店购买「${ITEMS[e.item].name}」，花费 ¥${e.cost} 万`);
    case 'skillUsed': return mk(e.seat, 'use', `发动技能「${e.text}」（${CHARACTERS[e.charId].name}）`);
    case 'roadblockPlaced': return mk(e.seat, 'use', `在 ${t(e.tile)} 放置路障`);
    case 'roadblockHit': return mk(e.seat, 'misc', `在 ${t(e.tile)} 撞上 ${n(e.owner)} 的路障`);
    case 'globalEvent': return mk(-1, 'misc', e.id === 'none' ? '全局事件结束' : `全局事件：${GLOBAL_EVENTS[e.id].name}（${GLOBAL_EVENTS[e.id].desc}）`);
    case 'auctionStart': return mk(e.seat, 'auction', `放弃购买 ${t(e.tile)}，开启竞拍（起拍 ¥${e.start} 万）`);
    case 'auctionBid': return mk(e.seat, 'auction', `竞拍 ${t(e.tile)} 出价 ¥${e.amount} 万`);
    case 'auctionPass': return mk(e.seat, 'auction', `放弃竞拍 ${t(e.tile)}`);
    case 'auctionWin': return mk(e.seat, 'auction', `以 ¥${e.amount} 万拍得 ${t(e.tile)}`);
    case 'auctionFail': return mk(-1, 'auction', `${t(e.tile)} 流拍`);
    case 'end': return mk(e.winner, 'misc', `对局结束，${n(e.winner)} 获胜`);
    default: return null; // move / prompt / decline
  }
}
