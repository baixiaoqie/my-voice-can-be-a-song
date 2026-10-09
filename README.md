# 我的声音也能成曲

> 一个「录下自己的声音，就能用它演奏」的声音盒玩具。
> 点格子 / 拖动 / 按键，让像素车站亮起来。

[![license](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

## 这是什么

用浏览器录一段自己的声音，它会被切成若干「音符片段」，然后你就能像玩乐器一样
敲出旋律 —— 屏幕上的像素车站随演奏亮起粒子效果。

- 纯前端静态站点，**零构建步骤**，无后端依赖
- 录音本地存储（IndexedDB → localStorage → 内存逐级降级），音频不出你的浏览器
- 支持导入他人制作的「歌姬 / 背景音轨」JSON 配置

## 快速开始

本项目是纯静态站点，任选其一即可运行：

```bash
# 方式一：直接用浏览器打开 index.html
#   注意：部分浏览器对 file:// 的 fetch 有限制，推荐用方式二

# 方式二：起一个本地静态服务器（推荐）
cd mode-b-pixel-unified
python -m http.server 8000
# 然后访问 http://127.0.0.1:8000/
```

进入首页后：

1. 点「**开始**」进入演奏页，或点「**自定义音频**」去录制自己的声音
2. 在自定义页选好歌姬 → 逐条录音保存
3. 回到首页，在「**选择**」里选中「**我的声音**」这个歌姬，开始演奏

## URL 参数

在网址后附加：

| 参数 | 作用 |
|------|------|
| `?auto=1` | 点击开始后**自动播放** |
| `?vocal=<歌姬名>` | 列表加载后自动选中该歌姬 |
| `?tracks=<音轨名>` | 列表加载后自动选中该背景音轨 |
| `?bank=<歌姬名>` | 自定义页直接载入指定歌姬配置 |

## 目录结构

```
index.html              入口（含关于页）
custom/                 自定义音频页（录音 / 导入 / 卡牌管理）
css/
  design-system.css     设计令牌唯一源（颜色/间距/字号/层级）
  utatap.css            基础同源层样式
js/
  main.js               主控模块
  pixel-*.js            像素车站渲染
  home-overlay.js       首页覆盖层
  voice-custom-bridge.js 自定义音频桥接
  modules/audio.js      音频引擎
data/                   歌姬与音轨配置 + 配置格式说明
shared/                 第三方库（YUI reset 等）
assets/                 第三方库（jQuery / PixiJS / GSAP）
```

### 样式层叠契约（勿随意调整顺序）

```
shared/sp/css/common.css   ← 第三方 reset
        ↓
css/utatap.css             ← 同源层，回退底色
        ↓
css/design-system.css      ← 设计令牌与组件规范，必须最后
```

## 技术栈

原生 HTML / CSS / JavaScript（ES Module）+ Canvas 2D。
第三方库仅 jQuery、PixiJS、GSAP、YUI Reset，无打包工具。

## 致谢与许可

本项目基于以下开源作品二次开发：

- **[mikutap](https://aidn.jp/mikutap)** —— 原作者 [daniwell](https://twitter.com/daniwell_aidn)（ aidn.jp ）
  提供的原始创意与设计，本项目的核心玩法原型来源于此。
- **[uta-tap](https://github.com/MrXiaoM/uta-tap)** —— MrXiaoM 维护的 Mikutap 衍生项目，
  本项目的代码基座、配置格式与部分音频素材来源于此。
- 站内歌姬与背景音轨配置由 [uta-tap 仓库](https://github.com/MrXiaoM/uta-tap/tree/main/data)
  的各位贡献者提供。

原作者 daniwell 与 MrXiaoM 的署名在此保留，源码中亦保留了原有的版权与出处注释。

**许可证：[GNU Affero General Public License v3.0](LICENSE)**

上游项目采用 AGPL-3.0，本项目作为其衍生作品同样沿用 AGPL-3.0。
AGPL-3.0 允许你自由使用、修改与再分发，但要求：

- 保留本文件与 `LICENSE` 中的版权与许可声明
- 显著标明你做过的修改
- 若通过网络向用户提供服务，须向这些用户提供完整的对应源码

若你不打算公开源码，请勿将本项目部署为网络服务，或考虑更换为宽松许可的独立实现。