# SmoothBili · 哔哩滑滑 Biliboli

> **无广告 · 不追踪 · 非盈利** 的第三方哔哩哔哩 Web 客户端
>
> 数据全部直连 B 站官方公开接口，接口策略参考社区开源项目（piliplus / pilipala / bilibili-API-collect）。

---

## 目录

- [它是什么](#它是什么)
- [功能一览](#功能一览)
- [技术栈](#技术栈)
- [本地运行](#本地运行)
- [部署到 Vercel（连接 GitHub）](#部署到-vercel连接-github)
- [视频流代理：为什么建议再加一个 Cloudflare Worker](#视频流代理为什么建议再加一个-cloudflare-worker)
- [其他部署方式](#其他部署方式)
- [环境变量](#环境变量)
- [项目结构](#项目结构)
- [接口一览](#接口一览)
- [常见问题 FAQ](#常见问题-faq)
- [隐私与安全](#隐私与安全)
- [赞助](#赞助)
- [许可与免责声明](#许可与免责声明)

---

## 它是什么

SmoothBili 是一个**在浏览器里用的第三方 B 站客户端**。它不是浏览器插件，也不是套壳 iframe，而是：

- 用 B 站官方公开 HTTP 接口自己拉数据（推荐、搜索、排行榜、评论、弹幕、播放地址）
- 自己渲染界面、自己做播放器、自己画弹幕
- **没有广告位，没有推荐位招商，没有数据统计，没有用户画像**

因为 B 站的接口有跨域（CORS）和 Referer 双重限制，浏览器无法直接请求，所以项目里内置了一层**服务端代理**（Next.js 的 Route Handlers）。你的浏览器只跟自己的服务器说话，服务器再去找 B 站。

---

## 功能一览

### 浏览
| 功能 | 说明 |
|---|---|
| 首页推荐 | 登录后为个性化推荐，未登录为通用推荐流 |
| 热门视频 | `/x/web-interface/popular`，带分页 |
| 热搜榜 | 首页顶部展示实时热搜词，点击直达搜索 |
| 搜索 | 视频 / UP 主 / 番剧 / 影视四类，支持综合·播放量·最新发布·弹幕数·收藏数排序，按时长筛选 |
| 搜索建议 | 输入时实时下拉提示 |
| 排行榜 | 全站 + 13 个分区，展示综合得分 |

### 播放
| 功能 | 说明 |
|---|---|
| DASH 播放 | dash.js 播放，音视频分离流，支持多清晰度切换 |
| 画质档位 | 360P → 4K，取决于你的账号权限（大会员可解锁 1080P+/4K/杜比） |
| 降级方案 | dash.js 加载失败时自动回退到 MP4 直链，用原生 `<video>` 播放 |
| 弹幕 | Canvas 自绘，支持滚动 / 顶部 / 底部，可调不透明度、字号、显示区域 |
| 分 P | 侧栏分 P 列表，点击即切，无需刷新页面 |
| 进度条 | 缓冲进度 + 播放进度双层显示，支持拖动跳转 |
| 全屏 / 音量 / 倍速预留 | 常规控制齐全 |

### 互动
| 功能 | 说明 |
|---|---|
| 点赞 / 投币 / 收藏 / 三连 | 需登录，走 B 站官方接口 |
| 评论 | 主评论 + 楼中楼（子回复） |
| 播放进度上报 | 登录后每 15 秒上报一次，同步 B 站观看历史 |
| UP 主主页 | 头像、签名、粉丝数、投稿列表（按最新 / 最多播放排序） |

### 基础
- 深色模式（跟随系统）
- 响应式布局（手机 / 平板 / 桌面）
- 图片懒加载
- 服务端内存缓存（热门、排行、评论等，避免频繁打 B 站接口）

---

## 技术栈

### 风控对抗：三层设备身份机制

只做 WBI 签名是不够的。B 站 web 端实际有**四道**风控，缺任何一道都可能触发
`-352 风控校验失败` / `412` / `request was banned`。本项目四道全实现：

| 机制 | 作用 | 缺失后果 | 实现位置 |
|---|---|---|---|
| **WBI 签名** | 请求参数完整性校验 | `-352` | `src/lib/wbi.ts` |
| **buvid 激活** | 设备指纹有效化 | 风控拦截（官方明确：web 端互动操作要求已激活的 buvid3） | `bilibase.ts` → `activateBuvid()` |
| **bili_ticket** | JWT 设备票据，3 天有效 | 官方原话「非必需，但存在可降低风控概率」 | `bilibase.ts` → `getBiliTicket()` |
| **dm_img 参数** | 浏览器渲染环境指纹 | `wbi/playurl` 直接返回 **412** | `bilibase.ts` → `withDmImg()` |

细节：

- **buvid 激活**：拿到 `buvid3` 后必须 POST 一次
  `/x/internal/gaia-gateway/ExClimbWuzhi` 才算"激活"，否则 B 站视其为无效指纹。
  每设备只做一次，失败不阻塞主流程。
- **bili_ticket**：`HMAC-SHA256(key = "XgwSnGZ1p", msg = "ts" + 时间戳)` 得到 `hexsign`，
  再 POST 到 `bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket` 换取 JWT。
  带内存缓存 + 并发去重，不会重复请求。
- **dm_img**：`dm_img_list` / `dm_img_str` / `dm_cover_img_str` / `dm_img_inter`
  描述的是浏览器 WebGL 渲染环境，服务端只校验存在性不验真，用公开常量即可
  （与 yt-dlp 等开源实现一致）。**登录状态改用 `dm_img_switch=0`**，不注入这些参数。

> 签名算法本身与 PiliPlus `lib/utils/wbi_sign.dart` 逐字符一致：
> 同一张 64 位 `mixinKeyEncTab`、同样的 `[!'()*]` 过滤、
> 同样的 `md5(queryStr + mixinKey)`。已用官方示例密钥验证通过。

### 技术栈明细

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | **Next.js 15（App Router）** | 服务端渲染 + Route Handlers 天然当代理层，一份代码搞定前后端 |
| 语言 | TypeScript | 接口字段多，类型能省掉大量调试 |
| 样式 | Tailwind CSS v4 + CSS 变量 | 主题色、深色模式都靠变量切换，改一处全站生效 |
| 播放器 | dash.js（CDN 动态加载） | B 站是 DASH 流，原生 `<video>` 放不了 |
| 弹幕 | Canvas 手写 | 不引第三方弹幕库，性能可控 |
| 签名 | 自实现 WBI（含纯 TS 的 MD5） | 零依赖，Edge / Node 都能跑 |

**为什么必须有服务端？** B 站接口对请求来源有两道限制：

1. **CORS**：`api.bilibili.com` 不允许跨域，浏览器直接 fetch 会被拦
2. **Referer**：视频 CDN 校验 Referer，不是 `bilibili.com` 就返回 403，而浏览器不允许 JS 修改 Referer

所以代理层不是"加分项"，是"能不能跑起来"的前提。

---

## 本地运行

```bash
# 1. 克隆
git clone https://github.com/wcvjk8tnz8-create/smoothbili.git
cd smoothbili

# 2. 安装依赖
npm install

# 3.（可选但推荐）配置登录态加密密钥
cp .env.example .env.local
# 然后编辑 .env.local，把 SESSION_SECRET 换成随机值

# 4. 启动
npm run dev
```

打开 http://localhost:3000

生成随机密钥：

```bash
openssl rand -hex 32
# 或
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> 不配 `SESSION_SECRET` 也能跑，会退回到内置的默认值——但**生产环境一定要改**，否则别人用默认值就能解出所有人的登录 Cookie。

---

## 部署到 Vercel（连接 GitHub）

**是的，Vercel 就是连 GitHub 部署的。** 连上之后你每次 `git push`，Vercel 会自动拉代码、构建、上线，不需要手动操作。

### 第一步：登录并授权

1. 打开 [vercel.com](https://vercel.com)，点 **Continue with GitHub**
2. GitHub 会问你要不要授权 Vercel，点 **Authorize Vercel**

> **如果之后在导入列表里看不到仓库**：GitHub 授权时默认是"所有仓库"，但如果你之前选过"Only select repositories"，需要手动加。
> 解决方法：GitHub → 右上角头像 → **Settings** → **Applications** → **Vercel** → **Configure** → 在 Repository access 里勾选 `smoothbili` → Save。

### 第二步：导入项目

1. Vercel 控制台 → **Add New...** → **Project**
2. 在列表里找到 `wcvjk8tnz8-create/smoothbili`，点 **Import**

### 第三步：配置构建参数

大部分会自动识别，确认以下几项：

| 配置项 | 值 |
|---|---|
| Framework Preset | `Next.js` （一般自动识别） |
| Root Directory | `./` （**不要改**，代码就在根目录） |
| Build Command | `npm run build`（默认） |
| Output Directory | `.next`（默认） |
| Install Command | `npm install`（默认） |

### 第四步：配置环境变量（重要）

展开 **Environment Variables**，添加：

| Name | Value | 说明 |
|---|---|---|
| `SESSION_SECRET` | 你的 32 字节随机 hex | **必填**。用于加密登录态，不配会用不安全的默认值 |

建议把 `production` / `preview` / `development` 三个环境都勾上，值可以相同。

### 第五步：部署

点 **Deploy**，等 1-3 分钟。看到 🎉 就成功了，Vercel 会给一个 `xxx.vercel.app` 的域名。

之后**每次 `git push` 到 main 分支都会自动重新部署**。

### ⚠️ Vercel 上的三个现实问题

这套代码在 Vercel 上能跑，但有三个坑你必须知道：

#### 1. 出口 IP 在境外，容易撞 B 站风控

Vercel 的服务器在美国（免费版默认华盛顿），B 站对境外 IP 有风控，可能出现：

```
无法获取 WBI 密钥
加载失败：-352 请求过于频繁
```

**表现**：首页空白、排行榜打不开、视频加载不出地址。

**缓解办法**：
- 让用户登录（登录态能显著降低风控概率，这是最有效的）
- 换到香港 / 大陆的服务器（见[其他部署方式](#其他部署方式)）
- 如果只是自己用，本地跑或挂在家里的机器上最稳

#### 2. 免费版带宽只有 100GB / 月，视频流会瞬间烧光

这是**最容易被忽略也最致命**的一点。视频流走的是你的 Vercel 代理，意味着：

```
一个 1080P 视频 ≈ 200MB ~ 1GB
看 100 个视频 ≈ 20GB ~ 100GB
```

Hobby 计划每月 100GB 带宽，几个人用几天就没了。超了之后视频会全部加载失败。

**解决办法**：把视频流代理挪到 Cloudflare Workers（带宽免费无限），见下一节。**强烈建议这么做。**

#### 3. 函数执行时长限制

Vercel 免费版函数最长执行 **60 秒**，付费版 300 秒。视频流是长连接，一旦单个请求超过时长就会被强行切断，表现为**看到一半突然卡住**。

同样通过把视频流挪到 Workers 解决。

---

## 视频流代理：为什么建议再加一个 Cloudflare Worker

**一句话**：Vercel 适合跑页面和轻量接口，不适合转发视频。Cloudflare Workers 带宽免费、不限量，流式转发几乎不消耗 CPU 时间，是转发视频流的最佳选择。

### 架构对比

```
❌ 纯 Vercel：
浏览器 → Vercel(页面) ─┬→ B站接口(轻量)
                      └→ Vercel(视频代理) → B站CDN   ← 吃带宽 + 可能超时

✅ Vercel + Workers：
浏览器 → Vercel(页面) ──→ B站接口(轻量)
       └→ Cloudflare Worker(视频代理) → B站CDN        ← 免费带宽，无超时
```

### 部署步骤

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com) → **Workers 和 Pages** → **创建** → **创建 Worker**
2. 随便起个名字（如 `smoothbili-proxy`），点**部署**
3. 点**编辑代码**，把 [`docs/cloudflare-worker.js`](./docs/cloudflare-worker.js) 的全部内容粘贴进去
4. 点**部署**，复制得到的地址，形如 `https://smoothbili-proxy.你的名字.workers.dev`
5. 回到 Vercel → 你的项目 → **Settings** → **Environment Variables**，新增：

   | Name | Value |
   |---|---|
   | `PLAYBACK_PROXY_BASE` | `https://smoothbili-proxy.你的名字.workers.dev` |

6. **Deployments** → 最新一条右侧三个点 → **Redeploy**

搞定。之后视频流全部走 Cloudflare，Vercel 只负责页面和接口。

> **安全提示**：Worker 代码里的域名白名单（`ALLOWED_HOSTS`）**不要删**。删掉之后你的 Worker 会变成公开的免费代理，会被扫到并用来刷流量，轻则限流，重则封号。

---

## 其他部署方式

### Docker（推荐部署在香港 / 大陆 VPS）

项目已带 `Dockerfile`：

```bash
docker build -t smoothbili .
docker run -d -p 3000:3000 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  --name smoothbili smoothbili
```

用 docker-compose：

```yaml
services:
  smoothbili:
    build: .
    ports:
      - "3000:3000"
    environment:
      - SESSION_SECRET=你的随机密钥
    restart: unless-stopped
```

### 裸机 / 任意 Node 平台

```bash
npm install
npm run build
npm start          # 默认 3000 端口
```

配合 Nginx 反代 + HTTPS：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # 视频流需要长连接，关掉缓冲
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

### Cloudflare Pages

需要 OpenNext 做适配（`npm i -D @opennextjs/cloudflare`），改动较多，**新手不推荐**。思路见 [OpenNext 文档](https://opennext.js.org/cloudflare)。

---

## 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `SESSION_SECRET` | 生产必填 | 内置不安全默认值 | 登录态 AES-GCM 加密密钥。用 `openssl rand -hex 32` 生成 |
| `PLAYBACK_PROXY_BASE` | 否 | 空（走本站 `/api/playback`） | 外部视频流代理地址，填 Cloudflare Worker 的域名 |
| `BILI_API_PROXY_BASE` | 否 | 空（直连 B 站） | **B 站接口中转地址**。被 B 站封 IP 时必填，见下方说明 |
| `BILI_API_PROXY_TOKEN` | 否 | 空 | 配合上面中转服务的鉴权 token |

把 `SESSION_SECRET` 写在 `.env.local`（本地）或 Vercel 的 Environment Variables（线上）。**不要提交到 Git。**

---

## 项目结构

```
smoothbili/
├── src/
│   ├── app/
│   │   ├── page.tsx                     首页（推荐 / 热门 / 热搜）
│   │   ├── search/page.tsx              搜索（视频/UP主/番剧/影视）
│   │   ├── ranking/page.tsx             排行榜（14 个分区）
│   │   ├── video/[bvid]/page.tsx        视频详情
│   │   ├── space/[mid]/page.tsx         UP 主主页
│   │   ├── sponsor/page.tsx             赞助页（AlipayHK 收款码）
│   │   ├── layout.tsx                   全局布局 + SEO meta
│   │   ├── globals.css                  主题变量与全部样式
│   │   └── api/
│   │       ├── img/route.ts             封面/头像代理（B站图床校验 Referer）
│   │       ├── playback/route.ts        视频流代理（透传 Range，可拖动进度条）
│   │       ├── playurl/route.ts         播放地址，URL 改写为代理地址
│   │       ├── danmaku/route.ts         弹幕（XML → JSON）
│   │       ├── interact/route.ts        点赞/投币/收藏/三连/心跳
│   │       ├── search/suggest/route.ts  搜索建议
│   │       ├── user/me/route.ts         当前登录态
│   │       ├── login/
│   │       │   ├── qrcode/route.ts      生成登录二维码
│   │       │   ├── poll/route.ts        轮询扫码结果
│   │       │   ├── cookie/route.ts      手动导入 Cookie
│   │       │   └── logout/route.ts      退出登录
│   │       └── bili/comment/            评论翻页 / 楼中楼
│   ├── components/
│   │   ├── Nav.tsx                      顶部导航 + 用户菜单
│   │   ├── SearchBox.tsx                搜索框 + 实时下拉建议
│   │   ├── Player.tsx                   播放器（DASH + 降级 + 控制条）
│   │   ├── DanmakuLayer.tsx             Canvas 弹幕引擎
│   │   ├── VideoWatch.tsx               视频页交互（分P/三连/评论）
│   │   ├── VideoCard.tsx / VideoGrid.tsx
│   │   ├── LoginModal.tsx               扫码登录 / Cookie 导入
│   │   └── Footer.tsx                   页脚（含赞助入口）
│   └── lib/
│       ├── md5.ts                       纯 TS MD5（WebCrypto 没有 MD5）
│       ├── wbi.ts                       WBI 签名
│       ├── bilibase.ts                  请求底层：设备指纹/密钥/风控重试/缓存
│       ├── bili.ts                      业务接口封装
│       ├── session.ts                   凭据 AES-GCM 加解密
│       ├── server.ts                    服务端读取登录态
│       ├── format.ts                    播放量/时长/相对时间格式化
│       ├── sponsor.ts                   赞助信息（改这里换收款码）
│       └── types.ts                     类型定义
├── docs/
│   └── cloudflare-worker.js             视频流代理 Worker（可选部署）
├── public/sponsor/alipayhk.jpg          AlipayHK 收款码
├── Dockerfile
├── LICENSE                              AGPL-3.0
└── README.md
```

---

## 接口一览

### 对外接口（前端调用）

| 路径 | 方法 | 说明 |
|---|---|---|
| `/api/playurl` | GET | 播放地址。`?bvid=&cid=&qn=`，`&mp4=1` 取 MP4 直链 |
| `/api/playback` | GET | 视频流代理。`?u=<base64 的 CDN 地址>`，透传 Range |
| `/api/danmaku` | GET | 弹幕。`?cid=` |
| `/api/img` | GET | 图片代理。`?u=<图片地址>` |
| `/api/search/suggest` | GET | 搜索建议。`?term=` |
| `/api/bili/comment` | GET | 评论翻页。`?oid=&pn=` |
| `/api/bili/comment/reply` | GET | 楼中楼。`?oid=&root=` |
| `/api/interact` | POST | 点赞/投币/收藏/三连/心跳 |
| `/api/user/me` | GET | 当前登录态 |
| `/api/login/qrcode` | GET | 生成登录二维码 |
| `/api/login/poll` | GET | 轮询扫码结果 |
| `/api/login/cookie` | POST | 手动导入 Cookie |
| `/api/login/logout` | POST | 退出登录 |

### 用到的 B 站接口

| 用途 | 接口 | 是否需 WBI |
|---|---|---|
| 设备指纹 | `/x/frontend/finger/spi` | 否 |
| WBI 密钥 | `/x/web-interface/nav` | 否 |
| 首页推荐 | `/x/web-interface/wbi/index/top/feed/rcmd` | ✅ |
| 热门 | `/x/web-interface/popular` | 否 |
| 排行榜 | `/x/web-interface/ranking/v2` | 否 |
| 搜索 | `/x/web-interface/wbi/search/type` | ✅ |
| 视频详情 | `/x/web-interface/view` | 否 |
| 播放地址 | `/x/player/wbi/playurl` | ✅ |
| 弹幕 | `/x/v1/dm/list.so` | 否 |
| 评论 | `/x/v2/reply/wbi/main` | ✅ |
| UP 主投稿 | `/x/space/wbi/arc/search` | ✅ |
| 用户信息 | `/x/web-interface/card` | 否 |
| 登录二维码 | `/x/passport-login/web/qrcode/generate` | 否 |
| 扫码轮询 | `/x/passport-login/web/qrcode/poll` | 否 |

---

## 常见问题 FAQ

### Q：部署在 Cloudflare Workers 上，报 `request was banned` 或 `Unexpected token '<'`

**这是 B 站把 Cloudflare 的出口 IP 封了**，不是代码问题。

判断依据：这两个报错分别对应 B 站 WAF 的两种回包 —— HTML 拦截页（导致 JSON 解析失败）和 JSON `{"message":"request was banned"}`。Cloudflare 的 IP 段被爬虫滥用严重，B 站（阿里云 WAF）对其整段拉黑，这种封禁是 IP 层级的，**改 UA、改 Referer、重算签名都无效**。

三种解法，按推荐度排序：

1. **整个应用搬到香港 VPS**（最简单，Dockerfile 已备好）
2. **保留 Cloudflare 渲染，B 站请求走 VPS 中转**（见下方 [API 中转](#api-中转方案)）
3. 换 Vercel 试试 —— 但同样是海外 IP，也可能被封，只能赌

### Q：API 中转方案怎么用

适用于"想保留 Cloudflare 全球加速，但 B 站请求需要干净 IP"的场景：

```
浏览器 → Cloudflare Workers（渲染页面，快）
            ↓ BILI_API_PROXY_BASE
       你的香港 VPS（中转，IP 干净）
            ↓
         B 站接口 / CDN
```

步骤：

1. 把 [`docs/api-relay.js`](./docs/api-relay.js) 传到你的香港 VPS
2. 启动：`RELAY_TOKEN=$(openssl rand -hex 24) pm2 start api-relay.js --name bili-relay`
3. 建议套 HTTPS（Caddy 一条命令搞定），别明文传 Cookie
4. 在 Cloudflare Workers 项目里加两个环境变量：

   | Name | Value |
   |---|---|
   | `BILI_API_PROXY_BASE` | `https://relay.你的域名.com` |
   | `BILI_API_PROXY_TOKEN` | 上一步生成的 token |

5. 重新部署

> 中转服务内置了域名白名单（只允许 B 站系域名）+ token 鉴权，**这两项都不要关**，否则你的 VPS 会变成公开的免费代理。

### Q：首页显示「无法获取 WBI 密钥」或报错 -352

B 站风控。按有效性排序：

1. **登录 B 站账号**（最有效，登录态风控阈值高得多）
2. **换个 IP / 换网络**（境外 IP 特别容易被风控）
3. 等几分钟再试（风控是暂时的）
4. 检查服务器是不是在境外——是的话考虑换到香港节点

### Q：视频封面前几秒不显示 / 全是灰块

B 站图床校验 Referer，图片必须走 `/api/img` 代理。代码里所有图片都已经过代理了，如果还不行：

- 检查 `/api/img` 接口是不是被服务商拦了
- 图片代理有 24 小时缓存，清一下浏览器缓存

### Q：视频播放报 403 / 一直转圈

- **403**：视频流没走代理，或者代理的 Referer 没带上。确认用的是 `/api/playback`（或你配的 Worker），**不要直接把 B 站 CDN 地址塞给浏览器**
- **一直转圈**：多半是上面说的 Vercel 带宽耗尽或函数超时，去配 Cloudflare Worker

### Q：只有 480P，没有更高清晰度

B 站的规则：

- 未登录：最高 480P（部分 720P）
- 登录非大会员：最高 1080P
- 大会员：1080P+ / 4K / HDR / 杜比

点右上角「登录」扫码即可。**能不能拿到高画质取决于你的账号，不是本站限制。**

### Q：弹幕不显示

- 弹幕默认开启，检查播放器右下角「弹」按钮是不是灰的（灰=关闭）
- 有些视频弹幕被 UP 主关闭了，这是视频本身的设置
- 弹幕接口有 5 分钟缓存，新发的弹幕不会立刻出现

### Q：登录之后过几天又要重新登录

B 站的 `SESSDATA` 有效期约 30 天，本站保守按 25 天存。到期需要重新扫码，这是 B 站的机制，不是 bug。

### Q：扫码登录一直显示「等待扫码」

- 二维码 3 分钟失效，点「刷新二维码」
- 要用 **B 站手机 App** 扫（微信扫不出来）
- 部分手机需要在 App 里点「确认登录」才算完成

### Q：粘贴 Cookie 登录提示无效

Cookie 里必须包含这三项：`SESSDATA`、`bili_jct`、`DedeUserID`。

获取方法：浏览器登录 bilibili.com → F12 打开开发者工具 → Network 标签 → 随便刷新一个请求 → 在 Request Headers 里找 `Cookie:` → 复制整行。

### Q：本地 `npm run build` 失败

- Node 版本需要 **18.18+**（推荐 20 LTS）
- 删掉 `node_modules` 和 `package-lock.json` 重新 `npm install`
- 确认 `.env.local` 里没有奇怪的换行或引号

### Q：能加上「稍后再看」「历史记录」「动态」吗？

接口层已经铺好了（`src/lib/bili.ts` 里加方法即可），但本期没做。欢迎提 Issue 或 PR。

---

## 隐私与安全

### 登录是怎么处理的

1. 点「登录」→ 前端请求 `/api/login/qrcode` 拿到 B 站官方的二维码
2. 你用 B 站 App 扫码确认
3. B 站返回 `SESSDATA` / `bili_jct` / `DedeUserID`
4. 服务端用 **AES-GCM** 加密这三项，存进你浏览器的 **HttpOnly Cookie**
5. 之后请求 B 站时服务端解密、带上 Cookie、发起请求

### 关键承诺

- ✅ 凭据只存在**你自己的浏览器**里，服务端**不落库、不写日志、不共享**
- ✅ Cookie 是 HttpOnly，页面 JS 读不到，XSS 也偷不走
- ✅ 配置了 `SESSION_SECRET` 后，即使拿到 Cookie 也解不开
- ✅ 所有代码开源，加密逻辑在 `src/lib/session.ts`，可自行审计
- ✅ 随时可一键登出，Cookie 立即失效

### 不登录能用吗

能。全部浏览、搜索、播放功能都不需要登录，只是清晰度上限较低（480P）。

### 本站不做什么

- 不统计访问量、不埋点、不接 Google Analytics
- 不记录你看过什么
- 不读你的 B 站私信、钱包等无关数据（只用到了登录和播放必需的字段）

---

## 赞助

SmoothBili **永久免费、无广告、非盈利**。所有功能对所有人开放，赞助**不解锁任何特权**，只用于覆盖域名和服务器开销。

### 成本明细

| 项目 | 金额 |
|---|---|
| 域名（.com 续费） | 约 ¥90 / 年 |
| 服务器（香港基础 VPS） | 约 ¥0 - 300 / 年 |
| CDN / Cloudflare | ¥0（免费额度） |
| 开发与维护 | 用爱发电 ☕ |

### 支持方式

- **AlipayHK 扫码**：访问站点的 `/sponsor` 页，或点页脚「♥ 赞助开发者」
- **点个 Star**：GitHub 右上角，免费但很有用
- **提 Issue / PR**：反馈 bug 或参与开发
- **分享给朋友**：让更多人用上没有广告的 B 站

更换收款码：把图片放到 `public/sponsor/`，然后改 `src/lib/sponsor.ts` 里的 `qr` 字段。

---

## 许可与免责声明

### 许可

本项目采用 **AGPL-3.0** 许可（与参考的社区项目保持一致）。要点：

- 你可以自由运行、研究、修改、分发
- 若你修改后**通过网络提供服务**（包括部署成网站），必须向使用者公开修改后的源码
- 必须保留原作者声明
- 软件按「原样」提供，不含任何担保

完整正文见 [LICENSE](./LICENSE)。

### 免责声明

- 本项目是**个人学习与非盈利项目**，与哔哩哔哩官方**无任何关联**
- 站内所有视频、封面、弹幕、评论区内容的**版权均归哔哩哔哩及原作者所有**
- 接口调用请保持克制，避免对 B 站服务造成压力
- 请勿用于任何商业盈利用途
- 使用本项目即表示你知悉并同意自行承担因调用第三方接口产生的全部风险
- 若哔哩哔哩官方提出异议，本项目将配合整改或停止服务

---

<div align="center">

**SmoothBili · 哔哩滑滑 Biliboli**

无广告，不追踪，只是想好好看个视频。

Made with ♥ by contributors

</div>
