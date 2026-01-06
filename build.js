/*
 Copyright (c) 2026 EricZhao
 Licensed under GNU GPL v3: https://www.gnu.org/licenses/gpl-3.0.html
*/

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';
import container from 'markdown-it-container';
import 'dotenv/config';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const CONTENT_DIR = path.join(ROOT, 'content');
const POSTS_DIR = path.join(CONTENT_DIR, 'posts');
const THEME_DIR = path.join(ROOT, 'theme');

export async function runBuild() {
  const config = await loadConfig();
  await resetDist();
  await copyThemeAssets(config);

  const posts = await loadPosts(config);
  
  // Sync with Sink
  await syncSink(posts, config);

  const taxonomies = buildTaxonomies(posts);

  const sidebarData = {
    posts,
    tags: Array.from(taxonomies.tags.values()),
    categories: Array.from(taxonomies.categories.values())
  };

  const homeHtml = await renderHome({ config, posts, sidebarData });
  await writePage({ html: homeHtml, outDir: DIST_DIR });

  const articlesHtml = await renderArticles({ config, posts, sidebarData });
  await writePage({ html: articlesHtml, outDir: path.join(DIST_DIR, 'articles') });

  const tagsIndexHtml = await renderTaxonomyIndex({
    config,
    title: '标签',
    baseUrl: normalizeBase(config.baseUrl || '/'),
    type: 'tags',
    map: taxonomies.tags,
    sidebarData
  });
  await writePage({ html: tagsIndexHtml, outDir: path.join(DIST_DIR, 'tags') });

  const categoriesIndexHtml = await renderTaxonomyIndex({
    config,
    title: '分类',
    baseUrl: normalizeBase(config.baseUrl || '/'),
    type: 'categories',
    map: taxonomies.categories,
    sidebarData
  });
  await writePage({ html: categoriesIndexHtml, outDir: path.join(DIST_DIR, 'categories') });

  for (const post of posts) {
    const postHtml = await renderPost({ config, post, posts, sidebarData });
    const outDir = path.join(DIST_DIR, 'posts', post.slug);
    await writePage({ html: postHtml, outDir });
  }

  for (const entry of taxonomies.tags.values()) {
    const pageHtml = await renderTaxonomyPage({
      config,
      title: `标签 · ${entry.label}`,
      baseUrl: normalizeBase(config.baseUrl || '/'),
      type: 'tags',
      entry,
      sidebarData
    });
    await writePage({ html: pageHtml, outDir: path.join(DIST_DIR, 'tags', entry.slug) });
  }

  for (const entry of taxonomies.categories.values()) {
    const pageHtml = await renderTaxonomyPage({
      config,
      title: `分类 · ${entry.label}`,
      baseUrl: normalizeBase(config.baseUrl || '/'),
      type: 'categories',
      entry,
      sidebarData
    });
    await writePage({ html: pageHtml, outDir: path.join(DIST_DIR, 'categories', entry.slug) });
  }
  const totalPages =
    posts.length + // post detail pages
    2 + // home + articles
    2 + // tags index + categories index
    taxonomies.tags.size +
    taxonomies.categories.size;
  
  // Generate random post redirect page
  const randomPostScript = `
    <script>
      const posts = ${JSON.stringify(posts.map(p => `${normalizeBase(config.baseUrl || '/')}posts/${p.slug}/`))};
      if (posts.length > 0) {
        const random = posts[Math.floor(Math.random() * posts.length)];
        window.location.href = random;
      } else {
        window.location.href = "${normalizeBase(config.baseUrl || '/')}";
      }
    </script>
  `;
  await writePage({ html: `<!DOCTYPE html><html><head><meta charset="utf-8">${randomPostScript}</head><body></body></html>`, outDir: path.join(DIST_DIR, 'random') });

  console.log(`Build complete. Pages: ${totalPages}`);
}

