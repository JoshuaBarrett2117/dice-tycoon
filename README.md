# 掷富天下 · 网页大富翁（v0.2 开发版）

横屏 45° 斜视棋盘的多人大富翁，手机与 PC 浏览器同一套代码。
本仓库是可运行代码：规则引擎 + 对战服 + 网页客户端，支持 **单机对战（你 vs 3 个机器人）** 和 **好友联机房间**。
**v0.2** 在 v0.1 基础上加入道具卡、角色主动技能、全局经济事件、色组连片加成、机会卡扩充、竞拍与抵押、回放导出（详见下方「v0.2 更新说明」）。

## 快速开始

需要 Node.js 20+。

```bash
npm install
npm test                 # 规则引擎单元测试（46 项，含道具 / 技能 / 全局事件 / 竞拍 / 抵押 / 回放一致性）
npm run typecheck        # 全仓类型检查

npm run dev:server       # 终端 1：对战服 ws://localhost:2567
npm run dev              # 终端 2：客户端 http://localhost:5173
```

浏览器打开客户端 → 选角色 → 「单机对战」即可开玩；「创建房间」后把房间号发给好友加入，房主点开始，空位由机器人补齐。
操作：**按住掷骰键（或空格）蓄力，松开掷骰**；蓄力时力度条在 2–4 / 5–7 / 8–10 / 11–12 四档间往返，棋盘会点亮对应落点。
掷骰前，画面底部的**行动栏**可以：使用手牌道具、发动角色主动技能、打开「地产」面板抵押 / 赎回；需要选目标的道具会弹出选择面板。
其他玩家放弃购买无主地块后，轮到你时会弹出**竞拍**面板（出价或弃拍）。

联机冒烟测试（先启动对战服）：`npm run smoke -w @dt/server`，会同时校验 `exportReplay` 导出的回放能被重放。

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
  src/characters.ts    5 名角色：基础控骰 + 被动技能 + 主动技能
  src/engine.ts        applyAction(state, seat, action) → 新状态 + 事件流；可回放
  src/bot.ts           机器人 / 托管 AI（含道具 / 技能 / 竞拍 / 抵押启发式）
  src/replay.ts        回放记录器与重放（GameRecord / ReplayRecorder / replayGame）
  src/protocol.ts      客户端 ⇄ 服务端消息定义
  src/timing.ts        每种事件的动画时长预算（服务端据此控制节奏）
  test/                Vitest 单元测试
apps/server          Colyseus 0.18 对战服（服务端权威、超时托管、掉线 30 秒重连）
  src/rooms/MatchRoom.ts
  scripts/smoke.ts     联机冒烟测试
apps/client          Vite + PixiJS 8 客户端
  src/view/            斜视棋盘、棋子、建筑、镜头（Pixi）
  src/ui/Hud.ts        头像芯片、掷骰键与蓄力条、骰子、行动栏（手牌 / 技能 / 地产）、全局事件横幅、选择面板、结算（DOM）
  src/game/Director.ts 把「快照 + 事件流」播成动画，并处理本地玩家输入
  src/net/source.ts    单机数据源（本地引擎）/ 在线数据源（Colyseus）
  src/audio/audio.ts   程序化合成的占位 BGM 与 24 个音效
  public/assets/       角色、四角、建筑、背景、金币
