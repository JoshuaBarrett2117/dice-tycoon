package main

import (
	"testing"
	"time"
)

func reg(t *testing.T, s *Server, name string) string {
	t.Helper()
	_, r := call(t, s, "POST", "/api/account/register", "", cred{name, "secret1"})
	return r["account"].(map[string]any)["id"].(string)
}

func settle(t *testing.T, s *Server, tok, match string, rs []PlaceResult) (int, map[string]any) {
	return call(t, s, "POST", "/internal/settle", tok, map[string]any{"matchId": match, "results": rs})
}

func TestSettleAndBoard(t *testing.T) {
	s, _ := newSrv(t)
	a, b := reg(t, s, "alice"), reg(t, s, "bobby")
	if c, _ := settle(t, s, "", "m1", nil); c != 404 {
		t.Fatalf("no token should 404, got %d", c)
	}
	if c, _ := settle(t, s, "bad", "m1", []PlaceResult{{a, 1, "jin"}}); c != 404 {
		t.Fatalf("bad token should 404, got %d", c)
	}
	rs := []PlaceResult{{a, 1, "jin"}, {b, 4, "li"}, {"acc_nobody", 2, "jin"}}
	if c, r := settle(t, s, "tok", "m1", rs); c != 200 || len(r["settled"].([]any)) != 2 {
		t.Fatalf("settle %d %v", c, r)
	}
	va, _ := s.st.View(a)
	if va.Rating != 25 || va.Wins != 1 || va.Games != 1 || va.Coins != 260 || va.Chars["jin"].Exp != 30 {
		t.Fatalf("winner %+v", va)
	}
	vb, _ := s.st.View(b)
	if vb.Rating != 0 || vb.Coins != 215 || vb.Wins != 0 || vb.Games != 1 { // 段位分不会低于 0
		t.Fatalf("loser %+v", vb)
	}
	// 幂等：同一 matchId 不重复结算
	settle(t, s, "tok", "m1", rs)
	if v, _ := s.st.View(a); v.Rating != 25 || v.Coins != 260 {
		t.Fatalf("not idempotent %+v", v)
	}
	// 第二局名次 2：+10
	settle(t, s, "tok", "m2", []PlaceResult{{b, 2, "li"}})
	if v, _ := s.st.View(b); v.Rating != 10 {
		t.Fatalf("rating %d", v.Rating)
	}
	c, r := call(t, s, "GET", "/api/account/leaderboard?by=rating", "", nil)
	list := r["list"].([]any)
	if c != 200 || len(list) != 2 || list[0].(map[string]any)["username"] != "alice" || list[0].(map[string]any)["rank"].(float64) != 1 {
		t.Fatalf("board %d %v", c, r)
	}
	e := list[0].(map[string]any)
	for _, k := range []string{"hash", "salt", "id", "token", "accountId"} {
		if _, ok := e[k]; ok {
			t.Fatalf("board leaks %s", k)
		}
	}
	if c, _ := call(t, s, "GET", "/api/account/leaderboard?by=wins&n=1", "", nil); c != 200 {
		t.Fatal("wins board")
	}
	if c, r := call(t, s, "GET", "/api/account/leaderboard?by=assets", "", nil); c != 200 || len(r["list"].([]any)) != 2 {
		t.Fatalf("assets board %v", r)
	}
	if c, _ := call(t, s, "GET", "/api/account/leaderboard?by=x", "", nil); c != 400 {
		t.Fatalf("bad by should 400, got %d", c)
	}
}

func TestTierOf(t *testing.T) {
	for r, w := range map[int]string{0: "青铜", 99: "青铜", 100: "白银", 599: "黄金", 600: "铂金", 1000: "钻石", 9999: "王者"} {
		if TierOf(r) != w {
			t.Fatalf("%d → %s", r, TierOf(r))
		}
	}
}

func TestSeasonRollover(t *testing.T) {
	s, _ := newSrv(t)
	now := time.Unix(1_700_000_000, 0)
	s.st.clock = func() time.Time { return now }
	a := reg(t, s, "alice")
	settle(t, s, "tok", "m1", []PlaceResult{{a, 1, "jin"}})
	settle(t, s, "tok", "m2", []PlaceResult{{a, 1, "jin"}}) // 50 分，赛季胜 2
	cur, _ := s.st.SeasonView()
	if cur.ID != 1 {
		t.Fatalf("season %+v", cur)
	}
	now = now.Add(SeasonDays*24*time.Hour + time.Hour) // 赛季结束
	// 进行中的对局不受影响：新赛季开始后结算照常，落在新赛季
	settle(t, s, "tok", "m3", []PlaceResult{{a, 2, "jin"}})
	v, _ := s.st.View(a)
	if v.Rating != 50*SeasonKeepPct/100+10 || v.SeasonWins != 0 || v.Wins != 2 {
		t.Fatalf("after roll %+v", v)
	}
	cur, hist := s.st.SeasonView()
	if cur.ID != 2 || len(hist) != 1 || hist[0].ID != 1 || hist[0].Top[0].Username != "alice" || hist[0].Top[0].Rating != 50 || hist[0].Top[0].Wins != 2 {
		t.Fatalf("history %+v %+v", cur, hist)
	}
	// 停机很久：连滚多个赛季
	now = now.Add(3 * SeasonDays * 24 * time.Hour)
	if cur, hist = s.st.SeasonView(); cur.ID < 4 || len(hist) < 3 {
		t.Fatalf("multi roll %+v %d", cur, len(hist))
	}
	// 持久化：重开后赛季与历史仍在
	st2, err := NewStore(s.st.path)
	if err != nil {
		t.Fatal(err)
	}
	if st2.season == nil || st2.season.ID != cur.ID || len(st2.history) != len(hist) || !st2.setSet["m1"] {
		t.Fatal("not persisted")
	}
	if c, r := call(t, s, "GET", "/api/account/season", "", nil); c != 200 || r["season"] == nil {
		t.Fatalf("season api %v", r)
	}
}
