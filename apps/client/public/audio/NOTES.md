# dice-tycoon #14 音频素材包 — 助理代取（2026-11-18）

背景：#14 开发方 2026-11-18 14:49 接单评论（id 6971360126）确认按范围做，
但其运行环境下载不了 Pixabay（403）和 Kenney 素材包，本轮未推代码。
主 agent 当天 15:14 在天天富翁复刻侧聊承诺：若开发方一直下不下来，
助理先把 Kenney 包和一首合规格的 BGM 下下来。本包就是兑现该承诺的准备工作。

## 结论先说

- **24 个音效已全部备齐并转好格式**：`sfx/` 内每个 SfxName 各一个 `.ogg` + 一个 `.m4a`
  （audio.ts 按浏览器能力只取其一，实际每用户只加载约 248 KB，不是两者之和）。
  合计 OGG 248 KB + M4A 208 KB = 456 KB；全部来自 Kenney CC0 包（见下）。
- **BGM：曲目已选定并核实，但文件尚未到手**（2026-11-18 15:23–15:34 浏览器核查，
  Turnstile 拦截下载，5 次尝试均未通过；本机 curl 另试亦 403，Jina 代理亦 401，
  无其他线路可试——直链未编造、未猜测）：
  - 选定：**Tropical Bounce** — DesiFreeMusic，2:12，Pixabay 页面
    https://pixabay.com/music/upbeat-tropical-bounce-upbeat-tropical-house-track-with-steel-drums-370628/
    标题含钢鼓（steel drums），标签 Tropical House / Steel Drums / Island Music /
    Caribbean Beats，流派 Upbeat / Pop / Electronic，情绪 Bright / Uplifting /
    Laid Back，页面写 "Free for use under the Pixabay Content License"，
    主曲目**无 Content ID 盾牌图标**；标注 AI generated；播放 5,076 / 下载 608 次，
    2025-07-07 发布。BPM/调性页面未显示，无法确认 120–130 BPM / 大调，
    仅以明亮欢快作依据——开发方试听后若觉得不贴合可换备选。
  - 备选：Caribbean Kick II（u_98673jp944，2:28，无盾牌，Island / Reggae，
    https://pixabay.com/music/island-caribbean-kick-ii-374393/），标题未提钢鼓，优先度低。
  - 已排除：Summer Trips（SergePavkinMusic，id 213035）——4:03 超长且带盾牌
    "Content ID Registered"，不符合 #14 的无盾牌要求。
  - **只差一步（需用户在自己浏览器点一下）**：打开上方 Tropical Bounce 页面，
    点 "Free download" 过一次人机验证即可下载 MP3；下载记录里能看到真实的
    cdn.pixabay.com 直链。拿到文件后转 OGG/M4A 放 `bgm/bgm.ogg|bgm.m4a`，
    再按 #14 补 BGM 文件加载路径。用户把文件或直链发来即可，无需他做别的。
- **开发方无需再从 kenney.nl / pixabay.com 下载**：Kenney 五个包的原始文件已在
  本包各子目录（共 439 个文件），且每个包都有可直接 curl 的 GitHub 镜像地址（见下），
  开发方环境只要能访问 GitHub（它能推代码，即可）就能自行拉取复核。

## 24 音效映射（SfxName -> Kenney 源文件）

详见 `sfx-mapping.json`（含每个文件的时长、字节数）。挑法：按 audio.ts 里
每个音效的合成定义选最接近的真实音色（click=木质点按、coin/cash=真实硬币、
sheet/card=翻书、island/double=钢鼓、win=1.12s 萨克斯小号式庆祝段、miss/tax=下行
错误音、build=木板敲击、takeover=重钟）。时长均已用 ffprobe 核实（0.11–1.12s）。
**注意**：映射是提案，开发方应在接入后逐个试听，觉得不贴切的在同包内换同类文件
（各包内同类变体很多，例如 confirmation_* 有 4 个、impact_wood_* 有 15 个），
换文件只改文件名、不改接口。

