package main

import "sort"

// v1.6 装饰商品：角色 / 角色外观 / 骰子皮肤。与对局道具卡（ItemValues，已下架）彻底分开。
// 新角色上架：往 cosmeticCatalog 追加 Kind=KindChar 的条目即可（本期不含新角色）。

const (
	KindChar = "char" // 角色（预留，本期无在售）
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

var charNames = map[string]string{"jin": "金大宝", "li": "李小橙", "wang": "王小萌", "xing": "星星", "panda": "熊猫", "rock": "磐石"}

var cosmeticCatalog = buildCatalog()

func buildCatalog() []Cosmetic {
	prices := map[string]int{"jin": 200, "li": 150, "wang": 180, "xing": 250, "panda": 220, "rock": 300}
	var c []Cosmetic
	for _, ch := range CharIDs {
		c = append(c, Cosmetic{ID: "skin_" + ch, Kind: KindSkin, Name: charNames[ch] + "·幻彩外观", Price: prices[ch], Char: ch})
	}
	c = append(c,
		Cosmetic{ID: "dice_neon", Kind: KindDice, Name: "霓虹骰子", Price: 120},
		Cosmetic{ID: "dice_island", Kind: KindDice, Name: "海岛骰子", Price: 150},
		Cosmetic{ID: "dice_gold", Kind: KindDice, Name: "鎏金骰子", Price: 200},
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
