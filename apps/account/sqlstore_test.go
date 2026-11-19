package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func legacyFixture(t *testing.T) (string, dbFile) {
	f := dbFile{
		Accounts: []*Account{
			{ID: "acc_1", Username: "alice", Salt: "aa", Hash: "bb", Coins: 321, Chars: map[string]CharProgress{"jin": {Exp: 150, Level: 2}}, Items: map[string]int{"shield": 2},
				LastCheck: "2026-11-01", Rating: 130, Games: 9, Wins: 4, SeasonWins: 3, Created: 1700000000},
			{ID: "acc_2", Username: "Bob", Salt: "cc", Hash: "dd", Coins: 5, Chars: newChars(), Items: map[string]int{}, Rating: 20, Created: 1700000100},
		},
		Sessions: map[string]session{"h1": {AccountID: "acc_1", Exp: 4102444800}},
		Season:   &SeasonInfo{ID: 3, Start: 100, End: 200},
		History:  []SeasonRecord{{ID: 2, Start: 1, End: 99, Top: []RankEntry{{Rank: 1, Username: "alice", Rating: 130, Tier: "白银", Wins: 3, Games: 9, Assets: 5000}}}},
		Settled:  []string{"m1", "m2", "m3"},
	}
	p := filepath.Join(t.TempDir(), "data", "account.json")
	os.MkdirAll(filepath.Dir(p), 0o755)
	b, _ := json.Marshal(f)
	os.WriteFile(p, b, 0o600)
	return p, f
}

func TestMigrateFromJSON(t *testing.T) {
	p, f := legacyFixture(t)
	st, err := NewStore(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range f.Accounts {
		got, ok := st.byID[want.ID]
		if !ok || !reflect.DeepEqual(got, want) {
			t.Fatalf("account %s mismatch: %+v vs %+v", want.ID, got, want)
		}
		if st.byUN[strings.ToLower(want.Username)] == nil {
			t.Fatal("username index")
		}
	}
	if !reflect.DeepEqual(st.sess, f.Sessions) || !reflect.DeepEqual(st.season, f.Season) || !reflect.DeepEqual(st.history, f.History) || !reflect.DeepEqual(st.settled, f.Settled) || !st.setSet["m2"] {
		t.Fatal("season/history/settled/sessions mismatch")
	}
	// 旧文件保留为备份，不删除
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("legacy file should be renamed")
	}
	baks, _ := filepath.Glob(p + ".migrated-*")
	if len(baks) != 1 {
		t.Fatalf("backup files %v", baks)
	}
	st.Close()
}

func TestMigrateIdempotent(t *testing.T) {
	p, f := legacyFixture(t)
	st, _ := NewStore(p)
	st.Register("carol", "secret1")
	st.Close()
	// 重复启动：不重复迁移，新增数据不丢
	st2, err := NewStore(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(st2.byID) != len(f.Accounts)+1 {
		t.Fatalf("accounts %d", len(st2.byID))
	}
	st2.Close()
	// 旧文件意外再次出现：只备份移开，不覆盖库
	b, _ := json.Marshal(dbFile{Accounts: []*Account{{ID: "acc_x", Username: "ghost", Chars: newChars(), Items: map[string]int{}}}})
	os.WriteFile(p, b, 0o600)
	st3, err := NewStore(p)
	if err != nil {
		t.Fatal(err)
	}
	if st3.byUN["ghost"] != nil || len(st3.byID) != len(f.Accounts)+1 {
		t.Fatal("re-migrated")
	}
	st3.Close()
}

func TestMigrateBadJSONKeepsFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "account.json")
	os.WriteFile(p, []byte("{broken"), 0o600)
	if _, err := NewStore(p); err == nil {
		t.Fatal("expect error")
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatal("legacy must remain")
	}
}

func TestSQLiteConcurrentWrites(t *testing.T) {
	p := filepath.Join(t.TempDir(), "account.json")
	st, _ := NewStore(p)
	a, _ := st.Register("dave", "secret1")
	st.Grant(a.ID, "jin", 100000, 0)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := st.Buy(a.ID, "dice", 1); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	st.Close()
	st2, _ := NewStore(p)
	v, _ := st2.View(a.ID)
	if v.Items["dice"] != 20 || v.Coins != 200+100000-20*120 {
		t.Fatalf("after concurrent %+v", v)
	}
	st2.Close()
}

func TestExportAndBackup(t *testing.T) {
	p, f := legacyFixture(t)
	st, _ := NewStore(p)
	out := filepath.Join(t.TempDir(), "x.json")
	if err := st.ExportJSON(out); err != nil {
		t.Fatal(err)
	}
	var g dbFile
	b, _ := os.ReadFile(out)
	if err := json.Unmarshal(b, &g); err != nil || len(g.Accounts) != len(f.Accounts) || len(g.Settled) != 3 {
		t.Fatalf("export %v %+v", err, g)
	}
	bk := filepath.Join(t.TempDir(), "b.db")
	if err := st.BackupTo(bk); err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(bk); err != nil || fi.Size() == 0 {
		t.Fatal("backup")
	}
	st.Close()
}
