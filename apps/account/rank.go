package main

import (
	"sort"
	"strings"
	"time"
)

// v1.3 段位 / 排行榜 / 赛季 / 对局结算。所有数值为提案值，集中在这里，便于调整。
// 段位分只存在业务服，不进引擎与回放；匿名玩家（无票据）不会被对战服上报，也就不参与。

const (
	SeasonDays     = 30
	LeaderboardTop = 50
	historyKeep    = 12   // 保留最近 N 个赛季历史
	settledKeep    = 2000 // 幂等：记住最近 N 个已结算对局
	SeasonKeepPct  = 50   // 新赛季段位分保留比例（%，向下取整）
)

// 名次 1..4 对应的奖励 / 段位分增减（名次按整桌座位，含机器人）
var (
	placeRating = [5]int{0, +25, +10, -10, -20}
	placeCoins  = [5]int{0, 60, 40, 25, 15}
	placeExp    = [5]int{0, 30, 20, 12, 8}
)

type tierDef struct {
	Min  int
	Name string
}

var tiers = []tierDef{{0, "青铜"}, {100, "白银"}, {300, "黄金"}, {600, "铂金"}, {1000, "钻石"}, {1500, "王者"}}

func TierOf(rating int) string {
	n := tiers[0].Name
	for _, t := range tiers {
		if rating >= t.Min {
			n = t.Name
		}
	}
	return n
}

type SeasonInfo struct {
	ID    int   `json:"id"`
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

type RankEntry struct {
	Rank     int    `json:"rank"`
	Username string `json:"username"`
	Rating   int    `json:"rating"`
	Tier     string `json:"tier"`
	Wins     int    `json:"wins"` // 本赛季胜场（历史记录里为该赛季终值）
	Games    int    `json:"games"`
	Assets   int    `json:"assets"`
}

type SeasonRecord struct {
	ID    int         `json:"id"`
	Start int64       `json:"start"`
	End   int64       `json:"end"`
	Top   []RankEntry `json:"top"`
}

type PlaceResult struct {
	AccountID string `json:"accountId"`
	Place     int    `json:"place"`
	Char      string `json:"char"`
}

type Settlement struct {
	AccountID string `json:"accountId"`
	Place     int    `json:"place"`
	Win       bool   `json:"win"`
	Rating    int    `json:"rating"`
	Delta     int    `json:"delta"`
	Coins     int    `json:"coins"`
	Exp       int    `json:"exp"`
}

func assetsOf(a *Account) int {
	n := a.Coins
	for _, it := range ItemValues {
		n += it.Price * a.Items[it.ID]
	}
	return n
}

// rollLocked 赛季滚动：到期则把榜单快照进历史，段位分按比例保留，赛季胜场清零；可能连滚多个赛季（服务停机很久）。
func (s *Store) rollLocked(now time.Time) {
	if s.season == nil {
		s.season = &SeasonInfo{ID: 1, Start: now.Unix(), End: now.Add(SeasonDays * 24 * time.Hour).Unix()}
		return
	}
	for now.Unix() >= s.season.End {
		s.history = append(s.history, SeasonRecord{ID: s.season.ID, Start: s.season.Start, End: s.season.End, Top: s.boardLocked("rating", LeaderboardTop)})
		if len(s.history) > historyKeep {
			s.history = s.history[len(s.history)-historyKeep:]
		}
		for _, a := range s.byID {
			a.Rating = a.Rating * SeasonKeepPct / 100
			a.SeasonWins = 0
		}
		next := &SeasonInfo{ID: s.season.ID + 1, Start: s.season.End}
		next.End = time.Unix(next.Start, 0).Add(SeasonDays * 24 * time.Hour).Unix()
		s.season = next
	}
}

// Settle 结算一局联机对局（幂等：同 matchID 只结算一次）。未知账号跳过。
func (s *Store) Settle(matchID string, rs []PlaceResult) ([]Settlement, error) {
	if matchID == "" || len(matchID) > 64 || len(rs) == 0 || len(rs) > 8 {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.setSet[matchID] {
		return []Settlement{}, nil
	}
	s.rollLocked(s.clock())
	seen := map[string]bool{}
	out := []Settlement{}
	for _, r := range rs {
		a, ok := s.byID[r.AccountID]
		if !ok || seen[r.AccountID] || r.Place < 1 || r.Place > 4 {
			continue
		}
		seen[r.AccountID] = true
		delta := placeRating[r.Place]
		if a.Rating+delta < 0 {
			delta = -a.Rating
		}
		a.Rating += delta
		a.Games++
		win := r.Place == 1
		if win {
			a.Wins++
			a.SeasonWins++
		}
		a.Coins += placeCoins[r.Place]
		exp := 0
		if _, ok := a.Chars[r.Char]; ok {
			exp = placeExp[r.Place]
			c := a.Chars[r.Char]
			c.Exp += exp
			c.Level = LevelOf(c.Exp)
			a.Chars[r.Char] = c
		}
		out = append(out, Settlement{AccountID: a.ID, Place: r.Place, Win: win, Rating: a.Rating, Delta: delta, Coins: placeCoins[r.Place], Exp: exp})
	}
	s.setSet[matchID] = true
	s.settled = append(s.settled, matchID)
	if len(s.settled) > settledKeep {
		delete(s.setSet, s.settled[0])
		s.settled = s.settled[1:]
	}
	return out, s.saveLocked()
}

// boardLocked by: rating（段位分）/ wins（本赛季胜场）/ assets（总资产=金币+持有道具按商城价折算）。只含公开数据。
func (s *Store) boardLocked(by string, n int) []RankEntry {
	list := make([]*Account, 0, len(s.byID))
	for _, a := range s.byID {
		list = append(list, a)
	}
	key := func(a *Account) int {
		switch by {
		case "wins":
			return a.SeasonWins
		case "assets":
			return assetsOf(a)
		}
		return a.Rating
	}
	sort.Slice(list, func(i, j int) bool {
		ki, kj := key(list[i]), key(list[j])
		if ki != kj {
			return ki > kj
		}
		if list[i].Created != list[j].Created {
			return list[i].Created < list[j].Created
		}
		return list[i].ID < list[j].ID
	})
	out := []RankEntry{}
	for _, a := range list {
		if len(out) >= n {
			break
		}
		if by != "assets" && a.Games == 0 && a.Rating == 0 { // 没打过联机的不上战绩榜
			continue
		}
		out = append(out, RankEntry{Rank: len(out) + 1, Username: a.Username, Rating: a.Rating, Tier: TierOf(a.Rating), Wins: a.SeasonWins, Games: a.Games, Assets: assetsOf(a)})
	}
	return out
}

func (s *Store) Leaderboard(by string, n int) ([]RankEntry, SeasonInfo, error) {
	by = strings.ToLower(by)
	if by == "" {
		by = "rating"
	}
	if by != "rating" && by != "wins" && by != "assets" {
		return nil, SeasonInfo{}, ErrInvalid
	}
	if n <= 0 || n > LeaderboardTop {
		n = LeaderboardTop
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	before := s.season
	s.rollLocked(s.clock())
	if before != s.season {
		_ = s.saveLocked()
	}
	return s.boardLocked(by, n), *s.season, nil
}

func (s *Store) SeasonView() (SeasonInfo, []SeasonRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	before := s.season
	s.rollLocked(s.clock())
	if before != s.season {
		_ = s.saveLocked()
	}
	h := append([]SeasonRecord(nil), s.history...)
	return *s.season, h
}