async function loadConfig() {
  const configPath = path.join(ROOT, 'site.config.json');
  const fallback = {
    baseUrl: '/',
    profile: {
      name: '博主名字',
      tagline: '关于你的Tag',
      bio: '这里是你的个人介绍，可以写一些关于你自己的话。',
      location: '某个角落',
      avatar: '',
      links: [
        { label: '主页', href: '/' }
      ]
    },
    copyright: '© 2026 EricZhao'
  };

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    
    // Inject env vars
    if (process.env.SINK_API_URL && parsed.services?.shortLink) {
      parsed.services.shortLink.url = process.env.SINK_API_URL;
    }

    return { ...fallback, ...parsed, profile: { ...fallback.profile, ...(parsed.profile || {}) } };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
}

async function resetDist() {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });
}

async function copyThemeAssets(config) {
  const assetsDir = path.join(DIST_DIR, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });
  const styleSrc = path.join(THEME_DIR, 'style.css');
  const styleDest = path.join(assetsDir, 'style.css');
  await fs.copyFile(styleSrc, styleDest);

  const baseUrl = normalizeBase(config.baseUrl || '/');
  const paletteSrc = path.join(THEME_DIR, 'palette.json');
  try {
    await fs.copyFile(paletteSrc, path.join(assetsDir, 'palette.json'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

async function loadPosts(config) {
  await fs.mkdir(POSTS_DIR, { recursive: true });
  const files = await fs.readdir(POSTS_DIR);
  const md = createMarkdown();
  const posts = [];

  const toList = (value) => {
    if (Array.isArray(value)) return value.map((v) => `${v}`.trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
    return [];
  };

  const toTaxonomy = (value) =>
    toList(value).map((label) => ({ label, slug: slugifySegment(label) })).filter((item) => item.label);

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const fullPath = path.join(POSTS_DIR, file);
    const raw = await fs.readFile(fullPath, 'utf8');
    const { data, content } = matter(raw);
    const slug = data.slug || file.replace(/\.md$/, '');
    const date = data.date ? new Date(data.date) : new Date();
    const dateText = !Number.isNaN(date.getTime())
      ? date.toISOString().slice(0, 10)
      : (data.date ? `${data.date}`.slice(0, 10) : '');
    const env = { toc: [] };
    let html = md.render(content, env);
    
    // Process hide syntax:
    // Block form:
    // ::: hide[标签] :::
    // 隐藏内容
    // :::
    // Tip is now configured in site.config.json (theme.hideTip)
    // We still match the old inline syntax with {tip=...} to consume it, but prefer the label in block form.
    const hideTip = config.theme?.hideTip || '点击查看';
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // block form
    html = html.replace(/:::\s*hide\[(.*?)\]\s*:::\s*([\s\S]*?)\s*:::/g, (m, label, inner) => {
      return `<span class="hide-text" data-tip="${esc(label || hideTip)}">${inner}</span>`;
    });
    // fallback: inline form
    html = html.replace(/:::\s*hide\[(.*?)\](?:\{.*?\})?\s*:::/g, (match, content) => `<span class="hide-text" data-tip="${esc(hideTip)}">${content}</span>`);

    const summary = data.summary || content.slice(0, 120).replace(/\n/g, ' ');
    const categories = toTaxonomy(data.categories || data.category);
    const tags = toTaxonomy(data.tags || data.tag);

    posts.push({
      slug,
      title: data.title || slug,
      date,
      dateText,
      summary,
      html,
      toc: env.toc,
      categories,
      tags,
      shortLink: data.shortLink, // Load existing shortLink
      filePath: fullPath, // Store path for updating
      rawContent: content, // Store raw content for updating
      rawData: data // Store raw data for updating
    });
  }

  return posts.sort((a, b) => b.date - a.date);
}

async function syncSink(posts, config) {
  const sinkUrl = process.env.SINK_API_URL;
  const sinkKey = process.env.SINK_API_KEY;
  const siteUrl = config.siteUrl;

  if (!sinkUrl || !sinkKey || !siteUrl) {
    console.log('Skipping Sink sync: Missing SINK_API_URL, SINK_API_KEY or siteUrl');
    return;
  }

  console.log('Syncing with Sink...');

  for (const post of posts) {
    // Check if shortLink is missing OR is an object (fix previous bug)
    if (post.shortLink && typeof post.shortLink === 'string') continue;

    const longUrl = `${siteUrl.replace(/\/$/, '')}${normalizeBase(config.baseUrl)}posts/${post.slug}/`;
    console.log(`Creating short link for: ${post.title} (${post.slug})`);

    try {
      const res = await fetch(`${sinkUrl.replace(/\/$/, '')}/api/link/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sinkKey}`
        },
        body: JSON.stringify({
          url: longUrl,
          slug: post.slug
        })
      });

      if (!res.ok) {
        if (res.status === 409) {
             console.log(`Link already exists for ${post.slug}, using default construction.`);
             const constructed = `${sinkUrl.replace(/\/$/, '')}/${post.slug}`;
             // Update markdown
             post.shortLink = constructed;
             const newFrontmatter = { ...post.rawData, shortLink: constructed };
             const newFileContent = matter.stringify(post.rawContent, newFrontmatter);
             await fs.writeFile(post.filePath, newFileContent, 'utf8');
             continue;
        }
        const errText = await res.text();
        console.error(`Failed to create link for ${post.slug}: ${res.status} ${errText}`);
        continue;
      }

      const data = await res.json();
      
      // Sink returns { slug, link, ... } or similar.
      // We want the full short link.
      // If data.link is present, use it. Otherwise construct it.
      let shortLink = null;
      if (typeof data.link === 'string') {
        shortLink = data.link;
      } else if (typeof data.shortLink === 'string') {
        shortLink = data.shortLink;
      } else if (typeof data.shortUrl === 'string') {
        shortLink = data.shortUrl;
      } else if (data.url && typeof data.url === 'string') {
         shortLink = data.url;
      }
      
      if (!shortLink && data.slug) {
        shortLink = `${sinkUrl.replace(/\/$/, '')}/${data.slug}`;
      }

      if (shortLink) {
        console.log(`Generated: ${shortLink}`);
        post.shortLink = shortLink;
        
        // Update markdown file
        const newFrontmatter = { ...post.rawData, shortLink };
        const newFileContent = matter.stringify(post.rawContent, newFrontmatter);
        await fs.writeFile(post.filePath, newFileContent, 'utf8');
      }
    } catch (err) {
      console.error(`Error syncing ${post.slug}:`, err);
    }
  }
}

async function renderHome({ config, posts, sidebarData }) {
  const homePath = path.join(CONTENT_DIR, 'home.md');
  let homeContent = '';
  try {
    const raw = await fs.readFile(homePath, 'utf8');
    const md = createMarkdown();
    homeContent = md.render(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    homeContent = '<p>写下你的第一篇文章吧，故事从这里开始。</p>';
  }

  const baseUrl = normalizeBase(config.baseUrl || '/');
  const nav = buildNav({ baseUrl });
  return renderPage({
    title: config.profile?.name || '主页',
    content: `
      <section class="article-card">
        <div class="eyebrow">关于</div>
        <h1>博主自述</h1>
        ${homeContent}
      </section>
    `,
    config,
    baseUrl,
    nav,
    toc: [],
    sidebarData
  });
}

async function renderArticles({ config, posts, sidebarData }) {
  const baseUrl = normalizeBase(config.baseUrl || '/');
  const nav = buildNav({ baseUrl });
  return renderPage({
    title: '文章列表',
    content: `
      <section class="article-card">
        <div class="eyebrow">全部文章</div>
        <h1>文章一览</h1>
        <div class="post-list">
          ${posts
            .map(
              (post) => `
              <article class="post-item">
                <div class="post-meta">${post.dateText}</div>
                <div class="title-row">
                  <h2><a href="${baseUrl}posts/${post.slug}/">${post.title}</a></h2>
                  <a class="read-more" href="${baseUrl}posts/${post.slug}/">阅读</a>
                </div>
                <p>${post.summary}</p>
                ${renderPills({ baseUrl, post })}
              </article>
            `
            )
            .join('')}
        </div>
      </section>
    `,
    config,
    baseUrl,
    nav,
    toc: [],
    sidebarData
  });
}
async function renderPost({ config, post, posts, sidebarData }) {
  const baseUrl = normalizeBase(config.baseUrl || '/');
  const nav = buildNav({ baseUrl });
  return renderPage({
    title: post.title,
    content: `
      <article class="article-card">
        <div class="eyebrow">${post.dateText}</div>
        <h1>${post.title}</h1>
        <div class="meta-chips">
          ${post.categories.length
            ? `<div class="chip-row"><span class="chip-label">分类</span>${post.categories
                .map((cat) => `<a class="chip" href="${baseUrl}categories/${cat.slug}/">${cat.label}</a>`)
                .join('')}</div>`
            : ''}
          ${post.tags.length
            ? `<div class="chip-row"><span class="chip-label">标签</span>${post.tags
                .map((tag) => `<a class="chip" href="${baseUrl}tags/${tag.slug}/">${tag.label}</a>`)
                .join('')}</div>`
            : ''}
        </div>
        ${post.html}
      </article>
      <section class="article-card copyright-card">
        <h3>版权声明</h3>
        <div class="copyright-grid">
          <div class="copyright-item">
            <span class="cp-label">本文标题：</span>
            <span class="cp-value">${post.title}</span>
          </div>
          <div class="copyright-item">
            <span class="cp-label">本文作者：</span>
            <span class="cp-value">${config.profile.name}</span>
          </div>
          ${config.services?.shortLink?.enabled ? `
          <div class="copyright-item">
            <span class="cp-label">本文链接：</span>
            <span class="cp-value"><a id="short-link" href="#">生成中...</a></span>
            <button class="copy-btn" onclick="copyShortLink(this)">复制</button>
          </div>
          ` : `
          <div class="copyright-item">
            <span class="cp-label">本文链接：</span>
            <span class="cp-value"><a id="post-link" href="${baseUrl}posts/${post.slug}/">${baseUrl}posts/${post.slug}/</a></span>
            <button class="copy-btn" onclick="copyLink(this)">复制</button>
          </div>
          `}
          <div class="copyright-item full-width">
            <span class="cp-label">版权声明：</span>
            <span class="cp-value">本博客所有文章除特别声明外，均采用 <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank">CC BY-NC-SA 4.0</a> 许可协议。转载请注明出处。</span>
          </div>
        </div>
        <script>
          (function() {
            const linkEl = document.getElementById('post-link');
            if (linkEl) {
              linkEl.href = window.location.href;
              linkEl.innerText = window.location.href;
            }

            const shortLinkEl = document.getElementById('short-link');
            // If shortLink is already generated at build time, use it.
            const preGeneratedShortLink = "${post.shortLink || ''}";
            
            if (shortLinkEl) {
              if (preGeneratedShortLink) {
                shortLinkEl.href = preGeneratedShortLink;
                shortLinkEl.innerText = preGeneratedShortLink;
              } else {
                // Fallback to client-side generation if not present (e.g. build failed to sync)
                const shortLinkService = "${config.services?.shortLink?.url || ''}";
                if (shortLinkService) {
                   const targetUrl = window.location.href;
                   fetch(shortLinkService, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ url: targetUrl, slug: "${post.slug}" })
                   })
                   .then(res => res.json())
                   .then(data => {
                     const result = data.link || data.shortUrl || data.url;
                     if(result) {
                       shortLinkEl.href = result;
                       shortLinkEl.innerText = result;
                     } else if (data.slug) {
                       const origin = new URL(shortLinkService).origin;
                       const full = origin + '/' + data.slug;
                       shortLinkEl.href = full;
                       shortLinkEl.innerText = full;
                     } else {
                       shortLinkEl.innerText = '生成失败';
                     }
                   })
                   .catch(e => {
                     console.error(e);
                     shortLinkEl.innerText = '服务不可用';
                   });
                }
              }
            }
          })();

          function copyLink(btn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
              const original = btn.innerText;
              btn.innerText = '已复制';
              setTimeout(() => { btn.innerText = original; }, 2000);
            });
          }

          function copyShortLink(btn) {
             const shortLinkEl = document.getElementById('short-link');
             if(shortLinkEl && shortLinkEl.href && !shortLinkEl.href.endsWith('#')) {
                navigator.clipboard.writeText(shortLinkEl.href).then(() => {
                  const original = btn.innerText;
                  btn.innerText = '已复制';
                  setTimeout(() => { btn.innerText = original; }, 2000);
                });
             }
          }
        </script>
      </section>
    `,
    config,
    baseUrl,
    nav,
    toc: post.toc,
    sidebarData
  });
}

function renderPage({ title, content, config, nav, toc, baseUrl, sidebarData }) {
  const assetHref = `${baseUrl}assets/style.css`;
  const profile = config.profile || {};
  const avatarClass = profile.avatar ? 'avatar has-image' : 'avatar';
  const avatarStyle = profile.avatar ? `style="background-image: url('${profile.avatar}')"` : '';
  
  // Analytics Injection
  const analyticsScript = config.services?.analytics?.enabled && config.services.analytics.src
    ? `<script src="${config.services.analytics.src}" defer></script>`
    : '';

  // Custom Background Injection
  const customBgStyle = config.theme?.customBackground
    ? `<style>body { background-image: url('${config.theme.customBackground}') !important; background-size: cover !important; background-attachment: fixed; }</style>`
    : '';

  const renderProfileLinks = () => {
    const iconPickers = [
      { matcher: (link) => /github/i.test(link.label || '') || /github\.com/i.test(link.href || ''), cls: 'fa-brands fa-github' },
      { matcher: (link) => /^mailto:/i.test(link.href || '') || /(mail|邮箱|email)/i.test(link.label || ''), cls: 'fa-solid fa-envelope' }
    ];

    return (profile.links || [])
      .map((link) => {
        const icon = iconPickers.find((item) => item.matcher(link))?.cls;
        const iconHtml = icon ? `<i class="${icon}" aria-hidden="true"></i>` : '';
        const text = link.label || link.href;
        const content = icon ? iconHtml : `<span>${text}</span>`;
        return `<a class="link-item" href="${link.href}" target="_blank" rel="noreferrer" aria-label="${text}">${content}</a>`;
      })
      .join('');
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
  <link rel="stylesheet" href="${assetHref}">
  ${customBgStyle}
  ${analyticsScript}
</head>
<body>
  <button class="mobile-menu-btn" aria-label="打开菜单">
    <span></span><span></span><span></span>
  </button>
  <div class="page">
    <aside class="sidebar">
      <div class="profile-card">
        <div class="${avatarClass}" ${avatarStyle}></div>
        <div class="profile-text">
          <div class="eyebrow">${profile.location || 'somewhere'}</div>
          <h1>${profile.name || '博主'}</h1>
          <p class="tagline">${profile.tagline || ''}</p>
          <p class="bio">${profile.bio || ''}</p>
        </div>
        <div class="menu">
          <ul>
            ${nav
              .map((item) => `<li><a href="${item.href}">${item.label}</a></li>`)
              .join('')}
          </ul>
        </div>
        <button class="theme-toggle" aria-label="切换明暗模式" data-mode="light">
          <span class="thumb">☀️</span>
          <span class="track"></span>
        </button>
        <div class="links">
          ${renderProfileLinks()}
        </div>
      </div>
    </aside>
  <div class="drawer-overlay" aria-hidden="true"></div>
    <main class="content">
      ${content}
    </main>
    ${renderRightSidebar({ toc, sidebarData, baseUrl, config })}
  </div>
  <script>
    (() => {
      const KEY = 'hozokura-theme';
      const btn = document.querySelector('.theme-toggle');
      const thumb = btn.querySelector('.thumb');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      const apply = (mode) => {
        document.documentElement.dataset.theme = mode;
        btn.dataset.mode = mode;
        thumb.textContent = mode === 'dark' ? '🌙' : '☀️';
      };

      const stored = localStorage.getItem(KEY);
      const initial = stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light';
      apply(initial);

      btn.addEventListener('click', () => {
        const next = btn.dataset.mode === 'dark' ? 'light' : 'dark';
        apply(next);
        localStorage.setItem(KEY, next);
      });

      // Drawer for mobile
      const menuBtn = document.querySelector('.mobile-menu-btn');
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.querySelector('.drawer-overlay');
      const setDrawer = (open) => {
        document.documentElement.dataset.drawer = open ? 'open' : 'closed';
      };
      menuBtn?.addEventListener('click', () => {
        const isOpen = document.documentElement.dataset.drawer === 'open';
        setDrawer(!isOpen);
      });
      overlay?.addEventListener('click', () => setDrawer(false));
      window.addEventListener('keyup', (e) => {
        if (e.key === 'Escape') setDrawer(false);
      });
      setDrawer(false);

      // Show All logic
      document.querySelectorAll('.show-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetId = btn.dataset.target;
          const list = document.getElementById(targetId);
          if (list) {
            list.classList.add('show-all');
            btn.style.display = 'none';
          }
        });
      });
    })();
  </script>
</body>
</html>`;
}

function renderRightSidebar({ toc, sidebarData, baseUrl, config }) {
  const { posts = [], tags = [], categories = [] } = sidebarData || {};
  
  const renderSection = (title, items, renderer, id) => {
    if (!items || items.length === 0) return '';
    const listHtml = items.map(renderer).join('');
    const showAllBtn = items.length > 5 
      ? `<button class="show-all-btn" data-target="${id}">展示全部</button>` 
      : '';
    return `
      <div class="sidebar-section">
        <div class="section-title">${title}</div>
        <ul class="sidebar-list" id="${id}">
          ${listHtml}
        </ul>
        ${showAllBtn}
      </div>
    `;
  };

  const categoriesHtml = renderSection(
    '分类', 
    categories, 
    (cat) => `<li><a href="${baseUrl}categories/${cat.slug}/">${cat.label} (${cat.posts.length})</a></li>`,
    'sidebar-categories'
  );

  const tagsHtml = renderSection(
    '标签', 
    tags, 
    (tag) => `<li><a href="${baseUrl}tags/${tag.slug}/">${tag.label} (${tag.posts.length})</a></li>`,
    'sidebar-tags'
  );

  const tocHtml = toc && toc.length ? `
    <div class="sidebar-section toc-section">
      <div class="section-title">跳转</div>
      <ul class="toc-list">
        ${toc.map(item => `<li class="level-${item.level}"><a href="#${item.id}">${item.text}</a></li>`).join('')}
      </ul>
    </div>
  ` : '';

  const copyrightHtml = config && config.copyright ? `
    <aside class="copyright-card">
      ${config.copyright}
    </aside>
  ` : '';

  return `
    <div class="right-column">
      <aside class="right-sidebar-card">
        ${categoriesHtml}
        ${tagsHtml}
        ${tocHtml}
      </aside>
      ${copyrightHtml}
    </div>
  `;
}

async function writePage({ html, outDir }) {
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'index.html');
  await fs.writeFile(outPath, html, 'utf8');
}

function buildNav({ baseUrl, posts }) {
  const links = [{ label: '主页', href: baseUrl }];
  links.push({ label: '文章', href: `${baseUrl}articles/` });
  links.push({ label: '随机文章', href: `${baseUrl}random/` });
  links.push({ label: '友链', href: `https://www.ericzhao3366.work/` });
  return links;
}

