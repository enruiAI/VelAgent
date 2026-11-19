# 画布电路 JSON 方案

> 状态：**已实现（阶段 1 + 2）**。目标是把「AI 能安全地搭电路、改电路、读电路」做实：
> 给元件稳定可读的名字，给出一份人和 AI 都能读写的电路 JSON，并用它做校验。
>
> 实现位置：
> - 命名 / 引脚 / JSON 转换与校验：`gaiZao/features/velagent-ui/src/integration/circuitJson.ts`、`gaiZao/features/velagent-ui/src/utils/pinNames.ts`
> - 画布命令（catalog / pins / json_get / json_apply / ref、引脚校验）：`gaiZao/features/velagent-ui/src/integration/commands.ts`
> - JSON 页签（人机共创）：`gaiZao/features/velagent-ui/src/components/editor/CircuitJsonPanel.tsx`
> - 宿主工具：`deepseek-harness/packages/client/ui-velagent/src/index.ts`
> - 正式格式（中文键）见 [canvas-bridge-contract.md](./canvas-bridge-contract.md) §4.1；本文是设计说明。
>
> 实现取舍：正式文件使用**中文键**（版本/元件/连线…），型号与参数键（`led`、`value`、`color`）沿用目录里的英文标识；
> JSON 页签与 AI 工具读写同一份文档。

## 1. 为什么现在需要它（实测发现）

2026-11-13 用真实 AI 回合（15 步 / 21 秒）在 Harness 里实测「清空画布 → 放面包板 + LED + 220Ω 电阻 + Arduino Uno →
D13→电阻→LED A、LED C→GND.1 → 校验」：

- 建板、建元件、连线、读状态、校验这些工具**都是通的**，AI 最后汇报「0 错误 0 警告」。
- 但它给电阻写的是 `pin1` / `pin2`（真实引脚名是 `1` / `2`）：
  - `connect` **只检查 owner_id 是否存在，不检查引脚名**，所以返回成功；
  - `validate` 只对 LED 的 A/C 有专门规则，电阻引脚名写错**不报错**；
  - 两端引脚定位失败后，线仍然存在但端点停在 (0,0)，视觉上像断头线。
- AI 自己在会话日志里写下结论："connect allowed arbitrary pin names (no validation)"。

结论：**AI 会画画布，但画布没有「电路」语义**。缺的不是操作能力，是：
稳定命名（ref）、引脚目录（哪些脚存在）、带网络语义的校验、可导出的结构（JSON）。

## 2. 设计原则

1. **画布是运行时的真源**，JSON 是同一份状态的投影（导出 / 导入 / 整份替换）。
   两个真源会打架：用户拖一下元件就被文件覆盖，反之亦然。
2. **三层分离**：
   - 类型目录（catalog）：某个类型有哪些引脚、参数 schema —— 系统提供，不写在电路文件里；
   - 实例（part）：ref + type + 位置 + 参数覆盖 —— 电路文件里每个元件一条；
   - 连接（wire / net）：只引用 `ref.pin`，不写内联对象。
3. **面包板的内部连通属于类型目录**（同排 a–e 的五个孔、电源轨），电路文件只写"插在第几排第几孔"。
4. 所有标识符都**面向人**：`U1.13`、`D1.A`、`B1.a1`，而不是 uuid 或内部名 `14t.a`。

## 3. 电路文件（`circuit.json`，放工作区，和 sketch.ino 并列）

```json
{
  "version": 1,
  "parts": [
    { "ref": "U1", "type": "arduino-uno", "at": [40, 120], "rotation": 0 },
    { "ref": "B1", "type": "breadboard", "at": [520, 180] },
    { "ref": "R1", "type": "resistor", "at": [560, 300], "params": { "value": 220 } },
    { "ref": "D1", "type": "led", "at": [620, 300], "params": { "color": "red" } }
  ],
  "wires": [
    { "from": "U1.13", "to": "R1.1", "color": "#e53935" },
    { "from": "R1.2", "to": "D1.A" },
    { "from": "D1.C", "to": "U1.GND.1", "color": "#111827" }
  ],
  "nets": [
    { "name": "GND", "pins": ["U1.GND.1", "D1.C"] }
  ]
}
```

`wires` 管画布上的线（颜色、走线），`nets` 管电气语义（可选，缺省时由 wires + 面包板内部连通算出）。

## 4. 类型目录（`velagent_list_components` 返回，不进电路文件）

```json
{
  "types": {
    "arduino-uno": {
      "pins": {
        "13":    { "role": "gpio", "label": "D13" },
        "GND.1": { "role": "gnd" },
        "5V":    { "role": "power", "voltage": 5 },
        "A0":    { "role": "analog" }
      }
    },
    "led": {
      "pins": { "A": { "role": "anode" }, "C": { "role": "cathode" } },
      "params": { "color": { "enum": ["red", "green", "blue"], "default": "red" } }
    },
    "resistor": {
      "pins": { "1": {}, "2": {} },
      "params": { "value": { "type": "number", "unit": "Ω", "default": 220 } }
    },
    "breadboard": {
      "pins": { "a1": { "alias": "1t.a" }, "b1": { "alias": "1t.b" }, "TP1": {} },
      "groups": [ ["a1", "b1", "c1", "d1", "e1"], ["TP1", "TP2", "TP3"] ]
    }
  }
}
```

