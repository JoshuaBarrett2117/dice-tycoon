package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// 票据格式：base64url(payload JSON) + "." + base64url(HMAC-SHA256(payload 段, 密钥))
// payload: {"a":accountId,"e":过期unix秒,"k":密钥ID}
// 密钥轮换：KeyRing 同时持有多把密钥，签发用 Current，校验按 kid 查找，旧密钥保留到所有旧票据过期即可下线。

type ticketPayload struct {
	A string `json:"a"`
	E int64  `json:"e"`
	K string `json:"k"`
}

var (
	ErrTicketMalformed  = errors.New("ticket malformed")
	ErrTicketSignature  = errors.New("ticket signature invalid")
	ErrTicketExpired    = errors.New("ticket expired")
	ErrTicketUnknownKey = errors.New("ticket key unknown")
)

type KeyRing struct {
	Current string
	Keys    map[string][]byte
}

// ParseKeyRing 解析 "kid1:secret1,kid2:secret2"，第一把为当前签发密钥。
func ParseKeyRing(s string) (*KeyRing, error) {
	kr := &KeyRing{Keys: map[string][]byte{}}
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		i := strings.Index(part, ":")
		if i <= 0 || i == len(part)-1 {
			return nil, errors.New("TICKET_KEYS 格式应为 kid:secret[,kid:secret]")
		}
		kid, sec := part[:i], part[i+1:]
		if kr.Current == "" {
			kr.Current = kid
		}
		kr.Keys[kid] = []byte(sec)
	}
	if kr.Current == "" {
		return nil, errors.New("TICKET_KEYS 为空")
	}
	return kr, nil
}

func sign(key []byte, msg string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(msg))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (kr *KeyRing) Issue(accountID string, now time.Time, ttl time.Duration) (string, time.Time) {
	exp := now.Add(ttl)
	b, _ := json.Marshal(ticketPayload{A: accountID, E: exp.Unix(), K: kr.Current})
	p := base64.RawURLEncoding.EncodeToString(b)
	return p + "." + sign(kr.Keys[kr.Current], p), exp
}

func (kr *KeyRing) Verify(ticket string, now time.Time) (string, error) {
	i := strings.IndexByte(ticket, '.')
	if i <= 0 || i == len(ticket)-1 || strings.Count(ticket, ".") != 1 {
		return "", ErrTicketMalformed
	}
	p, sig := ticket[:i], ticket[i+1:]
	raw, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil {
		return "", ErrTicketMalformed
	}
	var pl ticketPayload
	if json.Unmarshal(raw, &pl) != nil || pl.A == "" {
		return "", ErrTicketMalformed
	}
	key, ok := kr.Keys[pl.K]
	if !ok {
		return "", ErrTicketUnknownKey
	}
	if !hmac.Equal([]byte(sig), []byte(sign(key, p))) {
		return "", ErrTicketSignature
	}
	if now.Unix() >= pl.E {
		return "", ErrTicketExpired
	}
	return pl.A, nil
}