function renderPills({ baseUrl, post }) {
  const categoryPills = (post.categories || [])
    .map((cat) => `<a class="pill" href="${baseUrl}categories/${cat.slug}/">${cat.label}</a>`)
    .join('');
  const tagPills = (post.tags || [])
    .map((tag) => `<a class="pill" href="${baseUrl}tags/${tag.slug}/">${tag.label}</a>`)
    .join('');
  const content = [categoryPills, tagPills].filter(Boolean).join('');
  return content ? `<div class="pill-row">${content}</div>` : '';
}

function buildTaxonomies(posts) {
  const tags = new Map();
  const categories = new Map();
  for (const post of posts) {
    for (const tag of post.tags || []) {
      if (!tags.has(tag.slug)) tags.set(tag.slug, { slug: tag.slug, label: tag.label, posts: [] });
      tags.get(tag.slug).posts.push(post);
    }
    for (const cat of post.categories || []) {
      if (!categories.has(cat.slug)) categories.set(cat.slug, { slug: cat.slug, label: cat.label, posts: [] });
      categories.get(cat.slug).posts.push(post);
    }
  }
  return { tags, categories };
}

async function renderTaxonomyIndex({ config, title, baseUrl, type, map, sidebarData }) {
  const nav = buildNav({ baseUrl });
  const items = Array.from(map.values()).sort((a, b) => b.posts.length - a.posts.length || a.label.localeCompare(b.label));
  const label = type === 'tags' ? '标签' : '分类';
  return renderPage({
    title,
    content: `
      <section class="article-card">
        <div class="eyebrow">${label}目录</div>
        <h1>${title}</h1>
        <div class="tax-grid">
          ${items
            .map(
              (item) => `
              <a class="tax-card" href="${baseUrl}${type}/${item.slug}/">
                <div class="tax-name">${item.label}</div>
                <div class="tax-count">${item.posts.length} 篇</div>
              </a>
            `
            )
            .join('')}
        </div>
      </section>
    `,
    config,
    baseUrl,
    nav,
    toc: [],
    sidebarData
  });
}

