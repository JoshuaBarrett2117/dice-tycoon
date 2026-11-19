package main

import "testing"

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
	if n != 9 {
		t.Fatalf("want 9 items got %d", n)
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