| SfxName | 源文件 | 包 |
|---|---|---|
| click | click_001.wav | Interface Sounds |
| turn | confirmation_002.wav | Interface Sounds |
| charge | maximize_002.wav | Interface Sounds |
| zone | pluck_001.wav | Interface Sounds |
| dice | impact_wood_light_002.ogg | Impact Sounds |
| diceLand | impact_wood_medium_000.ogg | Impact Sounds |
| hit | jingles_hit_3.ogg | Music Jingles |
| miss | error_002.wav | Interface Sounds |
| double | jingles_steel_5.ogg | Music Jingles |
| hop | pluck_002.wav | Interface Sounds |
| land | impact_soft_medium_000.ogg | Impact Sounds |
| coin | handle_coins_2.ogg | RPG Audio |
| cash | handle_coins.ogg | RPG Audio |
| build | impact_plank_medium_002.ogg | Impact Sounds |
| salary | jingles_pizzi_4.ogg | Music Jingles |
| ouch | impact_punch_medium_001.ogg | Impact Sounds |
| pay | minimize_003.wav | Interface Sounds |
| gain | confirmation_001.wav | Interface Sounds |
| sheet | book_flip_1.ogg | RPG Audio |
| takeover | impact_bell_heavy_002.ogg | Impact Sounds |
| island | jingles_steel_0.ogg | Music Jingles |
| card | book_flip_2.ogg | RPG Audio |
| tax | minimize_005.wav | Interface Sounds |
| win | jingles_sax_3.ogg | Music Jingles |

## 来源与许可（全部 CC0，可商用、免署名）

Kenney 全部 asset pack 为 CC0 1.0（kenney.nl 支持页；各包内附 LICENSE 文件已核实，
本包各子目录未删 license 说明，Interface 包的 LICENSE.txt 在原始 zip 内）。
直接下载地址（2026-11-18 本机 curl 实测 200，非 kenney.nl 域名，故绕过 403）：

- Interface Sounds（100 文件，1.7 MB zip）：
  https://github.com/Calinou/kenney-interface-sounds/archive/ad144fc2dd079cdd728bc8c7fcf9c4e64a7a7f83.zip
  （来源：Godot Asset Library #794，https://www.godotengine.org/asset-library/asset/794）
- Impact Sounds（130 文件）：
  https://github.com/Boyquotes/kenney-impact-sounds-for-godot/archive/refs/heads/main.zip
- RPG Audio（51 文件）：
  https://github.com/Boyquotes/kenney-rpg-audio-for-godot/archive/refs/heads/main.zip
- Music Jingles（85 文件）：
  https://github.com/Boyquotes/kenney-music-jingles-for-godot/archive/refs/heads/main.zip
- Sci-Fi Sounds（73 文件，未用于本次映射，备用）：
  https://github.com/Boyquotes/kenney-sci-fi-sounds-for-godot/archive/refs/heads/main.zip

另：Cinevva 亦托管 Kenney Interface Sounds 的个别文件（MP3/OGG，CC0）：
https://app.cinevva.com/game-assets/free-ui-sound-effects
（2026-11-18 实测 https://cdn.cinevva.com/assets/audio/kenney/interface-sounds/click_001.mp3 返回 200 真实 MP3）

kenney.nl 本站的失败原因已定位：其下载走签名链接
`https://kenney.nl/download-link/<hex(asset 路径)>`，本机 curl 返回 {"error":"forbidden"} 403；
Pixabay 站点本机 curl 同样 403。以上 GitHub 镜像是绕过该拦截的等效来源，
文件内容为 Kenney 原包（Interface 包为 Godot 社区转的 WAV 版，源自同一 OGG 母版）。

## 给开发方（#14）的接入说明

1. 把 `sfx/*.ogg` 与 `sfx/*.m4a` 拷到仓库 `apps/client/public/audio/sfx/`，
   走 audio.ts 已有的 loadFile 通道（首次 play 才 fetch，缺失/解码失败回退合成，
   无需改接口；`FILES[n]=null` 后需刷新页面才重试，见 #10 校验备注）。
2. BGM 文件到位后放 `apps/client/public/audio/bgm.ogg|bgm.m4a`，并按 #14 要求
   补一条与音效同模式的文件加载路径（循环播放、兼容 setMood/toggleMusic，
   缺失回退合成，AudioApi 接口不变）。
3. 在 `public/audio/` 附 LICENSE/NOTES，记每个文件的来源包与 CC0 许可
   （本 NOTES.md + sfx-mapping.json 可直接作底稿）。
4. 体积口径：24 音效 OGG 248 KB（M4A 208 KB 备用格式）；BGM 体积待补。
   首包影响：音频懒加载，不计入首包；dist 增量在验收时按实际构建产物写明。

## 未完成 / 待核实

- BGM 文件本身：曲目已定（Tropical Bounce，见上），只差用户在自己浏览器点一次
  "Free download" 拿到 MP3（或把直链发来）。到手后转 OGG/M4A、放 `bgm/`、补本文件。
- 本包文件未经人耳试听：映射按合成定义 + 时长挑的，开发方接入后必须逐个试听验收
  （#14 验收含“24 个音效逐个播放真实文件”）。
- 本包**未提交进仓库**：不改代码、不替开发方推代码，只备好文件与来源；
  如何交给开发方（在 #14 下贴映射表 + 镜像链接，或由交付方另行转交）由主 agent 定。
