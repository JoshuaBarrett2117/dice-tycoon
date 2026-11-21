import type { CharId } from './characters';
import type { GlobalEventId, BoardId } from './config';

export type Phase = 'roll' | 'choose' | 'ended';
export type WinReason = 'triple' | 'line' | 'tour' | 'bankrupt' | 'assets';

export interface PlayerState {
  seat: number;
  id: string;
  name: string;
  charId: CharId;
  isBot: boolean;
  /** 机器人难度（缺省 = 普通；只影响 bot.ts 的决策，不进规则） */
  difficulty?: BotDifficulty;
  /** 透传的账号标识（引擎不校验、不参与规则） */
  accountId?: string;
  cash: number;
  pos: number;
  /** >0 表示在无人岛上，剩余停留回合 */
  islandTurns: number;
  /** 本回合已连续掷出双数次数 */
  doubles: number;
  bankrupt: boolean;
  /** 下回合可从环球航班起飞 */
  flyNext: boolean;
  /** 免过路费护盾（机会卡） */
  shield: boolean;
  /** 手牌（道具卡），上限 RULES.itemMax */
  items: ItemId[];
  /** 主动技能剩余冷却（自己的回合数），0 = 可用 */
  skillCd: number;
  /** 双倍收租卡：至自己下回合开始前，收取的过路费 ×RULES.doubleTollMult */
  doubleToll: boolean;
  /** 铁算盘「金算盘」：至自己下回合开始前，过路费 ×RULES.wangSkillToll */
  wangToll: boolean;
  /** 小狸「闪电收购」：下一次收购价 ×RULES.liSkillTakeover */
  liDiscount: boolean;
  /** 阿星「完美预判」：下一次掷骰必定命中所选区间 */
  xingPerfect: boolean;
  /** 遥控骰子：下一次掷骰的指定总点数 */
  forcedSum: number | null;
  /** 机会卡「双倍月薪」：下一次经过起点的月薪 ×RULES.doubleSalaryMult */
  doubleSalary: boolean;
  /** v0.8 免税卡：下次停在税务局免缴一次（可选，旧快照缺省视为 false） */
  taxFree?: boolean;
  /** v0.8 冻结卡：下一个自己回合整体跳过（可选，缺省视为 false） */
  frozen?: boolean;
}

export type ItemId = 'forceBuy' | 'dice' | 'roadblock' | 'shield' | 'doubleToll' | 'demolish' | 'freeBuild' | 'teleport' | 'swap' | 'taxFree' | 'freeze';

export interface Roadblock { tile: number; owner: number }

export interface TileState {
  owner: number | null;
  /** 0 空地 / 1 别墅 / 2 公寓 / 3 酒店 / 4 地标（观光地恒为 0） */
  lv: number;
  /** 抵押中：不收过路费、不可升级 / 收购 / 强拆，且不计入独占胜利与色组加成 */
  mortgaged: boolean;
}

export type PendingKind = 'buy' | 'upgrade' | 'takeover' | 'festival' | 'fly' | 'item' | 'auction';

/** 竞拍状态：放弃购买后由其余玩家轮流出价（回合制，无计时器，托管 / 机器人可推进） */
export interface AuctionState {
  tile: number;
  /** 放弃购买的玩家（仍是回合玩家） */
  starter: number;
  /** 起拍价（万） */
  start: number;
  /** 当前最高价；无人出价时为 0 */
  high: number;
  highSeat: number | null;
  /** 参与竞拍的座位（按座位顺序，从放弃者的下家开始） */
  order: number[];
  /** 已弃拍（或现金不足无法出价）的座位 */
  out: number[];
}

export interface PendingOption {
  /** buy/upgrade：目标等级；takeover：1；festival/fly：目标格子 */
  value: number;
  cost: number;
  label: string;
}

export interface Pending {
  kind: PendingKind;
  /** kind='item'：正在选目标的道具 */
  item?: ItemId;
  /** kind='auction'：竞拍进度；此时 seat 是当前出价人，而不是回合玩家 */
  auction?: AuctionState;
  seat: number;
  tile: number | null;
  options: PendingOption[];
  /** 选择后是否还要继续掷骰（双数） */
  again: boolean;
}

/** 当前生效的全局经济事件；untilRound 为最后生效的回合（含） */
export interface GlobalEventState { id: Exclude<GlobalEventId, 'none'>; untilRound: number }

export interface GameState {
  /** 2 = v0.2（新增 globalEvent / doubleSalary 等）；旧快照用 migrateState 升级 */
  version: 2;
  /** v0.7：本局启用特殊格（传送 / 奖金）；旧快照无此字段视为 false */
  specials?: boolean;
  /** v1.1：棋盘 id；缺省 = 经典棋盘（旧快照 / 旧回放兼容） */
  board?: BoardId;
  /** v1.9：收购扩展（地标/观光地/抵押格）、对局商店、强制收购卡稀有掉落；旧快照 / 旧回放无此字段，沿用旧规则 */
  v19?: boolean;
  /** v0.8：道具抽取池含换位 / 免税 / 冻结；旧快照与旧回放无此字段，沿用 7 种旧池以保证重放一致 */
  itemsV8?: boolean;
  seed: number;
  rng: number;
  /** 每次合法操作 +1，客户端据此丢弃过期快照 */
  seq: number;
  seats: PlayerState[];
  tiles: TileState[];
  turn: number;
  round: number;
  maxRounds: number;
  phase: Phase;
  pending: Pending | null;
  festivalTile: number | null;
  /** 全局经济事件（无事件时为 null） */
  globalEvent: GlobalEventState | null;
  /** 场上的路障 */
  roadblocks: Roadblock[];
  winner: number | null;
  winReason: WinReason | null;
}

