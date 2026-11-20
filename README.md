# 掷富天下 · 网页大富翁（v1.4）

横屏 45° 斜视棋盘的多人大富翁，手机与 PC 浏览器同一套代码。
本仓库是可运行代码：规则引擎 + 对战服 + 网页客户端，支持 **单机对战（你 vs 3 个机器人）** 和 **好友联机房间**。
**v0.2** 在 v0.1 基础上加入道具卡、角色主动技能、全局经济事件、色组连片加成、机会卡扩充、竞拍与抵押、回放导出（详见「v0.2 更新说明」）。
**v0.3** 再加入**回放播放器、观战、快速匹配**，并支持点选棋盘格选道具目标（详见「v0.3 更新说明」）。
**v1.7** 首批付费新角色「锦鲤阿棠」（月薪向，商城 500 金币，详见「v1.7 更新说明」）；**v1.6** 商城新品类：**角色外观、骰子皮肤**，并预留角色上架机制（详见「v1.6 更新说明」）；**v1.5** 商城下架全部对局道具卡，道具仅在对局内出现和使用（详见「v1.5 更新说明」）；**v1.4** 业务服存储由单文件 JSON 升级为嵌入式 SQLite（详见「v1.4 更新说明」）；**v1.3** 加入 **联机对局结算挂钩、全服排行榜 / 段位 / 赛季**（详见「v1.3 更新说明」）；**v1.2** 加入 **Go 业务服（账号 / 角色养成 / 商城）与对战服票据校验**（详见「v1.2 更新说明」）；**v1.1** 加入**第二张可玩棋盘「海岛度假」**（棋盘可选，单机与联机均可；详见「v1.1 更新说明」）；**v1.0** 加入**埋点、风控、压测**（详见「v1.0 更新说明」）；**v0.9** 做**资源与表现层升级**：首屏加载进度条、音效文件通道（OGG/M4A 懒加载，缺失回退合成音效）、道具/技能/竞拍 SVG 图标、岩盾阿岩独立立绘（详见「v0.9 更新说明」）；**v0.8** 加入**新道具 3 种（换位 / 免税 / 冻结）与第 6 名角色「岩盾阿岩」**，机器人同步补策略（详见「v0.8 更新说明」）；**v0.7** 加入**棋盘主题（经典 / 霓虹夜市）**与**特殊格（传送门 / 奖金格）**（详见「v0.7 更新说明」）；**v0.6** 加入**每日任务与成就**（局外目标，纯本地；详见「v0.6 更新说明」）；**v0.5** 加入**机器人难度分级**（简单 / 普通 / 困难）；**v0.4** 加入**本地档案与对局历史**（轻量版，无服务端；详见「v0.4 更新说明」）。

## 快速开始

需要 Node.js 20+。

```bash
npm install
npm test                 # 规则引擎单元测试（92 项，含道具 / 技能 / 全局事件 / 竞拍 / 抵押 / 回放一致性 / 回放播放器 / 观战 / 匹配队列）
npm run typecheck        # 全仓类型检查

npm run dev:server       # 终端 1：对战服 ws://localhost:2567
npm run dev              # 终端 2：客户端 http://localhost:5173
```

浏览器打开客户端 → 选角色 → 「单机对战」即可开玩；「创建房间」后把房间号发给好友加入，房主点开始，空位由机器人补齐。
操作：**按住掷骰键（或空格）蓄力，松开掷骰**；蓄力时力度条在 2–4 / 5–7 / 8–10 / 11–12 四档间往返，棋盘会点亮对应落点。
掷骰前，画面底部的**行动栏**可以：使用手牌道具、发动角色主动技能、打开「地产」面板抵押 / 赎回；需要选目标的道具（路障 / 强拆 / 免费建造 / 传送）会高亮合法格，**直接点棋盘格**即可选定（点非法格只提示、不消耗道具），也可以在右侧选择面板里选，面板上「放弃」即取消且不消耗。
其他玩家放弃购买无主地块后，轮到你时会弹出**竞拍**面板（出价或弃拍）。

**快速匹配**：主菜单点「快速匹配」，凑满 4 人立即开局；等候超过 20 秒由机器人补位开局；匹配中可随时「取消匹配」。
**观战**：主菜单「观战列表」列出进行中的房间（对战服 `GET /api/rooms`），点「观战」即可只看不操作，不占座位；每房观战席上限 8 人。
**回放**：对局结算页「导出回放 JSON」保存文件，或直接点「回放本局」；主菜单「导入回放 JSON」可播放任意回放文件。播放条支持 播放 / 暂停（空格）、单步（← →）、0.5× / 1× / 2× / 4× 调速、拖动进度条跳转到指定 seq、退出回放。

联机冒烟测试（先启动对战服）：
```bash
MATCH_TIMEOUT_MS=3000 SMOKE_SPEED=20 npm run dev:server   # 终端 1：缩短匹配超时与机器人等待（仅测试用）
SMOKE_FAST=1 npm run smoke -w @dt/server                  # 终端 2：整局打完，校验观战 / 匹配 / 回放
```
覆盖：朋友房回放导出可重放、观战者中途加入且任何操作被拒绝、观战席上限、`/api/rooms` 列表、4 人凑满开局、单人匹配取消、单人超时机器人补位并打完整局。不加环境变量也能直接 `npm run smoke -w @dt/server`（默认节奏，只校验推进与回放）。

生产构建：

```bash
npm run build                       # 客户端产物在 apps/client/dist，服务端在 apps/server/dist
PORT=2567 node apps/server/dist/index.js
```

客户端可以用 `VITE_SERVER_URL=wss://your.domain` 指定对战服地址，菜单的「服务器」里也能临时修改。

## 目录

