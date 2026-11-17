/**
 * 单机压测：同 seed 序列机器人打 N 局（默认 1000），检查无崩溃、无死局（必须打完），并抽查回放一致性。
 *   npm run stress -w @dt/server            # 默认 1000 局
 *   STRESS_GAMES=200 npm run stress -w @dt/server
 * 输出耗时 / 内存 / 失败数报告到 stdout，并写 STRESS_REPORT（默认 ./data/stress-report.json）；有失败则退出码 1。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ReplayRecorder, actorOf, applyAction, botAction, checkReplayConsistency, createGame,
  type BotDifficulty, type GameConfig,
} from '@dt/shared';

const GAMES = Number(process.env.STRESS_GAMES || 1000);
const MAX_STEPS = 8000;
const CHECK_EVERY = Number(process.env.STRESS_CHECK_EVERY || 10);
const DIFFS: BotDifficulty[] = ['easy', 'normal', 'hard'];
const CHARS = ['jin', 'li', 'wang', 'xing'] as const;
const failures: { seed: number; kind: string; detail: string }[] = [];
let totalSteps = 0, maxStepsSeen = 0, replayChecked = 0, peakRss = 0, ended = 0;
const winReasons: Record<string, number> = {};
const t0 = Date.now();

for (let i = 0; i < GAMES; i++) {
  const seed = (1000 + i * 7919) >>> 0;
  const cfg: GameConfig = {
    seed, specials: true, itemsV8: true,
    seats: CHARS.map((c, k) => ({ id: `b${k}`, name: `机器人${k}`, charId: c, isBot: true, difficulty: DIFFS[(i + k) % 3] })),
  };
  try {
    let s = createGame(cfg);
    const rec = new ReplayRecorder(cfg);
    let steps = 0;
    while (s.phase !== 'ended' && steps < MAX_STEPS) {
      const who = actorOf(s);
      const a = botAction(s, who);
      const r = applyAction(s, who, a);
      if (!r.ok) { failures.push({ seed, kind: 'illegal_bot_action', detail: `${r.error} @${steps}` }); break; }
      rec.push(who, a);
      s = r.state; steps++;
    }
    totalSteps += steps; maxStepsSeen = Math.max(maxStepsSeen, steps);
    if (s.phase !== 'ended') { if (!failures.some((f) => f.seed === seed)) failures.push({ seed, kind: 'deadlock', detail: `${MAX_STEPS} 步未结束` }); continue; }
    ended++;
    winReasons[s.winReason ?? 'none'] = (winReasons[s.winReason ?? 'none'] ?? 0) + 1;
    if (i % CHECK_EVERY === 0) {
      replayChecked++;
      const c = checkReplayConsistency(rec.toRecord(s), s);
      if (!c.ok) failures.push({ seed, kind: 'replay_mismatch', detail: c.reason ?? '' });
    }
  } catch (e) {
    failures.push({ seed, kind: 'crash', detail: (e as Error).message });
  }
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}

const report = {
  kind: 'stress-local', games: GAMES, ended, failed: failures.length,
  elapsedMs: Date.now() - t0, avgStepsPerGame: Math.round(totalSteps / GAMES), maxSteps: maxStepsSeen,
  replayChecked, winReasons, peakRssMB: Math.round(peakRss / 1048576), failures: failures.slice(0, 20),
};
console.log(JSON.stringify(report, null, 2));
const out = process.env.STRESS_REPORT || 'data/stress-report.json';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
process.exit(failures.length ? 1 : 0);
