# VelAgent 画布升级需求（由一次真实任务反推）

> **使用方法**：整份转发给开发 Agent 即可。文中「现象」均为真实运行记录，可直接当复现步骤。

---

## 0. 背景：这次任务是什么

Agent 需要在 VelAgent 画布上，为一个真实硬件项目搭出电路：

- 板子：Raspberry Pi Pico（代替用户的 RP2040-Zero），40 脚
- 显示：2.4 英寸 **8 位并口（8080）** TFT，16 个引脚（3V3/GND/5V + D0–D7 + WR/CS/RS/RST/RD）
- 中间：一块 830 孔面包板
- 总共 **32 段连线 / 16 条网络**，要求：全部经过面包板、线要整齐、用户能照着实物插

最终电路是成功的（validate 0 错），但过程中撞了 8 个墙，其中 3 个是阻断级的。下面是升级清单。

---

## 1. P0 · 阻断级问题

### 1.1 Agent 看不见画布（最致命）

**现象**
Agent 只能拿到元件的 `x / y` 和线的端点，看不到渲染结果。整场任务里，布局全靠猜：

- 调整了 6 轮位置，用户每次都要截图过来指出"还是不对"
- Agent 无法判断：元件是否重叠、线是否交叉、元件是否被画布裁掉
- 用户说的是"线太乱"，Agent 完全无法验证自己改完是否变好

**期望**

```js
velagent_screenshot({ maxWidth = 1200 })  // 返回 PNG（或 base64）
```

或退一步，提供结构化的布局信息：

```js
velagent_get_layout()
// {
//   viewport: {x, y, width, height, zoom},
//   parts: [{ref, x, y, w, h, rotation, bbox}],
//   wires: [{id, points: [[x,y],...], bbox, crosses: [wireId...]}]
// }
```

**验收**：Agent 一次调用后，能判断"这 16 根线里有没有重叠/交叉"，不需要用户截图。

---

### 1.2 连线无法指定拐点

**现象**
文档里一条线的全部信息就是：

```json
{"起点": "U1.GP0", "终点": "B1.a1", "颜色": "#f5a623"}
```

没有任何路径信息。13 根并行网络自动布线后，变成一大片长直线/长折线，用户反复反馈"太乱"，Agent 却**没有任何手段整理**（这是本次任务最核心的挫败点）。

用户原话：「这个线是可以拐弯的，别光弄直线，你弄直线真的很乱」。

**期望**

1. 文档 schema 支持可选折点：
   ```json
   {"起点":"U1.GP0","终点":"B1.a1","颜色":"#f5a623","路径":[[300,120],[300,420],[620,420]]}
   ```
2. 新工具：`velagent_set_wire_path(wire_id, points)` / `velagent_autoroute(scope)`
3. 自动布线提供策略参数：`straight` | `orthogonal` | `orthogonal+avoid`（避开元件包围盒）
4. 支持「总线/线束」概念：一组线自动等间距平行排布（16 根并口线最需要这个）

**验收**：能一次性给 13 根线设置相互平行、等间距、互不重叠的折线。

---

### 1.3 board（开发板）无法被移动

**现象**
```js
velagent_update_component({id:"raspberry-pi-pico", patch:{x:-700, y:120}})
// → {"ok": true}     ← 返回成功
velagent_read_circuit()
// → x: -198, y: -167  ← 坐标根本没变
```
连续复现 3 次，全部返回 `ok` 但坐标不变（component 移动是正常的，只有 board 不行）。

**后果**：Agent 只能反过来移动面包板和屏去迁就板子的位置；而板子经常是用户手动拖的，两边永远对不齐。

**期望**：board 与 component 行为一致；若确实不支持，必须显式返回 `{"ok":false,"error":"not_supported"}`，不能假装成功。

**验收**：update 后 read 的 `x/y` 真正改变。

---

### 1.4 `ref` 不稳定，两个读接口口径不一致

**现象**
`apply_circuit_json` 之后：

| 接口 | 结果 |
|---|---|
| `velagent_read_circuit()` | `boards[0].ref = null` |
| `velagent_read_circuit_json()` | `元件[0].编号 = "U1"` ✅ |
| `velagent_connect({ref:"U1"}, ...)` | ❌ `找不到板卡/元件: U1` |
| 过一阵再读 | `ref` 又变回 `"U1"` ✅ |

同一秒内三个接口对同一块板子给出三种答案。此时 `apply` 全量失败：

```
连线起点引脚不存在：raspberry-pi-pico / GP0
连线终点引脚不存在：breadboard / 25t.a
…
画布已回滚到导入前状态
```
报错里用的是**型号**（`raspberry-pi-pico`）而不是 ref，说明校验器根本没解析到元件。

**期望**
- apply 后立即赋 ref 并持久化，任何时刻读都一致
- 校验失败时只报真正有问题的项，不要因 ref 解析失败而把 60 条连线全判错
- 所有工具统一：`ref` 和 `owner_id` 等价可用

---

## 2. P1 · 严重问题

### 2.1 画布连接不稳定 + 超时语义不清

**现象**
- 用户每次切到聊天窗口发消息/截图后，dock 掉线；写操作全部返回 `canvas_not_connected`，几秒~几十秒后自己恢复
- 一次任务里掉线 ≥ 6 次，每次都要请用户"重新打开面板"
- `canvas_timeout` 后**无法确认操作是否生效**：

```js
velagent_clear()  // → {"ok":false,"error":"canvas_timeout"}
// 到底清空了没有？不知道。只能再 read 一次猜。
```