```
packages/shared      规则引擎（前后端共享，纯 TypeScript，无依赖）
  src/board.ts         32 格棋盘、色组、观光地、四条边
  src/config.ts        全部数值（起始资金、过路费系数、建设费、收购倍数、控骰上限、蓄力区间、道具 / 技能 / 全局事件 / 竞拍 / 抵押参数）
  src/characters.ts    6 名角色：基础控骰 + 被动技能 + 主动技能
  src/engine.ts        applyAction(state, seat, action) → 新状态 + 事件流；可回放
  src/bot.ts           机器人 / 托管 AI（含道具 / 技能 / 竞拍 / 抵押启发式）
  src/replay.ts        回放记录器与重放（GameRecord / ReplayRecorder / replayGame）、回放播放器 ReplayPlayer（逐步帧、单步 / 跳转 seq）、终局名次 rankSeats
  src/matchmaking.ts   快速匹配队列 MatchQueue（纯逻辑：凑满 / 超时补位 / 取消）
  src/protocol.ts      客户端 ⇄ 服务端消息定义
  src/timing.ts        每种事件的动画时长预算（服务端据此控制节奏）
  test/                Vitest 单元测试
apps/account         Go 业务服（标准库，无第三方依赖）：注册登录 / 角色养成 / 商城 / 票据签发（ticket.go、store.go、server.go，go test）
apps/server          Colyseus 0.18 对战服（服务端权威、超时托管、掉线 30 秒重连）
  src/rooms/MatchRoom.ts  朋友房 / 快速匹配房 / 观战席
  src/ticket.ts        票据校验（HMAC-SHA256，TICKET_KEYS / TICKET_REQUIRED）
  src/registry.ts      房间登记（`GET /api/rooms` 观战列表）
  scripts/smoke.ts     联机冒烟测试（朋友房 + 观战 + 快速匹配）
  scripts/ticket-e2e.ts 票据联机校验（需业务服 + 对战服同密钥运行）
apps/client          Vite + PixiJS 8 客户端
  src/view/            斜视棋盘、棋子、建筑、镜头（Pixi）
  src/ui/Hud.ts        头像芯片、掷骰键与蓄力条、骰子、行动栏（手牌 / 技能 / 地产）、全局事件横幅、选择面板、结算（DOM）
  src/game/Director.ts 把「快照 + 事件流」播成动画，并处理本地玩家输入
  src/ui/ReplayBar.ts  回放控制条
  src/net/source.ts    单机数据源（本地引擎）/ 在线数据源（Colyseus，含快速匹配与观战）/ 回放数据源 ReplaySource
  src/audio/audio.ts   程序化合成的占位 BGM 与 24 个音效
  public/assets/       角色、四角、建筑、背景、金币
```

## 架构要点

- **服务端权威**：客户端只发意图（`roll{zone}` / `choose{option}` / `useItem` / `useSkill` / `mortgage` / `redeem`），掷骰随机数、结算、胜负全部在服务端由 `@dt/shared` 计算，客户端无法作弊改点数。
- **确定性**：随机数状态存在 `GameState.rng` 里，`seed + 操作序列` 可完整回放，用于复盘、申诉和反作弊。
- **事件驱动表现**：引擎每步输出事件流（掷骰、移动、付费、建造…），客户端 `Director` 顺序播放后再用权威快照校正，断线重连只需一份快照。
- **单机与联机同一套代码**：单机模式在浏览器里直接跑同一个引擎和机器人。
- **观战者不是玩家**：观战者只收 `sync` / `replay`，不占座位、不计入 `actorOf`，任何 `action` 都被服务端拒绝；房间开局后设为 private（不再被匹配），但观战者仍凭房间号 `joinById` 进入。
- **托管**：真人超时（掷骰 15 秒、选择 10 秒）或掉线时，由机器人代为操作；竞拍阶段由「当前出价人」（`actorOf(state)`）决定谁行动，同样适用托管。

## 已实现规则

**基础（v0.1）**：双骰 + 蓄力控骰（命中率 = 角色控骰，上限 75%）、双数再掷、三连双数进无人岛、无人岛停留 3 回合（掷双数逃脱）、经过起点领月薪、
买地并选择建造等级（别墅 / 公寓 / 酒店）、再次落地升级、酒店后升地标、付过路费、付费后 2 倍收购（地标不可收购）并可顺势加盖、
4 处观光地（过路费随持有数翻倍）、环球节庆（指定城市过路费 ×2）、环球航班（下回合飞往任意格）、税务局、
现金不足自动变卖、破产出局、三区独占 / 整排独占 / 观光地独占 / 只剩一人 / 20 回合后总资产最高 判胜。

**道具卡（v0.2）**：手牌上限 3 张；开局发 1 张，每次经过起点抽 1 张（满手牌不抽），抽取走引擎 RNG。掷骰前使用（`useItem`），需要目标的道具复用待选择机制，可取消且不消耗：
遥控骰子（指定总点数 2–12）、路障卡（自己前方 8 格内，拦停他人后消失）、护盾卡（下次过路费全免）、双倍收租卡（至自己下回合开始前过路费 ×2）、
强拆卡（对手城市建筑 -1 级，地标 / 观光地 / 抵押中不可选）、免费建造卡（自己城市免费升 1 级，lv<3）、传送卡（飞往任意格并结算落地，之后仍可掷骰）；**v0.8 新增**换位卡、免税卡、冻结卡（共 10 种）。

**角色主动技能（v0.2）**：冷却 5 个自己的回合，掷骰前使用（`useSkill`）：金多多「点石成金」（总资产 5% 现金，上限 30 万）、小狸「闪电收购」（下次收购五折）、
铁算盘老王「金算盘」（至下回合开始前过路费 ×1.5，与双倍收租相乘）、赛博阿星「完美预判」（本次掷骰必中所选区间）、熊猫工头「突击施工」（地价最高的可升城市免费升 1 级，无可升城市则得 10 万）、岩盾阿岩「固若金汤」（获得护盾，并向现金最多的对手收 5 万保护费；被动：被收过路费 -10%）。

**全局经济事件（v0.2）**：每 3 回合（第 3、6、9…回合第一位玩家的回合开始）用引擎 RNG 按权重抽一次，持续 1 回合、全员生效：风平浪静（权重 4）/ 旅游旺季（观光地过路费 ×2）/ 地产热潮（过路费 +30%）/ 建设补贴（建设费 -30%）/ 经济萧条（月薪与过路费 -30%）。画面顶部有横幅提示。

**色组连片加成（v0.2）**：集齐同一色组全部城市后，该组城市过路费 ×1.5，棋盘上金色描边并标 ★。

**机会卡 12 种（v0.2）**：旅游奖金、超速罚单、直达起点、遭遇风暴、政府补贴、免单券，以及新增的生日派对（其他每人付你 5 万）、前进 3 步、后退 3 步（经过起点不领月薪、不触发路障）、
道具补给（手牌满则改发 10 万）、税务返还（现金 10%，上限 20 万）、双倍月薪（下次过起点月薪 ×2）。

**竞拍（v0.2）**：玩家放弃购买无主城市 / 观光地后，其余未破产玩家按座位顺序出价或弃拍：起拍价 = 地价 50%，最小加价 5 万（出价选项为最低报价、+10、+30），
现金不足最低报价者自动弃拍，轮回到最高出价者即成交（以 lv0 空地成交，不含建造）；全员弃拍则流拍。回合制、无自由喊价计时器，机器人 / 托管可推进。

