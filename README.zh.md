# 自嘲熊桌宠 · Zichaoxiong Pet

> 给 **DeepSeek Harness (DSH) Web GUI** 的一只桌宠：穿女仆装的自嘲熊（长野 NAGANO 的
> *自分ツッコミくま* / Joke Bear），蹲在角落里，告诉你 agent 在干什么，而且绝不挡路。

[English](README.md) | [中文](README.zh.md)

[![ci](https://github.com/Aureole2009/zichaoxiong-pet/actions/workflows/ci.yml/badge.svg)](https://github.com/Aureole2009/zichaoxiong-pet/actions/workflows/ci.yml)
![code: MIT](https://img.shields.io/badge/code-MIT-blue)
![artwork: non-commercial](https://img.shields.io/badge/artwork-non--commercial-orange)

![桌宠在 DSH Web GUI 里的样子](docs/preview.webp)

**默认完全静止。** 只有你点它或拖它时才会动 —— 不会一直抖、不会乱撒星星、不打扰你干活。

## 特点

| | |
| --- | --- |
| 🐻 **就在 GUI 里** | 一层浮动 div，除了熊本身所在的那一小块，其余位置点击完全穿透。没有独立窗口、没有 Python、没有后台进程。 |
| 🔇 **不碰不动** | 默认定格单帧。单击 → 摆动约 5 秒后自动停；拖动 → 拿起放下各动一下。 |
| 💬 **两套台词** | agent 干活时说「熊，在搬砖。」这类；没事时说「熊，淡淡的。」这类。共 65 条，全部按自嘲熊的语气写。 |
| 📐 **大小可调** | 右键 `大一点` / `小一点`，96px–288px 共 8 档。气泡、字号、尾巴整体等比缩放。 |
| 🧲 **拖拽 + 记忆** | 位置和尺寸记在浏览器里；拖到边上会被拉回来，不会跑丢。 |
| 🫥 **能藏起来** | 右键 `藏起来`，原地留一个小圆钮，点一下就回来。 |
| 🪶 **自带素材** | 7 帧动画以 data URL 内联进 bundle（整包约 180KB），不需要静态路由、不需要额外文件服务。 |

<table>
<tr><td><img src="docs/preview-menu.webp" alt="右键菜单" width="320"></td>
<td><img src="docs/preview-small.webp" alt="缩小后气泡同步变小" width="320"></td></tr>
<tr><td align="center">右键菜单：改大小、回家、藏起来。</td>
<td align="center">熊调小，气泡一起变小，仍在头顶之上。</td></tr>
</table>

## 安装

DSH 从「能解析到的包」里加载客户端插件，所以安装就是把包装进 web profile：

```bash
dsh plugin --profile web add github:Aureole2009/zichaoxiong-pet
```

这条命令会在 `~/.dsh/profiles/web` 里跑 pnpm，并自动把本包追加到
`dsh.profile.bundles`。

然后**重启一次 GUI** —— 插件清单是进程启动时读取的：

```bash
# 在跑 dsh web 的终端里 Ctrl-C，然后：
npx @deepseek-ai/dsh web
```

打开它打印出来的新地址（带 token）。会话记录不会丢。

<details>
<summary>其他安装方式</summary>

**从本地克隆安装**（目标机器不需要 git）：

```bash
git clone https://github.com/Aureole2009/zichaoxiong-pet
dsh plugin --profile web add ./zichaoxiong-pet
```

**手工接线**：

1. 把这个目录放到一个固定位置；
2. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 里加
   `"dsh-client-ui-pet-zichaoxiong": "link:/绝对路径"`；
3. 把 `"dsh-client-ui-pet-zichaoxiong"` 追加到 `dsh.profile.bundles`；
4. 在该目录跑 `dsh plugin --profile web install`（或 `pnpm install`）；
5. 重启 `dsh web`。

⚠️ **不要**在 profile 的 `cordis.patch.yml` 里再加一行 `ui-pet-zichaoxiong` ——
这一行是随包发布的，重复的 id 会让 DSH 启动失败。

</details>

## 使用

| 你做什么 | 它怎么样 |
| --- | --- |
| 什么都不做 | 每 1–2 分钟自己碎碎念一句（「熊，今天也很普通地活着。」），不吵 |
| 发消息让它干活 | 干活时说「熊，在搬砖。」，跑完说「人，弄好了。熊要躺下了。」 |
| 出错 | 「熊，搞砸了。熊先哭一下。」 |
| 戳一下 | 摆动约 5 秒 + 冒星星 + 换句台词（「熊，被戳了。熊的脸是软的。」） |
| 拖它 | 拿起/放下各一句，位置记住 |
| 右键 | `大一点` `小一点` `回到右下角` `藏起来` |
| 很久没动 | 「人，你去哪了。熊一直在。」 |

气泡本体始终在熊头顶之上，只有尾巴尖搭在头顶；如果熊被拖到窗口最上面，气泡会自动
翻到熊下面、尾巴朝上。

## 改成你自己的

**台词** —— `lib/src/pet-lines.js`，按场景分组（干活看 `busy` / `tool`，没事看
`idle` / `night` / `morning`，另有 `poke`、`lift`、`drop`、`done`、`error`、
`waiting`、`away`）。往数组里加一行，然后：

```bash
node tools/build-client.mjs      # 重新打包 lib/client.js
```

DSH 的 client-hmr 会在约 500ms 内自动替换，**不用重启也不用刷新**。

**尺寸 / 间距 / 配色** —— `lib/src/pet-css.js` 顶部的 `--zx-*` 变量，以及
`lib/src/pet-core.js` 里的 `SIZE_STEPS`。

**换成你自己的图** —— 把 `assets/source/zichaoxiong.gif` 换成任何**带透明背景的
动图**，然后：

```bash
python tools/build_assets.py     # 需要 Pillow：重新导出帧与 base64 模块
node tools/build-client.mjs
```

## 原理

DSH 的客户端插件由两半组成：宿主侧 `lib/index.js`（这里是空实现）和浏览器侧
`lib/client.js`（DSH 当普通脚本加载）。本插件向 layout 声明的 `shell.overlay`
槽位注册一个条目 —— 那是覆盖整个框架、默认点击穿透的浮动层 —— 然后只从
`ctx.sessions` 读两件事：这一轮是否在跑（`running`）、上次的 agent 报错
（`lastAgentError`）。不读对话内容；万一将来服务改名，桌宠会退化成一只安静的熊。

打包由一个约 100 行、零依赖的脚本完成（`tools/build-client.mjs`），把
`lib/src/*.js` 拼进 DSH 要求的 `window.__ModuleLoader__.load({…})` 包装里。

更详细的技术笔记（含几个花了真实调试时间的坑）：
[docs/dsh-client-plugin-notes.md](docs/dsh-client-plugin-notes.md)。

## 开发

```bash
```bash
node tools/build-client.mjs      # 打包
node test/verify-contract.mjs    # 清单 / loader 包装 / patch 行 检查
node test/verify-bundler.mjs     # 打包器遇到处理不了的源码必须报错
node test/run-harness.mjs        # 无头 Chrome 里跑完整的离线集成测试
```
```

`test/harness.html` 用一整套替身（假模块加载器、假 React、假 `shell.overlay`
槽位、假会话服务）把**真实产物**跑起来，50 条断言覆盖挂载、点击穿透、状态联动、
缩放、藏起来/叫回来、卸载清理；另有两页补边界：`harness-fallback.html`（8 条）
覆盖「layout 没声明槽位」时的兜底挂载，`harness-stale-error.html`（7 条）覆盖
「会话里还留着上一轮错误」时不该乱报警；harness-bad-storage.html（11 条）覆盖 localStorage 里塞了脏数据。CI 每次 push 都会跑这四条命令。

## 卸载

```bash
dsh plugin --profile web remove dsh-client-ui-pet-zichaoxiong
```

然后重启 `dsh web`。（如果你手工往 profile 的 `cordis.patch.yml` 加过行，也要删掉。）

## 许可

- **代码 —— MIT。** 见 [LICENSE](LICENSE)。随便用、随便改、随便发。
- **美术 —— 版权属于原作者 Nagano，禁止商用。** 角色「自分ツッコミくま /
  Joke Bear / 自嘲熊」属于 **长野 NAGANO（ナガノ）**（也是《ちいかわ》的作者）。
  作者曾在 X（推特）说明**不允许商用**，因此 `assets/` 里的图片、以及内联进
  `lib/client.js` 的那份拷贝**不在 MIT 许可范围内**，不得出售、不得用于任何商业用途。
  全文见 [NOTICE.md](NOTICE.md)。

本项目是非官方同人作品，与 Nagano 及权利方无隶属或背书关系。若你是权利方希望移除
相关美术，请开 issue，我会立刻删除。

## 致谢

- 角色与美术：**长野 NAGANO** —— *自分ツッコミくま* / *Joke Bear* / 自嘲熊。
- 插件：为 **DeepSeek Harness**（DSH）编写的 `dsh-client-ui-*` 客户端插件。
