# cpa-band

这是一个 Claude Code Mod，用来显示 CPA 中转站的用量和账号额度，以及当前会话的信息。它有四种样式，可以放在四个位置。设计参考了 [robonuggets/ribbon](https://github.com/robonuggets/ribbon)，适合使用第三方 API（CPA 中转站）登录 Claude Code 的用户。

```
CPA  1h 137次 13.78M *~$14.31   7d *~$96.75 缓存 92.0%   6s前更新
A01  5h ██████████ 100%             7d ███████░░░  69% 1d13h后重置
会话  claude-opus-5-5  上下文 204.3K/1.00M (20%)  ≈$5.3751  缓存 60m 内有效  上轮 7s  [刷新] [收起]
```

## 显示内容

- **CPA 用量**：近 1 小时的请求数、tokens 和估算费用，近 7 天的估算费用和缓存命中率。
- **账号额度**：每个账号占一行，显示 5 小时额度和周额度的剩余比例，以及距离重置的时间。
- **会话**：当前模型、上下文用量、本会话费用、缓存剩余有效时间、上一轮耗时。
- **收起**：点"收起"后，任何样式都会缩成一行紧凑显示。

## 样式

| 样式 | 说明 |
| --- | --- |
| `classic` 经典 | 用量一行，每个账号一行（5h 和 7d 并排，带额度条），会话一行。上面的示例就是这种样式。 |
| `compact` 紧凑 | 所有内容挤在一行：`CPA 1h $14.31 │ A01 5h 100% 7d 69% │ claude-opus-5-5 · 上下文 20% · 缓存 52m 内有效`。 |
| `card` 卡片 | 用量、每个账号、会话各占一张带圆角边框的卡片，并排显示，额度条是彩色色块。 |
| `gauge` 仪表 | 桌面 app 里每个账号显示两个环形仪表（5h / 7d），旁边是用量和会话信息。终端不支持 SVG，会自动改用卡片样式。 |

## 位置

| 位置 | 说明 |
| --- | --- |
| `above` 输入框上方 | 输入框上方的横条（默认）。 |
| `pane` 侧边面板 | 对话旁边的面板；面板较窄时，各部分会上下排列。 |
| `widget` 小挂件 | 桌面 app 里最小化的小窗口，只显示额度百分比和缓存倒计时。不支持挂件的界面会按侧边面板打开。 |
| `status` 状态行 | 输入框下方的一行纯文字。 |

## 切换样式和位置

有三种方式，选择会被记住，新会话也会沿用：

- **横条上的"设置"按钮**：打开后用下拉框选择样式和位置，点"完成"收起设置。
- **斜杠命令**：
  - `/cpa-band style card`：切换样式，也可以写中文，例如 `/cpa-band 样式 卡片`。
  - `/cpa-band place pane`：切换位置，例如 `/cpa-band 位置 侧边面板`。
  - `/cpa-band refresh`：立即刷新 CPA 数据。
  - `/cpa-band`：查看当前设置和全部选项。
- **`/config`**：修改 `style` 和 `placement` 的默认值。在 `/config` 改过之后，会以 `/config` 的值为准。

放在状态行时界面上没有按钮，需要用斜杠命令切换回来。

## 前提条件

- **Windows**：系统自带 Windows PowerShell 即可，Mod 通过 `powershell.exe` 查询数据。
- **CPA 配置文件**：已用 CPA 查询工具保存过 `~/.cpa/query.json`，其中包含 `base_url`、`proxy_url`（本机代理，例如 `http://127.0.0.1:7890`）和 `api_key`。
- **中转站接口**：中转站需提供 `/v1/usage` 和 `/v1/quota` 接口。

API Key 只在 `scripts/fetch.ps1` 中读取和使用，不会传给 Mod 的其他部分，也不会发送给模型。

## 安装

在终端的 Claude Code 会话中输入：

```
/plugin install cpa-band --marketplace Liumua/ClaudeCpaBand
```

出现 `Add marketplace?` 时回答 `y`，作用范围选择 **user**，然后按 Enter 确认。

也可以在 shell 中运行：

```
claude plugin install cpa-band --marketplace Liumua/ClaudeCpaBand
```

如果用的是桌面 app（不支持 `/plugin` 命令），可以这样安装：点击输入框旁边的 **+**，选择 **Plugins**，点击 **Add marketplace** 并填写 `Liumua/ClaudeCpaBand`，最后点击 **Add plugin**。

## 配置

以下选项可以在 `/config` 里修改：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `style` | classic | 默认样式：classic、compact、card、gauge。 |
| `placement` | above | 默认位置：above、pane、widget、status。 |
| `refreshSeconds` | 120 | 查询 CPA 的间隔（秒）。间隔太短，中转站会返回 429。 |
| `cacheTtlMinutes` | 60 | 提示缓存的有效期（分钟）。订阅账户是 60 分钟，API 默认是 5 分钟。 |
| `priceMultiplier` | 1 | 本会话费用的倍率，按官方标价计算。服务商打折时可以调低。 |

## 许可

MIT