**抵押与赎回（v0.2）**：掷骰前可抵押自己的一处地产（`mortgage`），得款 = 已投入总价 ×50%；赎回（`redeem`）价 = 得款 ×110%。抵押中的地产不收过路费、不可升级 / 收购 / 强拆 / 作为节庆目标，
也不计入色组加成与独占胜利；破产清算时抵押地产的清算价值为 0（优先级最低、不提供现金），随破产收归银行；总资产按「投入 − 赎回价」计入。机器人只在面临付不起的过路费时才会抵押，现金充裕才赎回。

## 事件清单

引擎每个合法操作都会输出事件流（`GameEvent`，见 `packages/shared/src/types.ts`），客户端据此播放动画，也是后续埋点的数据源。**事件类型名（`t` 字段）视为稳定接口，不随意改名**；新增事件只追加。

| 事件 `t` | 含义 |
|---|---|
| `turn` | 轮到某玩家（带回合数） |
| `roll` | 掷骰结果：蓄力区间、两颗骰子、是否命中区间 |
| `move` | 棋子移动：路径、方式（`walk` 步行 / `fly` 航班或传送 / `warp` 被传走） |
| `salary` | 经过起点领月薪（已含全局事件与双倍月薪） |
| `doubles` / `island` / `islandStay` / `islandEscape` | 双数计数 / 进入无人岛 / 岛上停留 / 掷双数逃脱 |
| `pay` | 支付：过路费 `toll`、税 `tax`、罚款 `fine`、收购 `takeover`、生日派对 `birthday` |
| `shieldUsed` | 护盾抵消了一次过路费 |
| `buy` / `upgrade` / `takeover` | 购买地产 / 升级（含免费升级）/ 收购 |
| `sell` / `bankrupt` | 破产清算时变卖地产 / 玩家破产 |
| `card` / `bonus` | 抽到机会卡（12 种）/ 获得现金 |
| `festival` / `airport` | 环球节庆指定城市 / 踩到环球航班 |
| `itemGained` / `itemUsed` | 获得道具 / 使用道具 |
| `skillUsed` | 发动角色主动技能 |
| `roadblockPlaced` / `roadblockHit` | 放置路障 / 路障拦停了某玩家 |
| `demolish` | 强拆卡降低对手建筑等级 |
| `globalEvent` | 新一轮开始时的全局经济事件（`none` 表示没有 / 已结束） |
| `auctionStart` / `auctionBid` / `auctionPass` / `auctionWin` / `auctionFail` | 竞拍开始 / 出价 / 弃拍（含现金不足自动弃拍）/ 成交 / 流拍 |
| `mortgage` / `redeem` | 抵押地产得款 / 赎回地产 |
| `prompt` | 产生待选择项（购买、升级、收购、节庆、航班、选道具目标、竞拍出价） |
| `decline` | 玩家放弃了某个选择 |
| `end` | 对局结束（胜者与原因） |

v0.3 **没有新增引擎事件**：观战者收到的事件流与玩家完全一致（同一条 `sync`）；回放播放器逐帧使用的就是引擎在该步输出的事件。新增的是协议消息（见「v0.3 更新说明」）。

## 回放

对局由 `seed + 座位配置 + 操作序列` 完全决定。对局结束的结算页有「导出回放 JSON」按钮（单机直接导出本地记录，联机向对战服请求 `exportReplay`），
文件结构见 `packages/shared/src/replay.ts` 的 `GameRecord`；用 `replayGame(record)` 即可还原最终状态，测试里验证了重放与原局 `GameState` 完全一致。
v0.3 起 `result.ranking` 在对局结束后给出每个座位的胜负与名次（胜者第一，其余未破产者按总资产降序，破产者垫底），含 `accountId` 透传；旧文件没有该字段也能正常播放。
`new ReplayPlayer(record)` 会把记录展开成逐步帧（帧下标 = `state.seq`，第 0 帧是开局），支持 `next / prev / seek(seq)`，每帧状态与直接重放前 n 步完全一致（有单测）。

## 账号预留

`SeatConfig.accountId` / `JoinOptions.accountId` 为可选透传字段：引擎与对战服只携带、不校验，不参与任何规则（本期不含登录与业务服）。

## v0.2 更新说明

- **版本**：`0.2.0`；`GameState.version` 由 1 升为 2。新增字段：`globalEvent`、`PlayerState.items / skillCd / doubleSalary / accountId?` 等、`TileState.mortgaged`、`Pending.auction`。
- **存量快照兼容**：对战服不持久化快照；如需读取 v0.1 / v0.2 阶段 1 的旧快照，用 `migrateState(raw)` 补齐新字段并升为 version 2（版本不在 1、2 内会抛错）。
- **新增操作**：`useItem`、`useSkill`、`mortgage`、`redeem`；竞拍期间行动者是当前出价人，请用 `actorOf(state)` 判断该谁操作（`applyAction` 也据此校验座位）。
- **倍率叠加顺序**（集中在 `engine.ts` 的 `tollOf` / `buildCost` / `paySalary`，只在最后取整一次）：
  - 过路费 = 基础 × 节庆 ×2 × 色组集齐 ×1.5 × 角色被动 × 双倍收租卡 × 老王金算盘 → 再 × 全局事件（过路费倍率，旅游旺季仅观光地）→ 取整；抵押中为 0。
  - 建设费 = 基础 ×（1 − 角色折扣）× 全局建设补贴 → 取整；月薪 = 基数 × 全局月薪倍率 × 双倍月薪卡 → 取整。
- **新数值位置**（均为提案值，在 `packages/shared/src/config.ts`）：道具 / 技能相关在 `RULES`（`itemMax`、`skillCooldown` …）；全局事件在 `GLOBAL_EVENTS` 与 `RULES.globalEventEvery`；色组加成 `RULES.groupSetTollMult`；
  新机会卡参数 `RULES.birthdayGift / cardMoveSteps / itemSupplyCash / refundRate / refundCap / doubleSalaryMult`；竞拍 `RULES.auctionStartRatio / auctionMinRaise / auctionBidSteps`；抵押 `RULES.mortgageRatio / redeemMult`。
- **回放与账号预留**：结算页「导出回放 JSON」；`accountId` 只透传不校验。
- **客户端**：行动栏（手牌 / 技能 / 地产）、全局事件横幅、色组集齐高亮、抵押标记、竞拍面板。

## v1.7 更新说明（首批付费新角色：锦鲤阿棠）

