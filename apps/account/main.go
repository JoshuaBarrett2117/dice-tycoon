// 《掷富天下》业务服：账号 / 角色养成 / 商城 / 对战服票据签发。
// 环境变量：PORT(8080) DATA_FILE(data/account.json；实际库为同名 .db，旧 JSON 启动时自动迁移并备份) TICKET_KEYS(必填 kid:secret[,kid2:secret2]) INTERNAL_TOKEN(可选)
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
	// 运维：account export <out.json>（导出 JSON）/ account backup <out.db>（一致性备份）
	if len(os.Args) >= 3 && (os.Args[1] == "export" || os.Args[1] == "backup") {
		st, err := NewStore(env("DATA_FILE", "data/account.json"))
		if err != nil {
			log.Fatalf("打开数据失败：%v", err)
		}
		if os.Args[1] == "export" {
			err = st.ExportJSON(os.Args[2])
		} else {
			err = st.BackupTo(os.Args[2])
		}
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("完成：%s", os.Args[2])
		return
	}
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
