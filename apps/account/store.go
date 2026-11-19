package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// 持久化：单文件 JSON（原子写：写临时文件再 rename）。账号量级小，优先简单可靠。

const (
	pbkdf2Iter  = 60000
	expPerLevel = 100
	maxLevel    = 20
)

var CharIDs = []string{"jin", "li", "wang", "xing", "panda", "rock"}

// ShopItems 与对战服 ITEM_IDS 对应（id 一致）；price 为提案值。
var ShopItems = []ShopItem{
	{"dice", "遥控骰子", 120}, {"roadblock", "路障卡", 80}, {"shield", "护盾卡", 100},
	{"doubleToll", "双倍收租卡", 150}, {"demolish", "强拆卡", 150}, {"freeBuild", "免费建造卡", 130},
	{"teleport", "传送卡", 140}, {"swap", "换位卡", 110}, {"taxFree", "免税卡", 70}, {"freeze", "冻结卡", 120},
}

type ShopItem struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Price int    `json:"price"`
}

type CharProgress struct {
	Exp   int `json:"exp"`
	Level int `json:"level"`
}

type Account struct {
	ID        string                  `json:"id"`
	Username  string                  `json:"username"`
	Salt      string                  `json:"salt"`
	Hash      string                  `json:"hash"`
	Coins     int                     `json:"coins"`
	Chars     map[string]CharProgress `json:"chars"`
	Items     map[string]int          `json:"items"`
	LastCheck string                  `json:"lastCheckin"`
	Created   int64                   `json:"created"`
}

type session struct {
	AccountID string `json:"a"`
	Exp       int64  `json:"e"`
}

type dbFile struct {
	Accounts []*Account         `json:"accounts"`
	Sessions map[string]session `json:"sessions"` // key = sha256(token) hex
}

var (
	ErrExists   = errors.New("用户名已被占用")
	ErrBadCred  = errors.New("用户名或密码错误")
	ErrInvalid  = errors.New("参数无效")
	ErrNoCoins  = errors.New("金币不足")
	ErrAlready  = errors.New("今天已经签到过了")
	ErrNotFound = errors.New("不存在")
)