- **角色**（提案值，写在 `characters.ts`）：id `tang`，「锦鲤阿棠」，粉色 `#ec4899`，控骰命中率 0.4；被动「锦鲤体质」月薪 +50%（30 万 → 45 万，`CharacterDef` 新增 `salaryBonus`，原 6 名角色为 0、行为不变）；主动「锦鲤附体」（冷却 5 回合）：下次过起点月薪翻倍（复用 `doubleSalary` 标志，只生效一次；与被动相乘即 90 万）。立绘 `char7.svg`。`GameState.version` 仍为 2，旧回放兼容；不新增 `Math.random`。引擎导出 `PAID_CHAR_IDS` / `FREE_CHAR_IDS`，机器人默认补位与单机对手只从免费角色里选，机器人配置为 tang 时走通用 `useSkill` 分支（整局回放一致）。
- **商城 / 账号**：「角色」分类上架 `char_tang`，500 金币（约 8–10 场联机第一名奖励）；购买进 `cosmetics.owned`，重复购买 400、金币不足 402。`CharIDs` 增加 `tang`，可训练 / 升级、结算经验与其他角色一致；排行榜 assets 按购买价计入。tang 暂无角色外观。
- **选角与校验**：客户端选角页显示粉色 tang，未购买为锁定态并提示去「账号 → 商城」购买；未登录与单机仅 6 名免费角色可选。联机入座时对战服（`apps/server/src/owns.ts`）用票据里的账号向业务服 `GET /internal/owns?account=&char=`（`INTERNAL_TOKEN` 口令）查询已购：匿名、未购、未配置业务服或查询失败一律拒绝并回 error。**付费角色联机需要对战服同时配置 `ACCOUNT_URL` 与 `INTERNAL_TOKEN`**。
- **验证**：`go vet` / `go test`（商品、买前不可选、购买扣币、重复 400、不足 402、训练、assets 折算）；`npm test`（月薪 45、附体 90 且只一次、冷却 5、机器人 tang 整局回放）、`npm run build`、`npm run typecheck` 全绿；联机冒烟默认配置连续 2 次 26/26；`npm run char -w @dt/server` 联机端到端（匿名 / 未购被拒、免费可入座、购买后入座与训练）通过。浏览器内选角画面为无头环境未实测，以代码路径为准。

## v1.6 更新说明（商城新品类：角色 / 角色外观 / 骰子皮肤）

- **口径**：商城以后主要卖**角色、角色外观、骰子皮肤**等装饰商品，金币购买；与对局道具卡彻底分开（道具卡仍不可购买，`buy` 道具卡 400）。金币体系不变（注册 200、签到、名次奖励、训练）。
- **业务服**：新增 `cosmetics.go` 商品目录（`Kind`：`char` 角色 / `skin` 角色外观 / `dice` 骰子皮肤）。`GET /api/account/shop` 新增 `categories`（角色 / 角色外观 / 骰子皮肤三类），旧字段 `items` 保持为空数组，旧客户端不受影响。账号新增 `cosmetics`：`owned`（已购列表）与 `equipped`（当前装备，键 `dice` / `skin:<角色id>`）；SQLite 内为账号 JSON，旧数据无需迁移。
- **接口**：`POST /api/account/shop/buy {item}` 购买装饰（金币不足 402、重复购买 400）；`POST /api/account/equip {item}` 装备、`POST /api/account/unequip {item}` 卸下（未拥有 400）；`GET /api/account/me` 返回当前装备。`dice_classic` 为免费默认骰子。
- **首批商品（提案值）**：角色外观 6 款（每名角色 1 款配色外观，`skin_<id>`，价格 150–300：李小橙 150、王小萌 180、金大宝 200、熊猫 220、星星 250、磐石 300）；骰子皮肤 3 款（霓虹 120、海岛 150、鎏金 200，另有免费经典）。**角色**品类本期无在售：新角色到货只需在 `cosmeticCatalog` 追加 `Kind=char` 条目即可上架。现有 6 名角色仍免费可选、数值不变。
- **生效**：装备的角色外观在对局内棋子、HUD 头像、掷骰等待头像、结算页与选角界面显示；骰子皮肤作用于掷骰动画（CSS 皮肤）。单机与联机均生效；**联机仅自己可见**（装备只存在本机缓存与业务服，不进对战服与引擎，对局同步与回放不变）。
- **排行榜 assets**：已购装饰按购买价计入总资产（延续 v1.5 的内部价目口径）。
- **客户端**：账号页商城按品类分组，显示购买 / 装备 / 卸下按钮；登录与入座前静默刷新当前装备。
- **验证**：`go vet` / `go test`（新增商品、购买、装备、持久化、assets 折算用例）、`npm test`、`npm run build`、`npm run typecheck` 全绿；联机冒烟默认配置连续 2 次全部通过；curl 实测 shop 分类、购买 / 402 / 400、装备查询通过。浏览器内对局画面为无头环境未实测，以代码路径为准。

## v1.5 更新说明（商城下架对局道具卡）

- **口径**：影响对局的 10 种道具卡（dice / roadblock / shield / doubleToll / demolish / freeBuild / teleport / swap / taxFree / freeze）**不在对局外商城售卖，仅在对局内抽到和使用**；骰子（遥控骰子）、6 名角色技能在对局内照常生效。「商城道具带入对局」方向已否决。
- **业务服**：`GET /api/account/shop` 返回空 `items`（仍带训练信息）；`POST /api/account/shop/buy` 对任何道具一律 400（说明已下架），不扣金币、不加库存。`ShopItems` 改名 `ItemValues`，仅供排行榜 assets 估值，不可购买。账号 `Items` 字段结构保留，已有测试库存不迁移、不清理。
- **排行榜**：assets 仍按 `ItemValues` 折算持有道具（方案 a）。
- **客户端**：账号页商城无在售商品时显示空状态提示；商城接口失败仍容错、不阻塞账号页。
- 金币体系不变（注册送 200、签到、名次奖励、训练）；新售卖品类（外观 / 骰子皮肤等）另开 issue。

## v1.4 更新说明（业务服存储升级为 SQLite）

