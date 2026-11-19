package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func newSrv(t *testing.T) (*Server, *time.Time) {
	t.Helper()
	st, err := NewStore(filepath.Join(t.TempDir(), "a.json"))
	if err != nil {
		t.Fatal(err)
	}
	kr, _ := ParseKeyRing("k1:secret-one,k0:secret-old")
	now := time.Unix(1_700_000_000, 0)
	return &Server{st: st, keys: kr, internalToken: "tok", now: func() time.Time { return now }}, &now
}

func call(t *testing.T, s *Server, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var b bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&b).Encode(body)
	}
	req := httptest.NewRequest(method, path, &b)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestRegisterLogin(t *testing.T) {
	s, _ := newSrv(t)
	c, r := call(t, s, "POST", "/api/account/register", "", cred{"alice", "secret1"})
	if c != 201 || r["token"] == "" {
		t.Fatalf("register %d %v", c, r)
	}
	if c, _ = call(t, s, "POST", "/api/account/register", "", cred{"ALICE", "secret1"}); c != 409 {
		t.Fatalf("duplicate should 409, got %d", c)
	}
	if c, _ = call(t, s, "POST", "/api/account/register", "", cred{"a", "secret1"}); c != 400 {
		t.Fatalf("short name should 400, got %d", c)
	}
	if c, _ = call(t, s, "POST", "/api/account/register", "", cred{"bobby", "123"}); c != 400 {
		t.Fatalf("short pass should 400, got %d", c)
	}
	if c, _ = call(t, s, "POST", "/api/account/login", "", cred{"alice", "wrong!!"}); c != 401 {
		t.Fatalf("bad pass should 401, got %d", c)
	}
	c, r = call(t, s, "POST", "/api/account/login", "", cred{"alice", "secret1"})
	if c != 200 {
		t.Fatalf("login %d", c)
	}
	tok := r["token"].(string)
	c, r = call(t, s, "GET", "/api/account/me", tok, nil)
	acc := r["account"].(map[string]any)
	if c != 200 || acc["username"] != "alice" || acc["coins"].(float64) != 200 {
		t.Fatalf("me %d %v", c, r)
	}
	if _, has := acc["Hash"]; has || acc["hash"] != "" {
		t.Fatal("hash leaked")
	}
	if c, _ = call(t, s, "GET", "/api/account/me", "", nil); c != 401 {
		t.Fatalf("no token should 401, got %d", c)
	}
	call(t, s, "POST", "/api/account/logout", tok, nil)
	if c, _ = call(t, s, "GET", "/api/account/me", tok, nil); c != 401 {
		t.Fatal("logged-out token still valid")
	}
}

func TestSessionExpiry(t *testing.T) {
	s, _ := newSrv(t)
	a, _ := s.st.Register("carol", "secret1")
	tok, _ := s.st.NewSession(a.ID, time.Hour)
	if _, ok := s.st.Auth(tok); !ok {
		t.Fatal("should be valid")
	}
	base := time.Now()
	s.st.clock = func() time.Time { return base.Add(2 * time.Hour) }
	if _, ok := s.st.Auth(tok); ok {
		t.Fatal("should be expired")
	}
}

func TestTicket(t *testing.T) {
	kr, _ := ParseKeyRing("k1:secret-one,k0:secret-old")
	now := time.Unix(1_700_000_000, 0)
	tk, _ := kr.Issue("acc_1", now, time.Minute)
	if id, err := kr.Verify(tk, now.Add(30*time.Second)); err != nil || id != "acc_1" {
		t.Fatalf("valid ticket: %v %v", id, err)
	}
	if _, err := kr.Verify(tk, now.Add(time.Minute)); err != ErrTicketExpired {
		t.Fatalf("want expired, got %v", err)
	}
	// 篡改 payload
	other, _ := kr.Issue("acc_2", now, time.Minute)
	forged := other[:indexDot(other)] + tk[indexDot(tk):]
	if _, err := kr.Verify(forged, now); err != ErrTicketSignature {
		t.Fatalf("want signature err, got %v", err)
	}
	for _, bad := range []string{"", "abc", "a.b.c", ".", "x."} {
		if _, err := kr.Verify(bad, now); err == nil {
			t.Fatalf("%q should fail", bad)
		}
	}
	// 另一套密钥签的票据（同 kid 不同密钥）
	kr2, _ := ParseKeyRing("k1:different")
	tk2, _ := kr2.Issue("acc_1", now, time.Minute)
	if _, err := kr.Verify(tk2, now); err != ErrTicketSignature {
		t.Fatalf("want signature err, got %v", err)
	}
	// 轮换：旧密钥签的票据，新环仍可校验；环里没有该 kid 则拒绝
	old, _ := ParseKeyRing("k0:secret-old")
	tkOld, _ := old.Issue("acc_1", now, time.Minute)
	if _, err := kr.Verify(tkOld, now); err != nil {
		t.Fatalf("rotation: old key should verify: %v", err)
	}
	nw, _ := ParseKeyRing("k9:other")
	if _, err := nw.Verify(tkOld, now); err != ErrTicketUnknownKey {
		t.Fatalf("want unknown key, got %v", err)
	}
	if _, err := ParseKeyRing(""); err == nil {
		t.Fatal("empty keys should fail")
	}
}