type Store struct {
	mu    sync.Mutex
	path  string
	byID  map[string]*Account
	byUN  map[string]*Account
	sess  map[string]session
	clock func() time.Time
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, byID: map[string]*Account{}, byUN: map[string]*Account{}, sess: map[string]session{}, clock: time.Now}
	if path == "" {
		return s, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	var f dbFile
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	for _, a := range f.Accounts {
		s.byID[a.ID] = a
		s.byUN[strings.ToLower(a.Username)] = a
	}
	if f.Sessions != nil {
		s.sess = f.Sessions
	}
	return s, nil
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	f := dbFile{Sessions: s.sess}
	for _, a := range s.byID {
		f.Accounts = append(f.Accounts, a)
	}
	b, err := json.Marshal(f)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// PBKDF2-HMAC-SHA256（标准库在 Go 1.24 前没有，自己实现一次）
func pbkdf2(pass, salt []byte, iter, keyLen int) []byte {
	var out []byte
	for block := 1; len(out) < keyLen; block++ {
		m := hmac.New(sha256.New, pass)
		m.Write(salt)
		m.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		u := m.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iter; i++ {
			m = hmac.New(sha256.New, pass)
			m.Write(u)
			u = m.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

func hashPass(pass string, salt []byte) string {
	return hex.EncodeToString(pbkdf2([]byte(pass), salt, pbkdf2Iter, 32))
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func validUser(u string) bool {
	r := []rune(u)
	if len(r) < 3 || len(r) > 20 {
		return false
	}
	for _, c := range r {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func LevelOf(exp int) int {
	l := 1 + exp/expPerLevel
	if l > maxLevel {
		l = maxLevel
	}
	return l
}

func newChars() map[string]CharProgress {
	m := map[string]CharProgress{}
	for _, c := range CharIDs {
		m[c] = CharProgress{Level: 1}
	}
	return m
}

func (s *Store) Register(username, password string) (*Account, error) {
	if !validUser(username) || len(password) < 6 || len(password) > 72 {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.byUN[strings.ToLower(username)]; ok {
		return nil, ErrExists
	}
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	a := &Account{ID: "acc_" + randHex(8), Username: username, Salt: hex.EncodeToString(salt), Hash: hashPass(password, salt),
		Coins: 200, Chars: newChars(), Items: map[string]int{}, Created: s.clock().Unix()}
	s.byID[a.ID] = a
	s.byUN[strings.ToLower(username)] = a
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	return a, nil
}

func (s *Store) Login(username, password string) (*Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byUN[strings.ToLower(username)]
	salt := []byte("dummy-salt-dummy")
	if ok {
		salt, _ = hex.DecodeString(a.Salt)
	}
	h := hashPass(password, salt) // 用户不存在也算一次，减小时序差异
	if !ok || !hmac.Equal([]byte(h), []byte(a.Hash)) {
		return nil, ErrBadCred
	}
	return a, nil
}

func tokHash(t string) string { h := sha256.Sum256([]byte(t)); return hex.EncodeToString(h[:]) }

func (s *Store) NewSession(accountID string, ttl time.Duration) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	tok := base64.RawURLEncoding.EncodeToString(b)
	now := s.clock().Unix()
	for k, v := range s.sess { // 顺带清理过期会话
		if v.Exp <= now {
			delete(s.sess, k)
		}
	}
	s.sess[tokHash(tok)] = session{AccountID: accountID, Exp: s.clock().Add(ttl).Unix()}
	return tok, s.saveLocked()
}

func (s *Store) Auth(token string) (*Account, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ss, ok := s.sess[tokHash(token)]
	if !ok || ss.Exp <= s.clock().Unix() {
		return nil, false
	}
	a, ok := s.byID[ss.AccountID]
	return a, ok
}

func (s *Store) Logout(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sess, tokHash(token))
	_ = s.saveLocked()
}

// View 返回账号的只读快照（避免把内部指针交给 handler 并发读写）
func (s *Store) View(id string) (Account, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return Account{}, false
	}
	return clone(a), true
}

func clone(a *Account) Account {
	c := *a
	c.Salt, c.Hash = "", ""
	c.Chars = map[string]CharProgress{}
	for k, v := range a.Chars {
		c.Chars[k] = v
	}
	c.Items = map[string]int{}
	for k, v := range a.Items {
		c.Items[k] = v
	}
	return c
}

func (s *Store) Checkin(id string) (Account, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return Account{}, 0, ErrNotFound
	}
	day := s.clock().UTC().Format("2006-01-02")
	if a.LastCheck == day {
		return clone(a), 0, ErrAlready
	}
	const bonus = 50
	a.LastCheck = day
	a.Coins += bonus
	return clone(a), bonus, s.saveLocked()
}

// Buy 购买道具：扣金币、加库存。
func (s *Store) Buy(id, item string, qty int) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return Account{}, ErrNotFound
	}
	if qty < 1 || qty > 20 {
		return Account{}, ErrInvalid
	}
	price := -1
	for _, it := range ShopItems {
		if it.ID == item {
			price = it.Price
		}
	}
	if price < 0 {
		return Account{}, ErrInvalid
	}
	if a.Coins < price*qty {
		return Account{}, ErrNoCoins
	}
	a.Coins -= price * qty
	a.Items[item] += qty
	return clone(a), s.saveLocked()
}

// TrainCost 训练：每次花费 coins 金币，获得 exp 经验。
const (
	TrainCost = 50
	TrainExp  = 40
)

func (s *Store) Train(id, char string) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return Account{}, ErrNotFound
	}
	if _, ok := a.Chars[char]; !ok {
		return Account{}, ErrInvalid
	}
	if a.Coins < TrainCost {
		return Account{}, ErrNoCoins
	}
	a.Coins -= TrainCost
	return s.addExpLocked(a, char, TrainExp)
}

func (s *Store) addExpLocked(a *Account, char string, exp int) (Account, error) {
	c := a.Chars[char]
	c.Exp += exp
	c.Level = LevelOf(c.Exp)
	a.Chars[char] = c
	return clone(a), s.saveLocked()
}

// Grant 内部发放（对战服/运维用）：加金币与角色经验。
func (s *Store) Grant(id, char string, coins, exp int) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return Account{}, ErrNotFound
	}
	if coins < 0 || exp < 0 || coins > 100000 || exp > 100000 {
		return Account{}, ErrInvalid
	}
	a.Coins += coins
	if exp > 0 {
		if _, ok := a.Chars[char]; !ok {
			return Account{}, ErrInvalid
		}
		return s.addExpLocked(a, char, exp)
	}
	return clone(a), s.saveLocked()
}