- **选型**：嵌入式 SQLite，驱动 `modernc.org/sqlite`（纯 Go，免 cgo）。理由：Docker 仍是单镜像、`CGO_ENABLED=0` 静态编译、多架构交叉构建不需要 C 工具链；不引入外部数据库服务，compose 拓扑不变。依赖固定在 v1.34.5 以兼容 Go 1.23。
- **存储方式**：库文件为 `DATA_FILE` 同目录同名 `.db`（默认 `data/account.db`，Docker 为 `/data/account.db`，**环境变量与挂载卷不用改**）；WAL + `synchronous=FULL`。表：`accounts` / `sessions` / `settled`（最近 2000 个 matchId，按序）/ `meta`（赛季、历史、迁移标记）。业务逻辑仍在内存模型上持锁运行，每次写操作把「与上次落库相比变化的行」在**一个事务**里增量提交（不再整库重写）；失败回滚，进程崩溃不丢已提交数据。
- **自动迁移**：启动时若发现旧 `account.json` 且库内无迁移标记，一次性全量导入（账号 / 会话 / 角色经验等级 / 商城库存 / 段位分 / 赛季胜场 / 赛季历史 / 已结算 matchId），然后把旧文件改名为 `account.json.migrated-<时间戳>` 保留备份（不删除）；重复启动不会重复迁移，旧 JSON 损坏则报错且原文件不动。
- **备份 / 导出**：`account export <out.json>` 导出旧格式 JSON（排障），`account backup <out.db>` 用 `VACUUM INTO` 生成一致性备份（容器内如 `docker exec <容器> /account backup /data/backup.db`）。日常也可直接复制 `account.db`（连同 `-wal` 文件，或先停服务）。
- **接口不变**：全部 HTTP API、票据格式、结算幂等、段位 / 赛季规则、排行榜公开字段都不变；`GameState.version` 仍为 2。
- **验证**：业务服 `go vet` / `go test`（原 9 项 + 新增迁移逐项一致、迁移幂等、坏 JSON 不动原文件、并发写、导出与备份）；`npm test`、`npm run build`、`npm run typecheck`、结算端到端与联机冒烟通过。

## v1.3 更新说明（结算挂钩 / 排行榜 / 段位 / 赛季）

- **结算挂钩**：联机对局结束后，对战服把「带有效票据的真人」的名次（1~4，含机器人的整桌排名；赢家第 1，其余未破产者按总资产降序，破产者靠后）发给业务服 `POST /internal/settle`（`INTERNAL_TOKEN` 口令）。对战服需同时配置 `ACCOUNT_URL` 与 `INTERNAL_TOKEN`，否则静默跳过；上报失败只记日志，不影响对局。**匿名玩家、仅声明 accountId 而无票据的玩家、机器人、单机对机器人都不参与**。接口按 `matchId` 幂等。
- **奖励与段位分**（提案值，集中在 `apps/account/rank.go`）：名次 1/2/3/4 → 段位分 +25/+10/−10/−20（不低于 0）、金币 +60/+40/+25/+15、当前角色经验 +30/+20/+12/+8。段位：青铜 <100、白银 <300、黄金 <600、铂金 <1000、钻石 <1500、王者 ≥1500。段位分只存在业务服，不进引擎与回放，`GameState.version` 不变。
- **全服排行榜**：`GET /api/account/leaderboard?by=rating|wins|assets&n=50`（公开，前 50 名）。`rating` 段位分、`wins` 本赛季胜场、`assets` 总资产（金币 + 持有道具按内部价目表 ItemValues 折算）。只返回账号名、段位、分数、胜场、局数、资产，不含口令/会话/票据/账号 id。客户端「账号 → 排行榜」提供最小榜单（三个 tab）。
- **赛季**：每 30 天一个赛季（首次访问时开启第 1 赛季）；到期后**惰性滚动**（任何结算/榜单/赛季请求触发，停机很久会连滚多个）：榜单快照存入历史（保留最近 12 个赛季，`GET /api/account/season` 可查）、段位分按 50% 向下取整保留、赛季胜场清零；累计胜场/局数保留。新赛季开始不影响进行中的对局（结算落在结算发生时的赛季）。
- 验证：业务服 `go test`（结算、幂等、段位下限、榜单字段不泄露、赛季滚动/历史/持久化）；`npm run settle -w @dt/server` 联机端到端（登录玩家上榜、伪造 accountId 不上榜，需先启动业务服 + 对战服并配置同一 `INTERNAL_TOKEN`）。
- 部署：`docker-compose.yaml` 的 `INTERNAL_TOKEN` 现在同时传给对战服和业务服（同一个 `.env` 值）才会开启结算挂钩；不设置则与 v1.2 行为一致。

## v1.2 更新说明（Go 业务服 + 票据）

- **业务服 `apps/account`**（Go 1.23，仅标准库，独立进程 / 容器）：
  - 账号：`POST /api/account/register|login|logout`、`GET /api/account/me`；口令 PBKDF2-HMAC-SHA256 加盐存储，会话 7 天（随机令牌，库里只存哈希）。
  - 角色养成：6 名角色各自经验 / 等级（每 100 经验 1 级，上限 20）；`POST /api/account/train` 花 50 金币得 40 经验；`POST /api/account/checkin` 每日签到 +50 金币；新号 200 金币。
  - 商城：`GET /api/account/shop`、`POST /api/account/shop/buy`，v1.5 起已下架全部道具卡（`items` 为空、购买道具卡 400；v1.6 起另有装饰品类 `categories`），道具仅在对局内出现和使用；`apps/account/store.go` 的 `ItemValues` 仅作排行榜估值。
  - 内部发放：`POST /internal/grant`（`INTERNAL_TOKEN` 口令，未设置则关闭），对局结算见 v1.3 的 `/internal/settle`。
  - 持久化：v1.2/v1.3 为单文件 JSON；v1.4 起为 SQLite（见「v1.4 更新说明」）。
- **票据**：`base64url({"a":accountId,"e":过期秒,"k":密钥ID}).base64url(HMAC-SHA256)`，有效期 5 分钟，客户端每次入座前现取（`POST /api/account/ticket`）。对战服在 `onJoin` 校验：无效 / 篡改 / 过期 / 未知密钥一律拒绝入座；观战与单机对机器人不经过票据。
- **密钥轮换**：`TICKET_KEYS="新kid:新密钥,旧kid:旧密钥"`，第一把用于签发，其余仅用于校验；旧票据过期后去掉旧密钥即可。密钥只经环境变量注入，不进仓库。
- **对战服**：新增环境变量 `TICKET_KEYS`、`TICKET_REQUIRED`（`1` = 联机必须登录；默认 `0`）、`ACCOUNT_URL`（把 `/api/account/*` 反代到业务服，网页与业务服同源）。`GameState.version` 不变，引擎规则不动。
- **客户端**：主菜单新增「账号」（登录 / 注册 / 签到 / 训练 / 商城）；已登录时创建房间、加入房间、快速匹配自动带票据，票据失效会提示重新登录；未登录行为与此前完全一致。
- **运行 / 部署**：
  - 本地：`cd apps/account && TICKET_KEYS=k1:密钥 go run .`（默认 :8080），对战服 `TICKET_KEYS=k1:密钥 ACCOUNT_URL=http://localhost:8080 npm run dev:server`。
  - 测试：`cd apps/account && go test ./...`；联机票据校验 `npm run ticket -w @dt/server`（两个服务同密钥运行）。
  - `docker-compose.yaml` 新增 `account` 服务（镜像 `joshualoooooo/dice-tycoon-account`，数据卷 `account-data`），与对战服同在默认网桥并用 `links` 互通；**需要在 compose 同目录建 `.env`** 写入 `TICKET_KEYS=k1:一段随机长串`（可选 `INTERNAL_TOKEN`、`TICKET_REQUIRED`）。CI 同时构建并推送两个镜像。

