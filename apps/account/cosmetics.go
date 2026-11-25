package main

import "sort"

// v1.6 装饰商品：角色 / 角色外观 / 骰子皮肤。与对局道具卡（ItemValues，已下架）彻底分开。
// 新角色上架：往 PaidChars 加入角色并往 buildCatalog 追加 Kind=KindChar 的条目（id 为 char_<角色>）。

const (
	KindChar = "char" // 角色（付费角色，商品 id 为 char_<角色>）
	KindSkin = "skin" // 角色外观（Char 指向所属角色）
	KindDice = "dice" // 骰子皮肤
)

const DiceDefault = "dice_classic" // 免费默认，永远可装备

type Cosmetic struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	Price int    `json:"price"`
	Char  string `json:"char,omitempty"`
}

// 与客户端 / 引擎 characters.ts 的角色名保持一致（外观名 = 角色名 + 「·幻彩外观」）
var charNames = map[string]string{"jin": "金多多", "li": "小狸", "wang": "铁算盘老王", "xing": "赛博阿星", "panda": "熊猫工头", "rock": "岩盾阿岩", "tang": "锦鲤阿棠"}

var cosmeticCatalog = buildCatalog()

func buildCatalog() []Cosmetic {
	prices := map[string]int{"jin": 200, "li": 150, "wang": 180, "xing": 250, "panda": 220, "rock": 300}
	var c []Cosmetic
	// v1.7 付费角色（提案值 500 金币 ≈ 8–10 场联机第一名奖励）
	c = append(c, Cosmetic{ID: "char_tang", Kind: KindChar, Name: "锦鲤阿棠", Price: 500, Char: "tang"})
	for _, ch := range CharIDs {
		if PaidChars[ch] {
			continue // 付费角色暂无外观
		}
		c = append(c, Cosmetic{ID: "skin_" + ch, Kind: KindSkin, Name: charNames[ch] + "·幻彩外观", Price: prices[ch], Char: ch})
	}
	c = append(c,
		Cosmetic{ID: "dice_neon", Kind: KindDice, Name: "幻彩水晶骰子", Price: 120},
		Cosmetic{ID: "dice_island", Kind: KindDice, Name: "海蓝糖果骰子", Price: 150},
		Cosmetic{ID: "dice_gold", Kind: KindDice, Name: "宝石金骰子", Price: 200},
	)
	return c
}

func cosmeticByID(id string) (Cosmetic, bool) {
	for _, c := range cosmeticCatalog {
		if c.ID == id {
			return c, true
		}
	}
	return Cosmetic{}, false
}

// Cosmetics 账号的装饰库存与当前装备。Equipped 的键：dice / skin:<charId> / char（预留）。
type Cosmetics struct {
	Owned    []string          `json:"owned"`
	Equipped map[string]string `json:"equipped"`
}

func slotOf(c Cosmetic) string {
	switch c.Kind {
	case KindSkin:
		return "skin:" + c.Char
	case KindDice:
		return "dice"
	}
	return "char"
}

func (c *Cosmetics) has(id string) bool {
	for _, o := range c.Owned {
		if o == id {
			return true
		}
	}
	return false
}

// cosmeticAssets 已购装饰按购买价计入排行榜 assets（沿用 #21 的内部价目口径）。
func cosmeticAssets(a *Account) int {
	n := 0
	for _, id := range a.Cosmetics.Owned {
		if c, ok := cosmeticByID(id); ok {
			n += c.Price
		}
	}
	return n
}

type ShopCategory struct {
	ID    string     `json:"id"`
	Name  string     `json:"name"`
	Items []Cosmetic `json:"items"`
}

func shopCategories() []ShopCategory {
	cats := []ShopCategory{{ID: KindChar, Name: "角色", Items: []Cosmetic{}}, {ID: KindSkin, Name: "角色外观", Items: []Cosmetic{}}, {ID: KindDice, Name: "骰子皮肤", Items: []Cosmetic{}}}
	for _, c := range cosmeticCatalog {
		for i := range cats {
			if cats[i].ID == c.Kind {
				cats[i].Items = append(cats[i].Items, c)
			}
		}
	}
	return cats
}

// BuyCosmetic 金币购买装饰；对局道具卡与未知商品一律 ErrShopClosed/ErrInvalid（400）。
func (s *Store) BuyCosmetic(id, item string) (Account, error) {
	c, ok := cosmeticByID(item)
	if !ok {
		return Account{}, ErrShopClosed
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return Account{}, ErrNotFound
	}
	if a.Cosmetics.has(c.ID) {
		return Account{}, ErrInvalid
	}
	if a.Coins < c.Price {
		return Account{}, ErrNoCoins
	}
	a.Coins -= c.Price
	a.Cosmetics.Owned = append(a.Cosmetics.Owned, c.ID)
	sort.Strings(a.Cosmetics.Owned)
	return clone(a), s.saveLocked()
}

// Equip 装备（on=true）或卸下（on=false）。dice_classic 视为默认：装备即卸下骰子皮肤。
func (s *Store) Equip(id, item string, on bool) (Account, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return Account{}, ErrNotFound
	}
	if item == DiceDefault {
		delete(a.Cosmetics.Equipped, "dice")
		return clone(a), s.saveLocked()
	}
	c, ok := cosmeticByID(item)
	if !ok || !a.Cosmetics.has(c.ID) {
		return Account{}, ErrInvalid
	}
	if a.Cosmetics.Equipped == nil {
		a.Cosmetics.Equipped = map[string]string{}
	}
	if on {
		a.Cosmetics.Equipped[slotOf(c)] = c.ID
	} else if a.Cosmetics.Equipped[slotOf(c)] == c.ID {
		delete(a.Cosmetics.Equipped, slotOf(c))
	}
	return clone(a), s.saveLocked()
}

// OwnsChar 免费角色人人可用；付费角色需已购 char_<角色>。
func (c *Cosmetics) OwnsChar(char string) bool {
	return !PaidChars[char] || c.has("char_"+char)
}

// OwnsChar 供对战服入座校验：账号不存在返回 ErrNotFound，未知角色 ErrInvalid。
func (s *Store) OwnsChar(id, char string) (bool, error) {
	known := false
	for _, c := range CharIDs {
		known = known || c == char
	}
	if !known {
		return false, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.byID[id]
	if !ok {
		return false, ErrNotFound
	}
	return a.Cosmetics.OwnsChar(char), nil
}
