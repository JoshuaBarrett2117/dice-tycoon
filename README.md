# 掷富天下 · 网页大富翁（v0.1 开发版）

横屏 45° 斜视棋盘的多人大富翁，手机与 PC 浏览器同一套代码。
本仓库是第一版可运行代码：规则引擎 + 对战服 + 网页客户端，支持 **单机对战（你 vs 3 个机器人）** 和 **好友联机房间**。

## 快速开始

需要 Node.js 20+。

```bash
npm install
npm test                 # 规则引擎单元测试（10 项）

npm run dev:server       # 终端 1：对战服 ws://localhost:2567
npm run dev              # 终端 2：客户端 http://localhost:5173
```

浏览器打开客户端 → 选角色 → 「单机对战」即可开玩；「创建房间」后把房间号发给好友加入，房主点开始，空位由机器人补齐。
操作：**按住掷骰键（或空格）蓄力，松开掷骰**；蓄力时力度条在 2–4 / 5–7 / 8–10 / 11–12 四档间往返，棋盘会点亮对应落点。

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
  src/config.ts        全部数值（起始资金、过路费系数、建设费、收购倍数、控骰上限、蓄力区间）
  src/characters.ts    5 名角色：基础控骰 + 被动技能
  src/engine.ts        applyAction(state, seat, action) → 新状态 + 事件流；可回放
  src/bot.ts           机器人 / 托管 AI
  src/protocol.ts      客户端 ⇄ 服务端消息定义
  src/timing.ts        每种事件的动画时长预算（服务端据此控制节奏）
  test/                Vitest 单元测试
apps/server          Colyseus 0.18 对战服（服务端权威、超时托管、掉线 30 秒重连）
  src/rooms/MatchRoom.ts
  scripts/smoke.ts     联机冒烟测试
apps/client          Vite + PixiJS 8 客户端
  src/view/            斜视棋盘、棋子、建筑、镜头（Pixi）
  src/ui/Hud.ts        头像芯片、掷骰键与蓄力条、骰子、选择面板、结算（DOM）
  src/game/Director.ts 把「快照 + 事件流」播成动画，并处理本地玩家输入
  src/net/source.ts    单机数据源（本地引擎）/ 在线数据源（Colyseus）
  src/audio/audio.ts   程序化合成的占位 BGM 与 24 个音效
  public/assets/       角色、四角、建筑、背景、金币
```

## 架构要点

- **服务端权威**：客户端只发意图（`roll{zone}` / `choose{option}`），掷骰随机数、结算、胜负全部在服务端由 `@dt/shared` 计算，客户端无法作弊改点数。
- **确定性**：随机数状态存在 `GameState.rng` 里，`seed + 操作序列` 可完整回放，用于复盘、申诉和反作弊。
- **事件驱动表现**：引擎每步输出事件流（掷骰、移动、付费、建造…），客户端 `Director` 顺序播放后再用权威快照校正，断线重连只需一份快照。
- **单机与联机同一套代码**：单机模式在浏览器里直接跑同一个引擎和机器人。
- **托管**：真人超时（掷骰 15 秒、选择 10 秒）或掉线时，由机器人代为操作。

## 已实现规则

双骰 + 蓄力控骰（命中率 = 角色控骰，上限 75%）、双数再掷、三连双数进无人岛、无人岛停留 3 回合（掷双数逃脱）、经过起点领月薪、
买地并选择建造等级（别墅 / 公寓 / 酒店）、再次落地升级、酒店后升地标、付过路费、付费后 2 倍收购（地标不可收购）并可顺势加盖、
4 处观光地（过路费随持有数翻倍）、环球节庆（指定城市过路费 ×2）、环球航班（下回合飞往任意格）、机会卡 6 种、税务局、
现金不足自动变卖、破产出局、三区独占 / 整排独占 / 观光地独占 / 只剩一人 / 20 回合后总资产最高 判胜。

## 下一步（建议）

1. 账号与存档：Go 业务服（登录、角色养成、道具、商城），对战服只信任业务服签发的票据
2. 道具卡与骰子技能接入引擎（接口已预留在 `Action` 与 `CharacterDef`）
3. 匹配与排位、观战与回放（利用确定性回放）
4. 正式美术与音频替换、加载进度与资源分包（首包 < 5 MB）
5. 埋点、风控、压测

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