## v1.1 更新说明（第二张棋盘）

- 新增棋盘「海岛度假」（32 格，角格位置不变）：新布局、地价略高（提案值）、传送门在 10 号（→ 21 马略卡）、奖金格在 26 号（¥30 万）。所有棋盘的布局 / 地价 / 特殊格位置与数值都在 `packages/shared/src/config.ts` 的 `BOARD_CFGS`（经典棋盘 `classic` 数值保持不变）；特殊格复用 `resolveTile` 的同一套结算。
- 选择棋盘：主菜单「棋盘」下拉（默认经典，存 localStorage `dt:board:v1`）；单机直接生效，联机由房主在创建时 / 大厅里切换，`lobby` 消息带 `board` 同步给全房，观战者通过 `GameState.board` 看到同一棋盘。新增客户端消息 `setBoard`（仅房主、开局前）。
- 数据兼容：`GameConfig` / `GameRecord` / `GameState` 新增可选字段 `board`（缺省 = 经典）；`GameState.version` 仍为 2；旧回放无该字段，按经典棋盘重放一致。
- 引擎与机器人不再依赖棋盘硬编码：通过 `boardOf(state)` 取地块 / 色组 / 观光地 / 整排 / 特殊格；`BOARD` / `GROUPS` 等旧导出仍指向经典棋盘。
- 测试：新增棋盘配置校验、海岛特殊格、机器人三档 × 两张棋盘整局与回放一致等用例（共 92 项）。

## v1.0 更新说明（埋点 / 风控 / 压测）

- **埋点**（`apps/server/src/telemetry.ts`）：默认开启，写本地 JSONL，按天一个文件，目录 `TELEMETRY_DIR`（默认 `./data/telemetry`；Docker 请挂卷）。`TELEMETRY=off` 关闭；`TELEMETRY_ENDPOINT` 配置后额外 POST 每条记录（默认不上传，失败静默）。事件：`match_start`（seed、真人/机器人数）、`match_end`（胜负、名次、资产、操作类型计数摘要）、`risk_reject`、`replay_check`、`anomaly`。不含 `accountId`、令牌、IP；写失败不影响对局。
- **风控**（`packages/shared/src/risk.ts` + `MatchRoom`）：观战者 / 无座位 / 非行动座位 / 非法操作拒绝并记 `risk_reject`；同会话 60ms 内连发、2 秒超过 12 次、400ms 内完全重复的操作被静默忽略并记日志；对局结束后自动用 `replayGame` 还原并与原局状态逐字比对，不一致记 `replay_check`（ok=false）与服务端错误日志；异常只记日志，不中断对局。
- **压测**：`npm run stress`（单机机器人 1000 局，`STRESS_GAMES` 可调，含回放一致性抽查，报告写 `data/stress-report.json`）；`npm run stress:online`（联机多房并发，默认 10 房，需先 `MATCH_TIMEOUT_MS=3000 SMOKE_SPEED=20 npm run dev:server`，`STRESS_ROOMS` 可调，报告写 `data/stress-online-report.json`）。新增 `GET /api/stats`（进程内存与房间数）。实测：1000 局 0 失败、约 10 秒、峰值 RSS 约 81MB；10 房并发全部打完、服务端 RSS 峰值约 60MB。
- **不变**：引擎规则、数值、事件类型名与回放格式未改，`GameState.version` 仍为 2。无新增依赖。

## v0.9 更新说明（资源通道 / 图标 / 立绘）

- **加载进度**：首屏进度条与百分比；渲染器等按需 chunk 由 Vite 自动分包，音频文件首次播放才加载（不计入首包）。首包口径：`npm run build` 产物中首屏必需的 js/css/图片，当前 `apps/client/dist` 约 2.2 MB。
- **音效文件通道**：`audio.ts` 接口不变；优先加载 `/audio/sfx/<名称>.ogg|.m4a`，缺失或解码失败自动回退合成音效。已接入真实素材（#14）：24 个音效来自 Kenney CC0，BGM 为 Pixabay「Tropical Bounce」（Pixabay Content License），位于 `apps/client/public/audio/`（含 NOTES.md / sfx-mapping.json 记录来源与许可）；BGM 同样走文件通道（循环，兼容 setMood/toggleMusic，缺失回退合成）。音频约 5.8 MB（ogg+m4a 两份，浏览器只取其一），首次播放才加载，不计入首包 dist 统计。
- **图标**：道具 10 种、角色技能 6 个、竞拍均为内联 SVG（`apps/client/src/ui/icons.ts`），道具/技能按钮上显示。
- **立绘**：岩盾阿岩改用独立 SVG 立绘（`char6.svg`），不再复用熊猫。（#15 / #16 曾把 5 名角色与建筑、角格、背景、金币的 Q 版 3D PNG 替换为扁平 SVG，2026-11-20 已回滚恢复原图；`char6.svg` / `char7.svg` / 外观 SVG 待重绘，见 `apps/client/public/assets/NOTES.md`。）
- **#16 跟进**：建筑（bld1–4）、角格（c_start/island/fest/air）、背景（bg）、金币（coin）占位图全部替换为与角色立绘同风格的原创扁平矢量 SVG，加载路径同步；美术目录总计约 22 KB（原 PNG/JPG 约 0.9 MB），来源与许可见 NOTES.md。
- **待办**：角色立绘、音频、建筑/角格/背景美术均已落地；规则引擎未改动，`GameState.version` 仍为 2。

## v0.8 更新说明（道具 / 角色后续批次）

