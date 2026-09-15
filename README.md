# SmoothBili · 哔哩滑滑 Biliboli

> 无广告、不追踪、非盈利的第三方哔哩哔哩 Web 客户端。
> 数据全部直连 Bilibili 官方公开接口，接口策略参考社区项目（piliplus / pilipala / bilibili-API-collect）。

## ✨ 特性

- 🚫 **零广告**：没有开屏广告、信息流推广、直播间弹窗、带货卡片
- 🎬 **完整观影闭环**：首页推荐 / 热门、搜索、排行榜、视频播放、分 P、弹幕、评论
- 🎨 **多画质**：DASH 播放，登录后最高支持 4K / 高码率（取决于你的账号权限）
- 💬 **弹幕**：Canvas 自绘，可调透明度 / 字号 / 显示区域
- 🔐 **登录可选**：扫码登录或粘贴 Cookie，凭据 AES-GCM 加密后只存你自己的浏览器
- 🖼️ **图片代理**：封面 / 头像经服务端代理，不会被 B 站 Referer 校验拦掉
- 🌗 **深色模式**：跟随系统
- ♥ **非盈利**：永久免费，赞助仅用于覆盖域名与服务器成本

## 🧱 技术栈

- **Next.js 15（App Router）+ TypeScript + React 19**
- **Tailwind CSS v4**（仅用少量自定义 CSS 变量，见 `src/app/globals.css`）
- 服务端 Route Handlers 作为 B 站 API 代理层（解决 CORS + Referer 双重限制）
- 播放器：dash.js（CDN 动态加载）+ 原生 `<video>` 降级
- 弹幕：Canvas 自绘，零依赖

## 🚀 快速开始

```bash
# 1. 安装依赖
npm install

# 2.（可选）设置登录态加密密钥，生产环境务必修改
cp .env.example .env.local
# 生成随机密钥：openssl rand -hex 32

# 3. 启动开发服务器
npm run dev
```

打开 http://localhost:3000

## 📦 部署

### Vercel / 任意 Node 平台

```bash
npm run build
npm start
```

环境变量：
- `SESSION_SECRET`：登录态加密密钥（**生产环境必填**）

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

> ⚠️ 注意：B 站接口对请求来源有风控。若部署在境外服务器，部分接口（推荐流、播放地址）
> 可能返回 `-352` 风控错误，建议部署在大陆或香港节点，并引导用户登录使用。

## 🔧 目录结构

```
src/
├── app/
│   ├── page.tsx                    首页（推荐 / 热门）
│   ├── search/page.tsx             搜索
│   ├── video/[bvid]/page.tsx       视频详情
│   ├── space/[mid]/page.tsx        UP 主主页
│   ├── ranking/page.tsx            排行榜
│   ├── sponsor/page.tsx            赞助页（AlipayHK 收款码）
│   └── api/
│       ├── img/route.ts            封面 / 头像代理
│       ├── playback/route.ts       视频流代理（透传 Range）
│       ├── playurl/route.ts        播放地址（改写为代理 URL）
│       ├── danmaku/route.ts        弹幕（XML → JSON）
│       ├── interact/route.ts       点赞 / 投币 / 收藏 / 三连
│       ├── login/                  扫码登录 / Cookie 导入 / 登出
│       ├── search/suggest/route.ts 搜索建议
│       └── bili/comment/           评论翻页 / 楼中楼
├── components/                     Nav / Player / Danmaku 等 UI
└── lib/
    ├── md5.ts                      纯 TS MD5（WBI 签名用）
    ├── wbi.ts                      WBI 签名
    ├── bilibase.ts                 请求底层：设备指纹 / 密钥 / 风控重试
    ├── bili.ts                     业务接口封装
    ├── session.ts                  凭据加解密
    ├── format.ts                   展示格式化
    └── sponsor.ts                  赞助信息（改这里换收款码）
```

## 🔐 关于登录与隐私

- 扫码登录走 B 站官方二维码通道，你只需在 B 站 App 里确认
- 登录后的 `SESSDATA` / `bili_jct` 等凭据经 **AES-GCM 加密**后存放在
  `HttpOnly` Cookie 中，**服务端不落库、不记录、不共享**
- 不登录也能正常使用全部浏览与播放功能（清晰度上限较低）
- 随时可在右上角头像菜单一键登出

## 📄 许可与声明

- 本项目为个人学习与非盈利项目，**与哔哩哔哩官方无关**
- 所有视频、封面、弹幕内容的版权均归哔哩哔哩及原作者所有
- 请勿用于任何商业用途；接口调用请保持克制，避免对 B 站服务造成压力
- 代码遵循 **AGPL-3.0** 许可（与参考项目保持一致）

## ♥ 赞助

如果你觉得好用，可以请作者喝杯咖啡 ☕ —— 赞助仅用于覆盖域名与服务器成本。
赞助页：`/sponsor`（页脚常驻入口）
