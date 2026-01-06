**穗仓风（Hozokura）静态博客**

一个面向写作者的轻量静态博客生成器，使用 Markdown 写作、生成静态 HTML。风格偏日式简约，默认支持文章目录、标签/分类索引、主题色与明/暗模式。

**主要特性**

- Markdown 文章自动渲染，支持 FrontMatter：`title`, `date`, `summary`, `slug` 等。
- 自动为文章生成右侧目录（基于 `##`/`###` 等标题）。
- 支持 `hide` 隐藏文本语法（鼠标悬停显示提示）。
- 支持自定义提示块：`success` / `fail` / `warn`（基于 `markdown-it-container`）。
- 集成短链接（Sink）和基础访问分析，支持构建时自动同步并回写短链接到文章 FrontMatter。
- 可在 `site.config.json` 配置自定义背景图片与主题文本。

**快速开始**

1. 安装依赖

```bash
npm install
```

2. 本地构建

```bash
npm run build
```

3. 本地预览（会先构建并监听变更）

```bash
npm run preview
```

输出内容位于 `dist/`。

**写文章**

在 `content/posts/` 新建 `.md` 文件，示例：

```markdown
---
title: 文章标题
date: 2025-12-01
summary: 一段摘要
slug: your-slug
---

## 正文标题

文章内容...
```

**Hide 隐藏块（统一使用配置提示）**

现在提示文本由站点配置统一控制（`site.config.json` 中的 `theme.hideTip`），在文章里使用：

```markdown
::: hide[这里是被隐藏的内容] :::
```

鼠标悬停时会显示提示（例如“点击查看隐藏内容”）。

**Admonition（提示块）**

支持三类块级提示：

```markdown
::: success 成功标题
成功内容
:::

::: fail 错误标题
错误内容
:::

::: warn 注意标题
警告内容
:::
```

**短链接（Sink）集成**

构建时会检测文章 FrontMatter 是否包含 `shortLink`，若缺失则会使用 `.env` 中的 `SINK_API_URL` 与 `SINK_API_KEY` 向 Sink 服务创建短链并回写到文章中（短链以文章文件名为 slug）。

.env 示例：

```dotenv
SINK_API_URL=https://your-sink.example
SINK_API_KEY=your_sink_api_key
```

在 `site.config.json` 中请配置：

```json
"siteUrl": "https://your-blog.example"
```

构建时会用 `siteUrl + baseUrl + posts/<slug>/` 构造长链接并发送给 Sink。

Sink链接：https://github.com/miantiao-me/Sink

**自定义配置**

在 `site.config.json` 中设置 

```json
{
  "baseUrl": "/",//请不要修改
  "siteUrl": "https://www.example.com/",//请改为你的博客网址
  "profile": {
    "avatar":"/",//你的头像
    "name": "/",//你的名字
    "tagline": "/",//关于你的tag
    "bio": "/",//介绍
    "location": "/",//地点
    "links": [//自定义链接
      { "label": "GitHub", "href": "/" },
      { "label": "邮箱", "href": "/" }
    ]
  },
  "services": {
    "shortLink": {
      "enabled": true//是否启用短链接服务
    }
  },
  "theme": {
    "customBackground": "/",//博客背景
    "hideTip": "/"//hide代码的提示
  }
}
```

**配置文件**

- `site.config.json`：站点主要配置（`baseUrl`、`profile`、`services`、`theme.hideTip`、`siteUrl` 等）。
- `.env`：放置敏感的第三方服务地址与密钥（例如 `SINK_API_URL`、`SINK_API_KEY`）。

**开发建议**

- 保持 `content/posts/` 的 `slug` 与文件名一致，短链同步更可靠。
- 若不使用 Sink，可在 `site.config.json` 将 `services.shortLink.enabled` 设为 `false`。

**贡献**

欢迎提交 Issue 或 PR：保持修改小而专注，更新 `README.md` 同步使用说明。

**许可证**

本仓库遵循 GPL v3 协议。

***你需要***

- 保留并附带许可证：分发时必须随包一并包含 `LICENSE`（GPLv3）。
- 提供源码或获取方式：发布二进制/打包文件时，要提供完整源码或明确可行的获取方式。
- 同样许可分发：你发布的衍生作品必须以 GPLv3（或兼容条款）授权，不能改为更限定的许可。
- 保留版权声明：保留原作者的版权与许可声明，并在新增文件加入你的版权声明。