- **换位卡**：点选目标玩家，与其交换位置；使用者在新位置结算落地（不领月薪、不触发路障），被换者不结算；之后仍可掷骰；无人岛上不可用，可取消不消耗。
- **免税卡**：玩家状态 `taxFree`，下次停在税务局免缴一次后清除（事件 `taxFreeUsed`）。
- **冻结卡**：指定一名对手，其「下一个回合」整体跳过（不掷骰、不移动、不领月薪，技能冷却照常递减），仅一次、不可重复冻结同一人（状态 `frozen`，事件 `frozen` / `frozenSkip`）。
- **新角色 岩盾阿岩（`rock`）**：被动 `tollCut` 0.1（被收过路费 -10%）；主动「固若金汤」获得护盾并向现金最多的对手收取 `RULES.rockSkillFee`（5 万）。暂复用熊猫立绘，正式美术见路线图。
- **机器人**：补入换位（落点评分高才用）、免税（现金 ≥ 250 才用）、冻结（对准总资产最高且不低于自己的对手）启发式；沿用难度分级的 `itemUse` 频率，简单档少用、普通 / 困难档会用。
- **回放兼容**：`GameState.version` 仍为 2、不升版。新增可选字段 `itemsV8`（`GameState` / `GameConfig` / `GameRecord`）：新开对局写入 `itemsV8: true`，抽取池为 10 种；旧回放无此字段，沿用 7 种旧池，重放结果与以前一致。`taxFree` / `frozen` 为玩家可选字段，旧快照缺省视为 false。
- **验证**：`npm test`（84 项）、`npm run typecheck`、`npm run build`、`npm run smoke -w @dt/server` 通过。数值均为提案值（`config.ts` / `characters.ts`）。
- **部署**：无新增依赖与端口，Docker / compose 无需修改。

## v0.7 更新说明（棋盘主题 / 特殊格）

- **棋盘主题（仅表现层）**：主菜单「棋盘主题」下拉，可选「经典」（默认）与「霓虹夜市」（夜色底、霓虹配色）；选择存浏览器 `localStorage`（键 `dt:theme:v1`），切换后棋盘即时重绘。主题不改任何规则数值；联机各自表现、不同步，不影响回放一致性。主题定义在 `packages/shared/src/config.ts` 的 `THEMES`（提案值）。
- **特殊格（规则层）**：叠加在两处「机会」格上（32 格布局与地产不变）——第 11 格 **传送门**：停留时传送到第 20 格圣托里尼（不领月薪，并结算落地）；第 28 格 **奖金格**：停留时领取 ¥25 万。位置与数值在 `SPECIAL_TILES`（提案值）；触发逻辑在引擎 `resolveTile`，纯函数、不用随机数。
- **回放兼容**：`GameState.version` 仍为 2、不升版。新增可选字段 `GameState.specials` / `GameConfig.specials` / `GameRecord.specials`：新开的对局（单机、联机）写入 `specials: true`；旧回放文件没有该字段，按原规则（这两格仍是机会格）重放，结果与以前完全一致。新增事件 `special`。
- **验证**：`npm test` 新增特殊格触发、主题、启用 / 未启用特殊格的整局回放一致等用例；`npm run smoke -w @dt/server` 通过。
- **部署**：无新增依赖与端口，Docker / compose 无需修改。

## v0.6 更新说明（每日任务 / 成就）

- **每日任务**：每天按本地日期确定性抽 3 个任务（赢 1 局、完成 3 局、买下 5 处地产、经历 1 次全局事件、完成 1 局联机、凑齐 1 次色组独占），次日重置，未完成不累积；完成得称号徽章。
- **成就**：终身里程碑（首胜、十胜、色组独占、单局资产破千、累计 20 局、联机 5 局），达成后永久点亮。
- **展示**：主菜单「档案与历史」页顶部显示今日任务进度与成就列表；结算页在本局新完成任务 / 新解锁成就时显示提示。奖励仅为展示性称号 / 徽章，不改经济、不发货币、不解锁内容。
- **进度来源**：只从对局记录推导——`digestRecord(GameRecord)` 回放得到单局摘要（买地数、全局事件、色组独占次数、资产峰值、胜负），`applyDigest` 累积；均为纯函数（`packages/shared/src/quests.ts`，含单测）。同一局只计一次；观战与回放播放不计。历史上的旧对局不回溯。
- **存储**：与档案同在浏览器 `localStorage`（键 `dt:quests:v1`），脏数据安全重建；不新增服务端接口与端口。
- **数值**：任务池、成就阈值、每日任务数在 `packages/shared/src/config.ts` 的 `QUESTS`（提案值；资产门槛按「万」计，初始资金 250 万，故取 1000 万）。引擎规则与 `GameState.version`（仍为 2）未改，旧回放可继续播放。
- **部署**：无新增依赖与端口，Docker / compose 无需修改。

## v0.5 更新说明（机器人难度分级）

- **三档机器人**：简单（行为随机性大、少用道具技能、不抢色组、储备金低、竞拍保守）/ 普通（与此前唯一策略一致，默认）/ 困难（重视过路费期望、优先凑色组、竞拍更激进、更早抵押、更敢赎回）。参数在 `packages/shared/src/config.ts` 的 `BOT_LEVELS`（提案值）。
- **选择方式**：单机菜单「单机机器人难度」下拉（默认普通，记在本地）；快速匹配补位与掉线托管固定为普通（`BOT_DEFAULT_DIFFICULTY`）。
- **数据**：难度写入 `SeatConfig.difficulty` / `PlayerState.difficulty`，随回放座位配置保存，重放一致；机器人决策仍是纯函数，「随机」仅用局面确定性哈希，不用 `Math.random`、不改骰子与经济。
- **验证**：`npm test` 含三档同局面决策差异（买地/道具/抵押）与同 seed 各打 40 局的平均名次对比（实测：简单 2.9 / 普通 2.6 / 困难 2.4，越小越好）。
- **部署**：无新增依赖与端口，Docker/compose 无需修改。

## v0.4 更新说明（轻量版账号与存档）

