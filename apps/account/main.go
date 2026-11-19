// 《掷富天下》业务服：账号 / 角色养成 / 商城 / 对战服票据签发。
// 环境变量：PORT(8080) DATA_FILE(data/account.json) TICKET_KEYS(必填 kid:secret[,kid2:secret2]) INTERNAL_TOKEN(可选)
package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func main() {
	keys, err := ParseKeyRing(os.Getenv("TICKET_KEYS"))
	if err != nil {
		log.Fatalf("票据密钥未配置：%v（密钥只通过环境变量注入）", err)
	}
	st, err := NewStore(env("DATA_FILE", "data/account.json"))
	if err != nil {
		log.Fatalf("打开数据文件失败：%v", err)
	}
	srv := &Server{st: st, keys: keys, internalToken: os.Getenv("INTERNAL_TOKEN"), now: time.Now}
	addr := ":" + env("PORT", "8080")
	log.Printf("[掷富天下·业务服] 监听 %s", addr)
	hs := &http.Server{Addr: addr, Handler: srv.Handler(), ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(hs.ListenAndServe())
}