func indexDot(s string) int {
	for i := range s {
		if s[i] == '.' {
			return i
		}
	}
	return -1
}

func TestTicketEndpoint(t *testing.T) {
	s, now := newSrv(t)
	_, r := call(t, s, "POST", "/api/account/register", "", cred{"dave", "secret1"})
	tok := r["token"].(string)
	c, r := call(t, s, "POST", "/api/account/ticket", tok, nil)
	if c != 200 {
		t.Fatalf("ticket %d", c)
	}
	id, err := s.keys.Verify(r["ticket"].(string), *now)
	if err != nil || id != r["accountId"] {
		t.Fatalf("verify %v %v", id, err)
	}
	if c, _ = call(t, s, "POST", "/api/account/ticket", "", nil); c != 401 {
		t.Fatal("ticket without login must 401")
	}
}

func TestShopTrainCheckin(t *testing.T) {
	s, _ := newSrv(t)
	_, r := call(t, s, "POST", "/api/account/register", "", cred{"erin", "secret1"})
	tok := r["token"].(string)
	// 买 70 的免税卡 ×2 = 140，剩 60
	c, r := call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "taxFree", "qty": 2})
	acc := r["account"].(map[string]any)
	if c != 200 || acc["coins"].(float64) != 60 || acc["items"].(map[string]any)["taxFree"].(float64) != 2 {
		t.Fatalf("buy %d %v", c, r)
	}
	if c, _ = call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "dice", "qty": 1}); c != 402 {
		t.Fatalf("poor should 402, got %d", c)
	}
	if c, _ = call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "nope"}); c != 400 {
		t.Fatalf("bad item should 400, got %d", c)
	}
	// 签到 +50 → 110，当天不能重复
	c, r = call(t, s, "POST", "/api/account/checkin", tok, nil)
	if c != 200 || r["bonus"].(float64) != 50 {
		t.Fatalf("checkin %d %v", c, r)
	}
	if c, _ = call(t, s, "POST", "/api/account/checkin", tok, nil); c != 409 {
		t.Fatalf("repeat checkin should 409, got %d", c)
	}
	// 训练：50 币 +40 经验；3 次到 120 经验 → 2 级（第三次需要补币）
	call(t, s, "POST", "/api/account/train", tok, map[string]any{"char": "jin"})
	call(t, s, "POST", "/api/account/train", tok, map[string]any{"char": "jin"})
	if c, _ = call(t, s, "POST", "/api/account/train", tok, map[string]any{"char": "jin"}); c != 402 {
		t.Fatalf("out of coins should 402, got %d", c)
	}
	if c, _ = call(t, s, "POST", "/api/account/train", tok, map[string]any{"char": "ghost"}); c != 400 {
		t.Fatalf("bad char should 400, got %d", c)
	}
	_, r = call(t, s, "GET", "/api/account/me", tok, nil)
	jin := r["account"].(map[string]any)["chars"].(map[string]any)["jin"].(map[string]any)
	if jin["exp"].(float64) != 80 || jin["level"].(float64) != 1 {
		t.Fatalf("jin %v", jin)
	}
	// 内部发放
	if c, _ = call(t, s, "POST", "/internal/grant", "bad", map[string]any{}); c != 404 {
		t.Fatalf("grant without token should 404, got %d", c)
	}
	id := r["account"].(map[string]any)["id"]
	c, r = call(t, s, "POST", "/internal/grant", "tok", map[string]any{"accountId": id, "char": "jin", "coins": 10, "exp": 50})
	jin = r["account"].(map[string]any)["chars"].(map[string]any)["jin"].(map[string]any)
	if c != 200 || jin["level"].(float64) != 2 {
		t.Fatalf("grant %d %v", c, r)
	}
	if LevelOf(1_000_000) != maxLevel {
		t.Fatal("level cap")
	}
}

func TestPersistence(t *testing.T) {
	p := filepath.Join(t.TempDir(), "d", "a.json")
	st, _ := NewStore(p)
	a, _ := st.Register("frank", "secret1")
	st.Buy(a.ID, "shield", 1)
	st2, err := NewStore(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st2.Login("frank", "secret1"); err != nil {
		t.Fatalf("login after reload: %v", err)
	}
	v, _ := st2.View(a.ID)
	if v.Items["shield"] != 1 || v.Coins != 100 {
		t.Fatalf("reload view %+v", v)
	}
	_ = http.StatusOK
}
