# RoamEtch blind relay / 极简盲中继

A stateless Node.js WebSocket relay for RoamEtch live meetups, with optional
stateless safety-notification forwarding. It forwards opaque AES-256-GCM envelopes
between clients in the same room, keeps no history, and never sees the invite
secret, plaintext positions, chat text, or photos.

一个无状态的 Node.js WebSocket 中继，用于 RoamEtch 实时组队，并可选择启用无状态
安全通知转发。它只在同一房间内转发 AES-256-GCM 密文，不落盘、不记录消息内容，
也拿不到邀请密钥、明文位置、聊天文字或图片。

## Run locally / 本地运行

Requires Node.js 20 or newer (the Docker image uses Node.js 22).

需要 Node.js 20 或更新版本（Docker 镜像使用 Node.js 22）。

```bash
cd relay
npm install
npm start
# ws://localhost:8080/room/{room}
```

Docker:

```bash
docker build -t roametch-relay ./relay
docker run --rm -p 8080:8080 roametch-relay
```

Then open RoamEtch **Settings → Team relay → Custom WS relay**, choose WebSocket,
and set:

```text
wss://your-relay.example.com/room/{room}
```

The `{room}` placeholder is required; RoamEtch replaces it with the random 128-bit
public room id parsed from the invite, never with the invite secret. The relay must
keep the URL path exactly as `/room/<id>`.

在 RoamEtch「设置 → 组队中继」中选择自建 WS 中继，并填入包含 `{room}` 的地址。
`{room}` 会替换为邀请中随机生成的 128 位公共房间标识，不会包含邀请密钥。

## Production notes / 部署提示

- Put the relay behind TLS (Caddy, Nginx, Cloudflare Tunnel). Browsers require `wss://`
  when the app is served over HTTPS.
- `GET /healthz` returns `{ ok, rooms, clients }` for monitoring. No room ids or message
  content are exposed.
- Limits: 128 KB frames, 32 clients per room, 2,000 rooms, 10,000 total clients, and a
  30-second ping/pong heartbeat. Each socket gets a token bucket of 8 messages/second
  with a 40-message burst, plus a 512 KiB/second byte bucket with a 2 MiB burst;
  exceeding either closes the socket with `1008 rate limit`, including binary
  frames that are rejected rather than forwarded. A peer whose queued
  outbound bytes would exceed 512 KiB is closed with `1013 slow consumer`.
  Frames above the configured cap close with `1009 payload too large`.
  Rooms with no traffic for 12 hours are swept every 60 seconds and their sockets
  closed with `1001 room idle`. Adjust the constants at the top of `server.mjs` if needed.
- These caps are per relay process. For a public relay, also add per-IP connection and
  request limiting at the reverse proxy (Nginx `limit_conn`/`limit_req`, Caddy
  `rate_limit`, or a Cloudflare rule); the relay itself does not identify users and
  cannot distinguish clients behind the same NAT.
- The relay is intentionally stateless: no database, no message queue, no replay. Late
  joiners see no history, matching the app's ephemeral chat contract.
- Anyone who knows a room id can join that room and receive its ciphertext. The relay
  cannot decrypt it, but a malicious participant who obtains the full invite (room id
  and secret) can. Share invites only through trusted channels and use a private relay
  if you want to reduce metadata exposure.

## Safety notifications / 安全通知

Notification forwarding is **disabled by default**. To enable it, configure the
following environment variables and put the relay behind HTTPS:

安全通知转发默认关闭。启用时请配置以下环境变量，并通过 HTTPS 暴露服务：

```bash
SAFETY_NOTIFY_ENABLED=1
SAFETY_NOTIFY_TOKEN=replace-with-a-long-random-token
SAFETY_RELAY_ALLOWED_HOSTS=open.feishu.cn,qyapi.weixin.qq.com,oapi.dingtalk.com,ntfy.sh,api.day.app
SAFETY_TELEGRAM_ALLOWED_HOSTS=api.telegram.org
SAFETY_RELAY_ORIGINS=https://peteliao.github.io
SAFETY_SMTP_URL=smtps://user:password@smtp.example.com:465
SAFETY_SMTP_FROM=RoamEtch <alerts@example.com>
```