```

## 架构要点

- **服务端权威**：客户端只发意图（`roll{zone}` / `choose{option}` / `useItem` / `useSkill` / `mortgage` / `redeem`），掷骰随机数、结算、胜负全部在服务端由 `@dt/shared` 计算，客户端无法作弊改点数。
- **确定性**：随机数状态存在 `GameState.rng` 里，`seed + 操作序列` 可完整回放，用于复盘、申诉和反作弊。
- **事件驱动表现**：引擎每步输出事件流（掷骰、移动、付费、建造…），客户端 `Director` 顺序播放后再用权威快照校正，断线重连只需一份快照。
- **单机与联机同一套代码**：单机模式在浏览器里直接跑同一个引擎和机器人。
- **托管**：真人超时（掷骰 15 秒、选择 10 秒）或掉线时，由机器人代为操作；竞拍阶段由「当前出价人」（`actorOf(state)`）决定谁行动，同样适用托管。

## 已实现规则

**基础（v0.1）**：双骰 + 蓄力控骰（命中率 = 角色控骰，上限 75%）、双数再掷、三连双数进无人岛、无人岛停留 3 回合（掷双数逃脱）、经过起点领月薪、
买地并选择建造等级（别墅 / 公寓 / 酒店）、再次落地升级、酒店后升地标、付过路费、付费后 2 倍收购（地标不可收购）并可顺势加盖、
4 处观光地（过路费随持有数翻倍）、环球节庆（指定城市过路费 ×2）、环球航班（下回合飞往任意格）、税务局、
现金不足自动变卖、破产出局、三区独占 / 整排独占 / 观光地独占 / 只剩一人 / 20 回合后总资产最高 判胜。

**道具卡（v0.2）**：手牌上限 3 张；开局发 1 张，每次经过起点抽 1 张（满手牌不抽），抽取走引擎 RNG。掷骰前使用（`useItem`），需要目标的道具复用待选择机制，可取消且不消耗：
遥控骰子（指定总点数 2–12）、路障卡（自己前方 8 格内，拦停他人后消失）、护盾卡（下次过路费全免）、双倍收租卡（至自己下回合开始前过路费 ×2）、
强拆卡（对手城市建筑 -1 级，地标 / 观光地 / 抵押中不可选）、免费建造卡（自己城市免费升 1 级，lv<3）、传送卡（飞往任意格并结算落地，之后仍可掷骰）。

**角色主动技能（v0.2）**：冷却 5 个自己的回合，掷骰前使用（`useSkill`）：金多多「点石成金」（总资产 5% 现金，上限 30 万）、小狸「闪电收购」（下次收购五折）、
铁算盘老王「金算盘」（至下回合开始前过路费 ×1.5，与双倍收租相乘）、赛博阿星「完美预判」（本次掷骰必中所选区间）、熊猫工头「突击施工」（地价最高的可升城市免费升 1 级，无可升城市则得 10 万）。

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

## 回放

对局由 `seed + 座位配置 + 操作序列` 完全决定。对局结束的结算页有「导出回放 JSON」按钮（单机直接导出本地记录，联机向对战服请求 `exportReplay`），
文件结构见 `packages/shared/src/replay.ts` 的 `GameRecord`；用 `replayGame(record)` 即可还原最终状态，测试里验证了重放与原局 `GameState` 完全一致。

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

## 下一步（建议）

1. 账号与存档：Go 业务服（登录、角色养成、商城），对战服只信任业务服签发的票据（`accountId` 透传位已预留）
2. ~~道具卡与骰子技能接入引擎~~ ✅ 已在 v0.2 完成（另含全局事件、色组加成、竞拍与抵押）
3. 匹配与排位、观战（回放导出与重放一致性已在 v0.2 完成，后续做回放播放器与观战）
4. 正式美术与音频替换、加载进度与资源分包（首包 < 5 MB）；道具 / 技能 / 竞拍的专属图标与音效
5. 埋点、风控、压测（事件清单见上文，事件类型名保持稳定）

所有数值均为提案，见 `packages/shared/src/config.ts`。

## 部署（Docker）

镜像 `joshualoooooo/dice-tycoon` 由 GitHub Actions 在每次推送 `main` 时自动构建（amd64 + arm64）并推到 Docker Hub：

- `latest`：main 分支最新版
- `sha-xxxxxxx`：每次提交
- `1.2.3`：打 `v1.2.3` 标签时

一个容器同时提供网页和对战服（端口 2567），直接用仓库根目录的 `docker-compose.yaml`：

```bash
docker compose up -d
# 打开 http://<主机IP>:2567
```

CI 需要在 GitHub 仓库 Settings → Secrets and variables → Actions 里配置 `DOCKERHUB_TOKEN`（Docker Hub 访问令牌，需 Read & Write 权限）。