async function renderTaxonomyPage({ config, title, baseUrl, type, entry, sidebarData }) {
  const nav = buildNav({ baseUrl });
  const label = type === 'tags' ? '标签' : '分类';
  return renderPage({
    title,
    content: `
      <section class="article-card">
        <div class="eyebrow">${label}</div>
        <h1>${entry.label}</h1>
        <div class="post-list">
          ${entry.posts
            .map(
              (post) => `
              <article class="post-item">
                <div class="post-meta">${post.dateText}</div>
                <div class="title-row">
                  <h2><a href="${baseUrl}posts/${post.slug}/">${post.title}</a></h2>
                  <a class="read-more" href="${baseUrl}posts/${post.slug}/">阅读</a>
                </div>
                <p>${post.summary}</p>
              </article>
            `
            )
            .join('')}
        </div>
      </section>
    `,
    config,
    baseUrl,
    nav,
    toc: [],
    sidebarData
  });
}

function createMarkdown() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
  
  // Custom containers
  ['success', 'fail', 'warn'].forEach(type => {
    md.use(container, type, {
      render: function (tokens, idx) {
        const m = tokens[idx].info.trim().match(new RegExp(`^${type}\\s*(.*)$`));
        if (tokens[idx].nesting === 1) {
          // opening tag
          const title = m[1] ? m[1] : (type === 'success' ? '成功' : type === 'fail' ? '错误' : '注意');
          return `<div class="admonition ${type}"><span class="admonition-title">${md.utils.escapeHtml(title)}</span>\n`;
        } else {
          // closing tag
          return '</div>\n';
        }
      }
    });
  });

  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const level = token.tag;
    const next = tokens[idx + 1];
    if (next && (level === 'h2' || level === 'h3' || level === 'h4')) {
      const text = extractInlineText(next);
      const slug = makeSlug(text, env);
      token.attrSet('id', slug);
      if (env && Array.isArray(env.toc)) {
        env.toc.push({ id: slug, text, level });
      }
    }
    return self.renderToken(tokens, idx, options);
  };
  return md;
}

function extractInlineText(token) {
  if (!token.children) return '';
  return token.children
    .filter((t) => t.type === 'text' || t.type === 'code_inline')
    .map((t) => t.content)
    .join(' ')
    .trim();
}

function makeSlug(text, env) {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  if (!env) return base;
  if (!env.slugMap) env.slugMap = new Map();
  const count = env.slugMap.get(base) || 0;
  env.slugMap.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function slugifySegment(text) {
  return `${text}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function normalizeBase(input) {
  let base = input || '/';
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

const isDirectRun = (() => {
  const current = fileURLToPath(import.meta.url);
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return current === entry;
})();

if (isDirectRun) {
  runBuild().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
