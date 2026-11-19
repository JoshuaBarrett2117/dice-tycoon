package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	sessionTTL = 7 * 24 * time.Hour
	ticketTTL  = 5 * time.Minute // 票据只用于入座，短有效期；客户端每次入座前现取
)

type Server struct {
	st            *Store
	keys          *KeyRing
	internalToken string // 内部发放接口口令；为空则关闭该接口
	now           func() time.Time
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("POST /api/account/register", s.register)
	mux.HandleFunc("POST /api/account/login", s.login)
	mux.HandleFunc("POST /api/account/logout", s.authed(s.logout))
	mux.HandleFunc("GET /api/account/me", s.authed(s.me))
	mux.HandleFunc("POST /api/account/ticket", s.authed(s.ticket))
	mux.HandleFunc("POST /api/account/checkin", s.authed(s.checkin))
	mux.HandleFunc("POST /api/account/train", s.authed(s.train))
	mux.HandleFunc("GET /api/account/shop", s.shop)
	mux.HandleFunc("POST /api/account/shop/buy", s.authed(s.buy))
	mux.HandleFunc("GET /api/account/leaderboard", s.leaderboard)
	mux.HandleFunc("GET /api/account/season", s.seasonInfo)
	mux.HandleFunc("POST /internal/grant", s.grant)
	mux.HandleFunc("POST /internal/settle", s.settle)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, err error) {
	code := http.StatusBadRequest
	switch {
	case errors.Is(err, ErrBadCred):
		code = http.StatusUnauthorized
	case errors.Is(err, ErrExists), errors.Is(err, ErrAlready):
		code = http.StatusConflict
	case errors.Is(err, ErrNoCoins):
		code = http.StatusPaymentRequired
	case errors.Is(err, ErrNotFound):
		code = http.StatusNotFound
	case !errors.Is(err, ErrInvalid):
		code = http.StatusInternalServerError
		err = errors.New("服务器内部错误")
	}
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func decode(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<14)
	if json.NewDecoder(r.Body).Decode(v) != nil {
		return ErrInvalid
	}
	return nil
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return h[7:]
	}
	return ""
}

type authedFn func(w http.ResponseWriter, r *http.Request, a *Account, tok string)

func (s *Server) authed(fn authedFn) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := bearer(r)
		a, ok := s.st.Auth(tok)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录或会话已过期"})
			return
		}
		fn(w, r, a, tok)
	}
}

type cred struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) sessionResp(w http.ResponseWriter, code int, a *Account) {
	tok, err := s.st.NewSession(a.ID, sessionTTL)
	if err != nil {
		fail(w, err)
		return
	}
	v, _ := s.st.View(a.ID)
	writeJSON(w, code, map[string]any{"token": tok, "account": v})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var c cred
	if err := decode(r, &c); err != nil {
		fail(w, err)
		return
	}
	a, err := s.st.Register(c.Username, c.Password)
	if err != nil {
		fail(w, err)
		return
	}
	s.sessionResp(w, http.StatusCreated, a)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var c cred
	if err := decode(r, &c); err != nil {
		fail(w, err)
		return
	}
	a, err := s.st.Login(c.Username, c.Password)
	if err != nil {
		fail(w, err)
		return
	}
	s.sessionResp(w, http.StatusOK, a)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request, a *Account, tok string) {
	s.st.Logout(tok)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request, a *Account, tok string) {
	v, _ := s.st.View(a.ID)
	writeJSON(w, 200, map[string]any{"account": v})
}

func (s *Server) ticket(w http.ResponseWriter, r *http.Request, a *Account, tok string) {
	t, exp := s.keys.Issue(a.ID, s.now(), ticketTTL)
	writeJSON(w, 200, map[string]any{"ticket": t, "accountId": a.ID, "expiresAt": exp.Unix()})
}

func (s *Server) checkin(w http.ResponseWriter, r *http.Request, a *Account, tok string) {
	v, bonus, err := s.st.Checkin(a.ID)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"account": v, "bonus": bonus})
}

func (s *Server) train(w http.ResponseWriter, r *http.Request, a *Account, tok string) {
	var b struct {
		Char string `json:"char"`
	}
	if err := decode(r, &b); err != nil {
		fail(w, err)
		return
	}
	v, err := s.st.Train(a.ID, b.Char)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"account": v})
}

func (s *Server) shop(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"items": []ShopItem{}, "train": map[string]int{"cost": TrainCost, "exp": TrainExp, "expPerLevel": expPerLevel, "maxLevel": maxLevel}})
}

func (s *Server) buy(w http.ResponseWriter, r *http.Request, a *Account, tok string) {
	var b struct {
		Item string `json:"item"`
		Qty  int    `json:"qty"`
	}
	if err := decode(r, &b); err != nil {
		fail(w, err)
		return
	}
	if b.Qty == 0 {
		b.Qty = 1
	}
	v, err := s.st.Buy(a.ID, b.Item, b.Qty)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"account": v})
}

func (s *Server) grant(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || s.internalToken == "" ||
		subtle.ConstantTimeCompare([]byte(bearer(r)), []byte(s.internalToken)) != 1 {
		http.NotFound(w, r)
		return
	}
	var b struct {
		AccountID string `json:"accountId"`
		Char      string `json:"char"`
		Coins     int    `json:"coins"`
		Exp       int    `json:"exp"`
	}
	if err := decode(r, &b); err != nil {
		fail(w, err)
		return
	}
	v, err := s.st.Grant(b.AccountID, b.Char, b.Coins, b.Exp)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"account": v})
}

func (s *Server) internalOK(r *http.Request) bool {
	return s.internalToken != "" && subtle.ConstantTimeCompare([]byte(bearer(r)), []byte(s.internalToken)) == 1
}

// settle 对战服在联机对局结束后上报名次（需 INTERNAL_TOKEN）；幂等。
func (s *Server) settle(w http.ResponseWriter, r *http.Request) {
	if !s.internalOK(r) {
		http.NotFound(w, r)
		return
	}
	var b struct {
		MatchID string        `json:"matchId"`
		Results []PlaceResult `json:"results"`
	}
	if err := decode(r, &b); err != nil {
		fail(w, err)
		return
	}
	out, err := s.st.Settle(b.MatchID, b.Results)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"settled": out})
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	n, _ := strconv.Atoi(r.URL.Query().Get("n"))
	list, season, err := s.st.Leaderboard(r.URL.Query().Get("by"), n)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"by": strings.ToLower(r.URL.Query().Get("by")), "season": season, "list": list})
}

func (s *Server) seasonInfo(w http.ResponseWriter, r *http.Request) {
	cur, hist := s.st.SeasonView()
	writeJSON(w, 200, map[string]any{"season": cur, "history": hist, "days": SeasonDays})
}