export type Action =
  | { type: 'roll'; zone: number }
  /** option = pending.options 下标；-1 表示放弃 */
  | { type: 'choose'; option: number }
  /** 掷骰前使用道具；需要目标的道具若不带 target 则进入 pending(kind='item') 选目标。dice 的 target 为总点数 2–12，其余为格子序号 */
  | { type: 'useItem'; item: ItemId; target?: number }
  /** 掷骰前使用角色主动技能 */
  | { type: 'useSkill' }
  /** 掷骰前抵押自己的一处地产，得款 = 已投入总价 × RULES.mortgageRatio */
  | { type: 'mortgage'; tile: number }
  /** 掷骰前赎回抵押中的地产，赎回价 = 抵押得款 × RULES.redeemMult */
  | { type: 'redeem'; tile: number }
  /** v1.9 对局商店：自己回合掷骰阶段用现金购买一张道具（手牌满 / 现金不足拒绝） */
  | { type: 'buyItem'; item: ItemId };

export type CardId =
  | 'bonus' | 'fine' | 'toStart' | 'island' | 'freeUpgrade' | 'shield'
  | 'birthday' | 'forward' | 'back' | 'itemSupply' | 'taxRefund' | 'doubleSalary';

/** 引擎输出的事件流：客户端按顺序播放动画，服务端原样广播 */
export type GameEvent =
  | { t: 'turn'; seat: number; round: number }
  | { t: 'roll'; seat: number; zone: number; dice: [number, number]; hit: boolean }
  | { t: 'move'; seat: number; path: number[]; via: 'walk' | 'fly' | 'warp' }
  | { t: 'special'; seat: number; tile: number; kind: 'teleport' | 'bonus'; to?: number; amount?: number }
  | { t: 'salary'; seat: number; amount: number }
  | { t: 'doubles'; seat: number; count: number }
  | { t: 'island'; seat: number; turns: number }
  | { t: 'islandStay'; seat: number; left: number }
  | { t: 'islandEscape'; seat: number }
  | { t: 'pay'; from: number; to: number | null; amount: number; tile: number | null; reason: 'toll' | 'tax' | 'fine' | 'takeover' | 'birthday' }
  | { t: 'shieldUsed'; seat: number; tile: number }
  | { t: 'taxFreeUsed'; seat: number; tile: number }
  | { t: 'frozen'; seat: number; by: number }
  | { t: 'frozenSkip'; seat: number }
  | { t: 'swap'; seat: number; with: number }
  | { t: 'buy'; seat: number; tile: number; lv: number; cost: number }
  | { t: 'upgrade'; seat: number; tile: number; from: number; lv: number; cost: number }
  | { t: 'takeover'; seat: number; from: number; tile: number; cost: number }
  | { t: 'takeoverShort'; seat: number; tile: number; cost: number; cash: number }
  | { t: 'shopBuy'; seat: number; item: ItemId; cost: number }
  | { t: 'sell'; seat: number; tile: number; amount: number }
  | { t: 'bankrupt'; seat: number }
  | { t: 'card'; seat: number; card: CardId; text: string }
  | { t: 'bonus'; seat: number; amount: number }
  | { t: 'festival'; seat: number; tile: number }
  | { t: 'airport'; seat: number }
  | { t: 'itemGained'; seat: number; item: ItemId }
  | { t: 'itemUsed'; seat: number; item: ItemId; target: number | null }
  | { t: 'skillUsed'; seat: number; charId: CharId; text: string }
  | { t: 'roadblockPlaced'; seat: number; tile: number }
  | { t: 'roadblockHit'; seat: number; owner: number; tile: number }
  | { t: 'demolish'; seat: number; from: number; tile: number; lv: number }
  | { t: 'globalEvent'; id: GlobalEventId; round: number }
  | { t: 'auctionStart'; seat: number; tile: number; start: number }
  | { t: 'auctionBid'; seat: number; tile: number; amount: number }
  | { t: 'auctionPass'; seat: number; tile: number }
  | { t: 'auctionWin'; seat: number; tile: number; amount: number }
  | { t: 'auctionFail'; tile: number }
  | { t: 'mortgage'; seat: number; tile: number; amount: number }
  | { t: 'redeem'; seat: number; tile: number; cost: number }
  | { t: 'prompt'; pending: Pending }
  | { t: 'decline'; seat: number; kind: string }
  | { t: 'end'; winner: number; reason: WinReason };

export interface ApplyOk { ok: true; state: GameState; events: GameEvent[] }
export interface ApplyErr { ok: false; error: string }
export type ApplyResult = ApplyOk | ApplyErr;

/** accountId：预留给后续业务服的账号标识，引擎与对战服只透传、不校验 */
export type BotDifficulty = 'easy' | 'normal' | 'hard';
export interface SeatConfig { id: string; name: string; charId: CharId; isBot?: boolean; accountId?: string; difficulty?: BotDifficulty }
export interface GameConfig { seed: number; seats: SeatConfig[]; maxRounds?: number; /** v0.7 特殊格；缺省 false（旧回放兼容） */ specials?: boolean; /** v0.8 新道具池；缺省 false（旧回放兼容） */ itemsV8?: boolean; /** v1.9 收购扩展 / 商店 / 强制收购卡；缺省 false（旧回放兼容） */ v19?: boolean; /** v1.1 棋盘 id；缺省 = 经典 */ board?: BoardId }