- **本地档案**：昵称、常用角色、创建时间存浏览器 `localStorage`（键 `dt:profile:v1`），刷新后仍在；档案 id 作为 `SeatConfig.accountId` 透传（单机、联机均带上，引擎与对战服只携带不校验）。首次建档会带入 v0.3 旧的 `dt.name` / `dt.char`。
- **对局历史**：单机与联机结算后自动写入一条（时间、名次、胜者、回合数、座位、回放摘要），键 `dt:history:v1`；完整回放 JSON 另存于 `dt:replay:v1:<id>`，不混进历史记录。上限 `PROFILE.historyLimit = 50`（提案值，见 `config.ts`），超出丢弃最旧并清理其回放。观战与回放播放不记录。
- **操作**：主菜单「档案与历史」→ 查看总局数 / 胜场 / 胜率；每条可「回放」（进入回放播放器）、「导出」（回放 JSON，可用「导入回放 JSON」再次播放）、「删除」。
- **容错**：`localStorage` 被清空、禁用、损坏或版本未知时安全重建 / 丢弃，不白屏；回放数据丢失的条目会提示。
- **代码**：纯逻辑在 `packages/shared/src/profile.ts`（含单测），存储封装在 `apps/client/src/core/store.ts`。
- **部署**：无新增依赖与端口，Docker / compose 无需修改。数据只在本浏览器，换设备或清缓存即丢失。

## v0.3 更新说明

- **版本**：`0.3.0`。`GameState.version` 仍为 2（引擎规则与快照结构未改，存量快照无需迁移）；回放文件 `GameRecord` 仅在 `result` 里新增可选的 `ranking`，旧文件可继续播放。
- **回放播放器**：`ReplayPlayer`（shared，纯逻辑）+ 客户端 `ReplaySource` / 控制条。播放走与对局相同的 `Director` 动画；调速通过全局时钟倍率（`core/tween.ts` 的 `clock.scale`）同时缩放补间与等待；单步后退 / 跳转直接把画面重置到目标帧的权威状态（不播动画）。
- **观战**：加入选项 `JoinOptions.spectate`，只能在对局开始后加入（未开局、观战席满都会被拒绝）；观战人数通过 `spectators` 消息广播；`exportReplay` 观战者也可用。`GET /api/rooms` 返回 `RoomBrief[]`（是否可观战、玩家名、机器人数、回合、观战人数 / 上限）。
- **快速匹配**：`JoinOptions.quick` + `joinOrCreate`，用 `filterBy(['quick'])` 把匹配房与朋友房分开；队列逻辑在 `MatchQueue`（`join / cancel / peek / poll`，时间由调用方传入）；满 4 人立即开局，队首等候超时则机器人补位；`lobby` 消息带 `started` 与 `quick`（排队人数、距超时剩余毫秒，用相对值避免客户端时钟偏差）。匹配中离开房间即取消。排位分本期**只记对局胜负到回放摘要**，不做排行榜与段位。
- **新增协议消息**：`spectators`（服务端 → 客户端）；`lobby` 增加 `started` / `quick`。客户端 → 服务端消息不变。
- **新数值位置**（均为提案值，在 `packages/shared/src/config.ts`）：`SPECTATE.maxSpectators`（观战席上限 8）、`MATCH.matchSize / timeoutMs / minHumans`（4 人、20 秒、至少 1 名真人）、`REPLAY_PLAYER.speeds / gapMs`（倍速档与步间停顿）。服务端可用环境变量 `MATCH_TIMEOUT_MS` 覆盖匹配超时（测试用），`SMOKE_SPEED` 加快机器人节奏（仅冒烟测试用，生产不要设置）。
- **与既有倍率的叠加顺序**：本期没有新增任何金额 / 倍率，规则结算顺序不变（见 v0.2 更新说明）。
- **点选棋盘格选目标**：路障 / 强拆 / 免费建造 / 传送进入待选择时，客户端高亮合法格并监听棋盘点击；点非法格只提示、不发操作，不消耗道具。遥控骰子的目标是点数，仍用面板。
- **部署**：无新增依赖与端口；Docker / compose 无需修改，网页与对战服仍同端口（`/api/rooms` 由同一进程提供）。

## 下一步（建议）

0. ~~道具 / 技能后续批次（换位 / 免税 / 冻结 + 第 6 名角色）~~ ✅ 已在 v0.8 完成
0. ~~第二张可玩棋盘（海岛度假）~~ ✅ 已在 v1.1 完成
0. ~~棋盘主题与特殊格~~ ✅ 已在 v0.7 完成
0. ~~每日任务 / 成就（局外目标）~~ ✅ 已在 v0.6 完成（服务端排行榜、段位、赛季已在 v1.3 完成）
0. ~~机器人难度分级~~ ✅ 已在 v0.5 完成
1. ~~账号与存档~~ ✅ 轻量版 v0.4、Go 业务服（登录 / 养成 / 商城 / 票据）v1.2 已完成；养成与对局结算挂钩、全服排行榜 / 段位 / 赛季 ✅ v1.3 已完成；数据库选型升级 ✅ v1.4 已完成（SQLite）
2. ~~道具卡与骰子技能接入引擎~~ ✅ 已在 v0.2 完成（另含全局事件、色组加成、竞拍与抵押）
3. ~~匹配与排位、观战、回放播放器~~ ✅ 已在 v0.3 完成（排位分目前只把胜负写进回放摘要；全服排行榜、段位、赛季留待有账号体系后做）
4. ~~正式美术（#16）与音频（#14）替换~~ ✅ 已完成；加载进度与资源分包（首包 < 5 MB）；道具 / 技能 / 竞拍的专属图标与音效
5. ~~埋点、风控、压测~~ ✅ 已在 v1.0 完成（事件类型名保持稳定）
6. ~~首批付费新角色（锦鲤阿棠）~~ ✅ 已在 v1.7 完成；后续候选：典当阿当、导游阿游（另开单）、更多角色外观 / 骰子皮肤商品

所有数值均为提案，见 `packages/shared/src/config.ts`。

## 部署（Docker）

镜像 `joshualoooooo/dice-tycoon` 由 GitHub Actions 在每次推送 `main` 时自动构建（amd64 + arm64）并推到 Docker Hub：

- `latest`：main 分支最新版
- `sha-xxxxxxx`：每次提交
- `1.2.3`：打 `v1.2.3` 标签时

一个容器同时提供网页和对战服（端口 2567），另有一个业务服容器（不对外暴露端口）。直接用仓库根目录的 `docker-compose.yaml`，先在同目录建 `.env`（至少 `TICKET_KEYS=k1:随机长串`，见「v1.2 更新说明」）：

```bash
echo "TICKET_KEYS=k1:$(head -c 24 /dev/urandom | base64 | tr -d '=+/')" > .env
docker compose up -d
# 打开 http://<主机IP>:2567
```

CI 需要在 GitHub 仓库 Settings → Secrets and variables → Actions 里配置 `DOCKERHUB_TOKEN`（Docker Hub 访问令牌，需 Read & Write 权限）。
