/**
 * 埋点：本地 JSONL 记录 + 可选 HTTP 上报端点。
 * - TELEMETRY=off 关闭（默认开启本地记录）；TELEMETRY_DIR 指定目录（默认 ./data/telemetry，按天一个文件）
 * - TELEMETRY_ENDPOINT 配置后额外 POST 每条记录（默认不上传）；失败静默
 * - 不记录 accountId、令牌、IP；座位只用序号与昵称；日志写失败不影响对局
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type TelemetryType =
  | 'match_start' | 'match_end' | 'risk_reject' | 'replay_check' | 'anomaly';

export const telemetryEnabled = () => String(process.env.TELEMETRY || 'on').toLowerCase() !== 'off';
export const telemetryDir = () => process.env.TELEMETRY_DIR || join(process.cwd(), 'data', 'telemetry');

export function track(type: TelemetryType, room: string, data: Record<string, unknown> = {}) {
  if (!telemetryEnabled()) return;
  const rec = { ts: new Date().toISOString(), type, room, ...data };
  try {
    const dir = telemetryDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${rec.ts.slice(0, 10)}.jsonl`), JSON.stringify(rec) + '\n');
  } catch { /* 埋点不得影响对局 */ }
  const ep = process.env.TELEMETRY_ENDPOINT;
  if (ep) void fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) }).catch(() => {});
}