All relay-facing and upstream notification URLs must use HTTPS; plaintext HTTP
upstreams are rejected before any request is sent.

所有面向客户端的中继地址和上游通知地址都必须使用 HTTPS；纯文本 HTTP
上游会在发出请求前被拒绝。

- `SAFETY_NOTIFY_TOKEN` is required. Send it from the app as
  `Authorization: Bearer <token>`; do not put it in a webhook URL.
- `SAFETY_RELAY_ALLOWED_HOSTS` is an exact-host/subdomain allowlist. Private,
  loopback, link-local and other non-public addresses are rejected. The Node
  transport pins validated DNS answers and rejects redirects.
- `SAFETY_TELEGRAM_ALLOWED_HOSTS` is a separate allowlist for TG Bot API origins.
  It defaults to `api.telegram.org`; add a trusted reverse-proxy hostname here if
  using a custom TG API base. The Node transport applies the same public-address,
  DNS-pinning and redirect protections to TG delivery.
- `POST /api/notify/telegram` accepts `{ apiBaseUrl?, botToken, messages }` and
  validates the bot token, chat/topic ids, coordinates and navigation buttons. It
  sends a native `sendLocation` first, then a telemetry `sendMessage` replying to
  the returned message id. It returns only fixed status codes, never provider
  details, bot tokens or coordinates.
- TG users must send `/start` to the bot before receiving a private message. Group
  bots must be added and permitted to speak. Regional network restrictions,
  browser CORS/User-Agent policy, API rate limits, inactive bots, network failures
  or expired/revoked tokens can still prevent delivery.
- `SAFETY_RELAY_ORIGINS` limits browser CORS access. Add your own deployment
  origin when self-hosting the frontend.
- Instead of `SAFETY_SMTP_URL`, you may set `SAFETY_SMTP_HOST`,
  `SAFETY_SMTP_PORT`, `SAFETY_SMTP_SECURE=1`, `SAFETY_SMTP_USER`,
  `SAFETY_SMTP_PASS` and `SAFETY_SMTP_FROM`.
- In RoamEtch **Settings → Safety & Check-in**, set the relay base URL and token,
  then choose relay email or an enterprise webhook. `mailto:` and `sms:` remain
  device-side drafts and never pass through the relay.
- The relay does not persist coordinates or message bodies and does not log
  notification URLs, recipients, tokens, request bodies or provider errors.

`SAFETY_NOTIFY_TOKEN` 为必填项，应用通过 `Authorization: Bearer <token>` 发送；
不要把令牌放进 Webhook URL。`SAFETY_RELAY_ALLOWED_HOSTS` 是精确域名/子域名白名单，
Node 转发会拒绝私网地址并固定已校验的 DNS 结果。自建前端时需把实际来源加入
`SAFETY_RELAY_ORIGINS`。邮件也可使用分立的 `SAFETY_SMTP_*` 变量配置。

### Cloudflare Worker / Cloudflare Worker 模板

`worker.mjs` is a single-file alternative using MailChannels for email. Set
`SAFETY_NOTIFY_ENABLED`, `SAFETY_NOTIFY_TOKEN`, `SAFETY_RELAY_ALLOWED_HOSTS`,
`SAFETY_TELEGRAM_ALLOWED_HOSTS`, `SAFETY_RELAY_ORIGINS`, `SAFETY_SMTP_FROM` and
optionally `SAFETY_MAILCHANNELS_API_KEY` as Worker secrets/variables.

`worker.mjs` 是使用 MailChannels 发信的单文件模板。Worker 无法实现 Node 版本的
DNS 固定与连接地址复核，因此必须显式配置公共平台域名白名单；其限流按 isolate
尽力执行，不构成完整抗滥用保证。两种实现都不保存坐标或消息正文。

## Test / 测试

```bash
cd relay
npm test
```

The test starts two rooms on an ephemeral port, checks same-room forwarding,
cross-room isolation, binary-frame rejection, the health endpoint, abusive socket
limits, idle cleanup, byte-rate enforcement, slow-consumer isolation, the 128 KB
image-frame boundary, and the safety notification API's authentication, CORS,
SSRF protections, TG validation and sequential delivery, provider error handling,
email validation, rate limits and timeouts.
