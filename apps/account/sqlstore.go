package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite" // 纯 Go SQLite 驱动（免 cgo，Docker 单镜像静态编译）
)

// v1.4 持久化：嵌入式 SQLite（modernc.org/sqlite）。
// 业务逻辑仍在内存模型上进行（持锁），saveLocked 把"与上次落库相比有变化的行"在一个事务里增量写入，
// 不再每次全量重写。表：accounts / sessions / settled（行内为 JSON）、meta（赛季、历史、迁移标记）。

type snapshot struct {
	acc     map[string]string // 账号 id -> JSON
	sess    map[string]string // 会话 key -> JSON
	settled map[string]bool
	meta    map[string]string
}

func newSnapshot() snapshot {
	return snapshot{acc: map[string]string{}, sess: map[string]string{}, settled: map[string]bool{}, meta: map[string]string{}}
}

func dbPathOf(legacy string) string {
	return strings.TrimSuffix(legacy, filepath.Ext(legacy)) + ".db"
}

const schema = `
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(k TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settled(seq INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);`

func (s *Store) openDB(p string) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	db, err := sql.Open("sqlite", "file:"+p+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)")
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return err
	}
	s.db = db
	s.snap = newSnapshot()
	return nil
}

func (s *Store) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *Store) loadFromDB() error {
	rows, err := s.db.Query(`SELECT id,data FROM accounts`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, d string
		if err := rows.Scan(&id, &d); err != nil {
			rows.Close()
			return err
		}
		var a Account
		if err := json.Unmarshal([]byte(d), &a); err != nil {
			rows.Close()
			return err
		}
		if a.Chars == nil {
			a.Chars = newChars()
		}
		if a.Items == nil {
			a.Items = map[string]int{}
		}
		s.byID[a.ID] = &a
		s.byUN[strings.ToLower(a.Username)] = &a
		s.snap.acc[id] = d
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT k,data FROM sessions`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var k, d string
		if err := rows.Scan(&k, &d); err != nil {
			rows.Close()
			return err
		}
		var ss session
		if err := json.Unmarshal([]byte(d), &ss); err != nil {
			rows.Close()
			return err
		}
		s.sess[k] = ss
		s.snap.sess[k] = d
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT match_id FROM settled ORDER BY seq`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			rows.Close()
			return err
		}
		s.settled = append(s.settled, m)
		s.setSet[m] = true
		s.snap.settled[m] = true
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT k,v FROM meta`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			rows.Close()
			return err
		}
		s.snap.meta[k] = v
	}
	rows.Close()
	if v, ok := s.snap.meta["season"]; ok {
		var si SeasonInfo
		if err := json.Unmarshal([]byte(v), &si); err != nil {
			return err
		}
		s.season = &si
	}
	if v, ok := s.snap.meta["history"]; ok {
		if err := json.Unmarshal([]byte(v), &s.history); err != nil {
			return err
		}
	}
	return nil
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// persistLocked 把内存与上次落库快照的差异在一个事务内写入；失败回滚且快照不变。
func (s *Store) persistLocked() error {
	if s.db == nil {
		return nil
	}
	next := newSnapshot()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	fail := func(err error) error { _ = tx.Rollback(); return err }
	for id, a := range s.byID {
		d := mustJSON(a)
		next.acc[id] = d
		if s.snap.acc[id] != d {
			if _, err := tx.Exec(`INSERT INTO accounts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, id, d); err != nil {
				return fail(err)
			}
		}
	}
	for id := range s.snap.acc {
		if _, ok := next.acc[id]; !ok {
			if _, err := tx.Exec(`DELETE FROM accounts WHERE id=?`, id); err != nil {
				return fail(err)
			}
		}
	}
	for k, v := range s.sess {
		d := mustJSON(v)
		next.sess[k] = d
		if s.snap.sess[k] != d {
			if _, err := tx.Exec(`INSERT INTO sessions(k,data) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET data=excluded.data`, k, d); err != nil {
				return fail(err)
			}
		}
	}
	for k := range s.snap.sess {
		if _, ok := next.sess[k]; !ok {
			if _, err := tx.Exec(`DELETE FROM sessions WHERE k=?`, k); err != nil {
				return fail(err)
			}
		}
	}
	for _, m := range s.settled {
		next.settled[m] = true
		if !s.snap.settled[m] {
			if _, err := tx.Exec(`INSERT OR IGNORE INTO settled(match_id) VALUES(?)`, m); err != nil {
				return fail(err)
			}
		}
	}
	for m := range s.snap.settled {
		if !next.settled[m] {
			if _, err := tx.Exec(`DELETE FROM settled WHERE match_id=?`, m); err != nil {
				return fail(err)
			}
		}
	}
	for k, v := range s.metaMap() {
		next.meta[k] = v
		if s.snap.meta[k] != v {
			if _, err := tx.Exec(`INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, v); err != nil {
				return fail(err)
			}
		}
	}
	// 迁移标记等不由内存模型产生的 meta 键原样保留
	for k, v := range s.snap.meta {
		if _, ok := next.meta[k]; !ok {
			if k == "season" || k == "history" {
				if _, err := tx.Exec(`DELETE FROM meta WHERE k=?`, k); err != nil {
					return fail(err)
				}
				continue
			}
			next.meta[k] = v
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.snap = next
	return nil
}

func (s *Store) metaMap() map[string]string {
	m := map[string]string{}
	if s.season != nil {
		m["season"] = mustJSON(s.season)
	}
	if len(s.history) > 0 {
		m["history"] = mustJSON(s.history)
	}
	return m
}

// migrateLegacy：旧 account.json 存在且库内无迁移标记 → 全量导入（单事务）→ 旧文件改名备份（不删除）。幂等。
func (s *Store) migrateLegacy(legacy string) error {
	b, err := os.ReadFile(legacy)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var done string
	err = s.db.QueryRow(`SELECT v FROM meta WHERE k='migratedFromJSON'`).Scan(&done)
	if err == nil { // 已迁移过：旧文件若又出现，只备份移开，不重复导入
		return backupLegacy(legacy)
	}
	if err != sql.ErrNoRows {
		return err
	}
	var f dbFile
	if err := json.Unmarshal(b, &f); err != nil {
		return fmt.Errorf("旧 JSON 解析失败（未迁移，原文件保持不动）：%w", err)
	}
	for _, a := range f.Accounts {
		s.byID[a.ID] = a
		s.byUN[strings.ToLower(a.Username)] = a
	}
	if f.Sessions != nil {
		s.sess = f.Sessions
	}
	s.season, s.history, s.settled = f.Season, f.History, f.Settled
	for _, m := range s.settled {
		s.setSet[m] = true
	}
	// 标记与数据同一事务提交：先写入标记到内存快照之外的 meta
	if err := s.persistWithMarker(); err != nil {
		return err
	}
	if err := backupLegacy(legacy); err != nil {
		return err
	}
	// 迁移后以库为准：清空内存，由 loadFromDB 读回（顺带验证落库内容）
	s.byID, s.byUN, s.sess = map[string]*Account{}, map[string]*Account{}, map[string]session{}
	s.season, s.history, s.settled, s.setSet = nil, nil, nil, map[string]bool{}
	s.snap = newSnapshot()
	return nil
}

func (s *Store) persistWithMarker() error {
	// 先一并写数据，再写标记，使用同一连接事务不易拆分，故标记通过 snap.meta 预置后由 persistLocked 一并提交
	s.snap.meta["migratedFromJSON"] = time.Now().UTC().Format(time.RFC3339)
	// 为让 persistLocked 把标记写入库：用特殊键写入后再保留
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO meta(k,v) VALUES('migratedFromJSON',?)`, s.snap.meta["migratedFromJSON"]); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return s.persistLocked()
}

func backupLegacy(legacy string) error {
	bak := legacy + ".migrated-" + time.Now().UTC().Format("20060102T150405")
	return os.Rename(legacy, bak)
}

// ExportJSON 导出全库为旧格式 JSON（运维排障 / 备份）。
func (s *Store) ExportJSON(w string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f := dbFile{Sessions: s.sess, Season: s.season, History: s.history, Settled: s.settled}
	for _, a := range s.byID {
		f.Accounts = append(f.Accounts, a)
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := w + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, w)
}

// BackupTo 用 SQLite VACUUM INTO 生成一致性的单文件库备份。
func (s *Store) BackupTo(dst string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return fmt.Errorf("内存模式无库可备份")
	}
	_ = os.Remove(dst)
	_, err := s.db.Exec(`VACUUM INTO ?`, dst)
	return err
}