**期望**
- dock 断线自动重连，不依赖用户操作
- 超时返回 `{"status":"unknown","revision":N}`，并提供 `velagent_get_revision()` 供复核
- 写操作幂等（带 `revision` 乐观锁），重复提交安全

### 2.2 批量操作不是事务

**现象**
因 ref 失效，一次并行提交的 9 个操作变成半成品：3 个 `remove_wire` 成功、6 个 `connect` 失败，电路停在中间状态，只能整体重来。

**期望**：新增 `velagent_batch(ops[])`，全成或全回滚；或让 `apply_circuit_json` 作为唯一原子入口。

### 2.3 面包板的电气模型与实物不符（教育性错误）

**现象**
仿真里 `breadboard.pin("a1")` 与 `pin("j1")` 属于同一个 net —— **整行连通**。

但真实面包板：一行 5 孔（`a–e`）为一组，中间凹槽把 `f–j` 切成另一组，**左右互不相通**。

**后果**：Agent 按仿真模型给用户设计"左进右出"穿板方案，被用户按实物纠正，方案推翻重做。这类错误会直接教坏学习者。

**期望**
- 面包板按实物建模：`a–e` 一组、`f–j` 一组
- 提供 `参数.rowMode: "split"（默认，实物） / "full"（简化模型）`
- `网络` 输出中体现分段，`validate` 能提示"跨凹槽未桥接"

### 2.4 自动生成的 `bbwire-*` 幽灵线

**现象**
当元件与面包板包围盒重叠时，`apply_circuit_json` 会自动生成 12 根黑色导线，把元件引脚"随机"接到孔位：

```
bbwire-<componentId>-0-tp.33     ← 3V3 → 电源轨第 33 孔
bbwire-<componentId>-3-41b.f     ← D2 → 41b.f
…
```

既不是用户意图，也没有任何说明，只能逐根 `remove_wire`。

**期望**
- 改为显式 `velagent_seat(componentRef, holes[])`
- 自动行为可关闭：`参数.autoSeat = false`
- 生成的线要有可读 id 和注释

---

## 3. P2 · 体验问题

| # | 问题 | 建议 |
|---|---|---|
| 3.1 | 元件库没有 RP2040-Zero，也没有「16 脚并口 TFT 模块」 | 增加通用 **module** 元件：`参数.pins`（自定义引脚名）、`pinSide`、`pinCount`。本次只能拿 `custom-chip` + `chipJson` 硬凑，外观是个黑方块 |
| 3.2 | `seat_on` 与 `rotation` 的组合行为未文档化 | 面包板转 90° 后孔位命名是否变化？实测 pin 名不变，但文档没写 |
| 3.3 | `validate` 检查项偏少 | 可加：元件在画布可视区外、同一网络重复连线、导线数量异常、跨凹槽未桥接 |
| 3.4 | 没有撤销 / 历史 | 增加 `velagent_undo()` 与 versioned snapshot，便于 Agent 试错 |
| 3.5 | `place_board` 在已有同型号板子时静默改 ref（U1→U2） | 返回里明确提示 ref 冲突与重命名 |

---

## 4. 建议的新 API 一览

```ts
// 观察
velagent_screenshot(opts?)            // → PNG
velagent_get_layout()                 // → 包围盒 + 折线 + 交叉检测
velagent_get_revision()               // → number

// 连线精细化
velagent_set_wire_path(wireId, points)
velagent_autoroute({scope, mode, spacing})   // 线束/总线等间距

// 事务
velagent_batch(ops[])                 // 全成或全回滚
velagent_undo(steps?)

// 显式插板
velagent_seat(componentRef, holes[])
```

---

## 5. 回归验收用例

1. **16 根并口线直连场景**
   - 一次 `apply` 成功，`validate` 0 错
   - `screenshot` 中 16 根线不重叠、不压元件
   - 每条线都可由 `路径` 指定折点

2. **面包板分段**
   - `a1` 与 `e1` 同网；`a1` 与 `j1` **不同网**
   - 跨凹槽不桥接时 `validate` 给出提示

3. **断线重连**
   - 连接中断 → 自动恢复 → 再 `apply` 不产生重复元件/重复线

4. **board 移动**
   - `update_component` 移动 board 后 `read` 坐标一致；不支持则明确报错

5. **ref 一致性**
   - apply 后同一毫秒内 `read_circuit`、`read_circuit_json`、`connect` 三处对 ref 的认知一致

---

## 6. 附录：原始报错串（可直接 grep 日志）

```json
{"ok":false,"error":"canvas_not_connected","message":"No VelAgent circuit canvas is connected. Ask the user to open the VelAgent circuit panel in this app, then retry."}
{"ok":false,"error":"canvas_timeout","message":"The canvas dock did not acknowledge the operation in time."}
{"ok":false,"error":"找不到板卡/元件: U1"}
{"ok":false,"error":"找不到板卡/元件: 80a67224-8abf-4620-9023-8bef176c6e7a"}
{"ok":false,"issues":["连线起点引脚不存在：raspberry-pi-pico / GP0","连线终点引脚不存在：breadboard / 25t.a","…","画布已回滚到导入前状态"]}
```

---

## 7. 一句话总结（给排期用）

> **P0 三件事**：让 Agent 能看见画布（截图/布局信息）、让线能指定拐点、让 board 能移动 + ref 稳定。
> 这三件不做，Agent 在任何"多线束"电路上都会陷入"盲改 → 用户截图纠正 → 再盲改"的死循环，用户体验极差。
