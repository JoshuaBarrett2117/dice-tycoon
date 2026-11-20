package main

import (
	"strings"
	"testing"
)

func TestCosmeticsShopBuyEquip(t *testing.T) {
	s, _ := newSrv(t)
	_, r := call(t, s, "POST", "/api/account/register", "", cred{"cora", "secret1"})
	tok := r["token"].(string)
	c, r := call(t, s, "GET", "/api/account/shop", "", nil)
	cats, _ := r["categories"].([]any)
	if c != 200 || len(cats) != 3 || len(r["items"].([]any)) != 0 {
		t.Fatalf("shop %d %v", c, r)
	}
	n := 0
	for _, x := range cats {
		n += len(x.(map[string]any)["items"].([]any))
	}
	if n != 10 {
		t.Fatalf("want 10 items got %d", n)
	}
	// 买骰子皮肤 120：200→80
	c, r = call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "dice_neon"})
	acc := r["account"].(map[string]any)
	if c != 200 || acc["coins"].(float64) != 80 {
		t.Fatalf("buy %d %v", c, r)
	}
	// 重复购买 400；金币不足 402（外观 jin 200 > 80）；对局道具卡 400
	if c, _ = call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "dice_neon"}); c != 400 {
		t.Fatalf("dup %d", c)
	}
	if c, _ = call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "skin_jin"}); c != 402 {
		t.Fatalf("poor %d", c)
	}
	if c, _ = call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "shield"}); c != 400 {
		t.Fatalf("card %d", c)
	}
	// 未拥有不能装备；装备后 me 返回；卸下后清除
	if c, _ = call(t, s, "POST", "/api/account/equip", tok, map[string]any{"item": "dice_gold"}); c != 400 {
		t.Fatalf("equip unowned %d", c)
	}
	c, r = call(t, s, "POST", "/api/account/equip", tok, map[string]any{"item": "dice_neon"})
	eq := r["account"].(map[string]any)["cosmetics"].(map[string]any)["equipped"].(map[string]any)
	if c != 200 || eq["dice"] != "dice_neon" {
		t.Fatalf("equip %d %v", c, r)
	}
	_, r = call(t, s, "GET", "/api/account/me", tok, nil)
	if r["account"].(map[string]any)["cosmetics"].(map[string]any)["equipped"].(map[string]any)["dice"] != "dice_neon" {
		t.Fatalf("me %v", r)
	}
	call(t, s, "POST", "/api/account/unequip", tok, map[string]any{"item": "dice_neon"})
	_, r = call(t, s, "GET", "/api/account/me", tok, nil)
	if _, ok := r["account"].(map[string]any)["cosmetics"].(map[string]any)["equipped"].(map[string]any)["dice"]; ok {
		t.Fatalf("not unequipped %v", r)
	}
	// assets 折算
	a, _ := s.st.View(r["account"].(map[string]any)["id"].(string))
	if got := assetsOf(&a); got != 80+120 {
		t.Fatalf("assets %d", got)
	}
}