- `params` 就是「元件的可选参数」：类型 + 枚举 + 范围 + 默认值，UI 和 AI 都按它来选，不再靠聊天约定。
- 面包板 500 个孔只需要在目录里生成，不复制到每个实例。

## 5. ref 命名

- 自动分配：`U1`（板卡）、`B1`（面包板）、`R1`（电阻）、`D1`（LED/二极管）、`S1`（按钮）、`SW1`……
- 用户可改，必须唯一、只允许字母数字下划线；画布上显示一个小徽标（R1），对话里和 JSON 里用同一个名字。
- 工具参数同时接受 `ref` 和现有 `owner_id`（uuid），老数据不破坏。

## 6. 工具 / 命令改动

1. `velagent_place_board` / `place_component` 增加 `ref` 参数（不填就自动分配），返回 `{ ref, id }`。
2. `velagent_connect` / `remove_wire` / `highlight` 的端点支持 `{ ref, pin }`。
3. 新增 `velagent_list_components`：返回类型目录（board kinds、component types、引脚、参数 schema）。
4. 新增 `velagent_export_circuit` / `velagent_import_circuit`：导入 = 一条原子 `batch`，失败整体回滚。
5. `connect` 增加 `UNKNOWN_PIN` 校验：引脚不存在时返回错误 + 该 owner 的可用引脚列表（模型可自愈）。
6. `validate` 升级：
   - 引脚必须存在（`UNKNOWN_PIN`）；
   - 面包板内部连通展开成 net（同排、电源轨），再做短路 / 悬空 / 共地判断；
   - LED 正反、串阻这些现有规则保留并改用 net；
   - 输出里带 ref，模型不用再猜 uuid。
7. `read_circuit` 输出增加 ref 字段和 `kinds` 统计；`bbwire`（插在面包板上的隐藏连线）单独标注，不和用户连线混在一起。

## 7. 分阶段

- **阶段 1（小）**：ref + catalog 工具 + `UNKNOWN_PIN` 校验 + read/connect 用 ref。
  做完后 AI 再也不会把 `pin1` 当引脚，错了立刻收到可用引脚列表。
- **阶段 2（中）**：`circuit.json` 导出 / 导入 + 工作区文件 + 画布工具栏按钮；validate 展开面包板电气连接。
- **阶段 3（可选）**：netlist 真源模式（文件改动自动导入），和"AI 改 JSON → 一键应用"。

## 8. 嵌套风险怎么处理

电路本质是**图**（一个 GND 网络可以连十几个点，还可能成环），JSON 对象本质是**树**。
用嵌套对象去存图，只有两种结果：砍掉一部分边（丢信息），或者把同一件事写两遍（双写）。
双写就是漂移和死循环的来源——这也是为什么电子 CAD 全都用「元件表 + 连接表」的网表（netlist），
而不是「元件里再套元件」。

处理规则：

1. **一律存"边"，不存"包含"**：文件只有 `parts / wires / nets` 三个平铺数组，
   引用一律是字符串 `"R1.1"`，数组里永远不出现对象套对象。文件最大深度固定为 3
   （文件 → 数组 → 元素），没有任何递归字段。
2. **唯一允许的物理层级**是"零件插在面包板上"：`seat: { "board": "B1", "hole": "a1" }`，
   深度封顶 1 层。面包板不能再插面包板；导入时校验 board 必须是 breadboard 类型。
3. **分隔符冲突**：`ref.pin` 只按**第一个点**切分。ref 正则 `^[A-Za-z]{1,2}\d{1,3}$`（不含点），
   pin 允许带点（`GND.1`），面包板孔写 `a1`。`GND` → `GND.1`、`a1` → `1t.a` 这类别名
   由类型目录解析，不进文件。
4. **结构靠校验保证，不靠自觉**。导入 = 一条原子 batch，任何一条失败整体回滚、画布保持原样：
   - version 已知；未知字段直接拒绝（`additionalProperties: false`），防止 AI 发明新嵌套；
   - ref 唯一、格式正确；type 在目录里；params 符合 schema（未知参数拒绝）；
   - 每条线两端 ref 存在、pin 在该类型目录里；禁止自环；重复连线拒绝；
   - seat 的板必须是面包板、孔必须存在；
   - 失败返回「第几条、哪个字段、为什么」，模型可自愈。
5. **单向投影 + 幂等验收**：导出永远由画布重新生成，不反向覆盖；验收标准是
   `canvas → export → import → export` 两次结果逐字节相同，且断 ref / 错 pin / 自环 /
   重复线这几类错误用例全部被拒绝。
6. 以后如果真要做「子电路 / 模块」，也用 `module: "M1"` + 全局 ref 前缀（`M1.R1`）表达，
   **仍然不嵌套对象**；层级视图（谁插在谁上面）在 UI 里按 seat + net 现算，不存盘。

## 9. 待定问题

1. ref 用类型前缀（`U1/R1/D1/B1`，推荐）还是纯字母（`A/B/C`，更短）？
2. `circuit.json` 是「导出/导入的快照」还是「工程真源文件」？
3. 面包板孔位在 JSON 里用 `a1`（行字母 + 列号，用户看的）还是 `1t.a`（内部名，程序看的）？推荐前者，后者只做别名。
4. 是否需要"多块同型号板卡"（现在 board id 首次就是 kind，第二块是 `kind-2`，可读性差）？