func TestCosmeticsPersist(t *testing.T) {
	dir := t.TempDir() + "/a.json"
	st, _ := NewStore(dir)
	a, _ := st.Register("dora", "secret1")
	if _, err := st.BuyCosmetic(a.ID, "skin_li"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Equip(a.ID, "skin_li", true); err != nil {
		t.Fatal(err)
	}
	st.Close()
	st2, _ := NewStore(dir)
	v, _ := st2.View(a.ID)
	if v.Cosmetics.Equipped["skin:li"] != "skin_li" || !v.Cosmetics.has("skin_li") {
		t.Fatalf("%+v", v.Cosmetics)
	}
}

func TestPaidCharTang(t *testing.T) {
	s, _ := newSrv(t)
	_, r := call(t, s, "POST", "/api/account/register", "", cred{"tina", "secret1"})
	tok := r["token"].(string)
	id := r["account"].(map[string]any)["id"].(string)
	// 商城含 char_tang：角色分类、500 金币
	_, r = call(t, s, "GET", "/api/account/shop", "", nil)
	found := false
	for _, x := range r["categories"].([]any) {
		cat := x.(map[string]any)
		for _, it := range cat["items"].([]any) {
			m := it.(map[string]any)
			if m["id"] == "char_tang" {
				found = cat["id"] == "char" && m["price"].(float64) == 500 && m["kind"] == "char"
			}
			if m["id"] == "skin_tang" {
				t.Fatal("tang 暂无外观")
			}
		}
	}
	if !found {
		t.Fatalf("shop lacks char_tang %v", r)
	}
	owns := func() (int, bool) {
		c, r := call(t, s, "GET", "/internal/owns?account="+id+"&char=tang", "tok", nil)
		o, _ := r["owned"].(bool)
		return c, o
	}
	// 买前不可选；免费角色恒可选；无口令 404；未知角色 400
	if c, o := owns(); c != 200 || o {
		t.Fatalf("pre-buy owns %d %v", c, o)
	}
	if c, r := call(t, s, "GET", "/internal/owns?account="+id+"&char=jin", "tok", nil); c != 200 || r["owned"] != true {
		t.Fatalf("free char %d %v", c, r)
	}
	if c, _ := call(t, s, "GET", "/internal/owns?account="+id+"&char=tang", "bad", nil); c != 404 {
		t.Fatalf("no token %d", c)
	}
	if c, _ := call(t, s, "GET", "/internal/owns?account="+id+"&char=zzz", "tok", nil); c != 400 {
		t.Fatalf("unknown char %d", c)
	}
	// 金币不足 402（初始 200）
	if c, _ := call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "char_tang"}); c != 402 {
		t.Fatalf("poor %d", c)
	}
	call(t, s, "POST", "/internal/grant", "tok", map[string]any{"accountId": id, "coins": 400})
	c, r := call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "char_tang"})
	acc := r["account"].(map[string]any)
	if c != 200 || acc["coins"].(float64) != 100 {
		t.Fatalf("buy %d %v", c, r)
	}
	if c, o := owns(); c != 200 || !o {
		t.Fatalf("post-buy owns %d %v", c, o)
	}
	// 重复购买 400；训练 tang 正常（-50 金币 +40 经验）
	if c, _ := call(t, s, "POST", "/api/account/shop/buy", tok, map[string]any{"item": "char_tang"}); c != 400 {
		t.Fatalf("dup %d", c)
	}
	c, r = call(t, s, "POST", "/api/account/train", tok, map[string]any{"char": "tang"})
	tang := r["account"].(map[string]any)["chars"].(map[string]any)["tang"].(map[string]any)
	if c != 200 || tang["exp"].(float64) != 40 {
		t.Fatalf("train %d %v", c, r)
	}
	// 排行榜 assets：已购角色按购买价计入
	a, _ := s.st.View(id)
	if got := assetsOf(&a); got != 50+500 {
		t.Fatalf("assets %d", got)
	}
}

// 外观名与角色名一致（金多多 / 小狸 / 铁算盘老王 / 赛博阿星 / 熊猫工头 / 岩盾阿岩 + 「·幻彩外观」）
func TestCosmeticSkinNamesMatchChars(t *testing.T) {
	want := map[string]string{
		"skin_jin": "金多多·幻彩外观", "skin_li": "小狸·幻彩外观", "skin_wang": "铁算盘老王·幻彩外观",
		"skin_xing": "赛博阿星·幻彩外观", "skin_panda": "熊猫工头·幻彩外观", "skin_rock": "岩盾阿岩·幻彩外观",
	}
	for id, name := range want {
		c, ok := cosmeticByID(id)
		if !ok || c.Name != name {
			t.Fatalf("%s: want %q got %q (ok=%v)", id, name, c.Name, ok)
		}
	}
	for _, old := range []string{"金大宝", "李小橙", "王小萌", "星星", "熊猫·", "磐石"} {
		for _, c := range cosmeticCatalog {
			if strings.Contains(c.Name, old) {
				t.Fatalf("旧名残留 %q in %q", old, c.Name)
			}
		}
	}
}

