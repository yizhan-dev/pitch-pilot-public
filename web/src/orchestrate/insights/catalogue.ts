// The insight library's catalogue (Yi, 2026-10-23: 讲解 must go deeper than events; a large, carefully defined base
// of insights, filtered per clip, the most important made into the script). Twelve entries for this event, each a data
// standard: what the football term means, what data the detector reads, its rule and thresholds, the numbers it
// quotes, how it was validated, what it draws, and how the line may put it, in praise or as an improvement.
// Tone (Yi): never "he is bad at"; an improvement reads "如果他……，会更好". The detectors are in ./detect*.ts; this
// file is the contract they implement and the text the debug view and the storyboard show.
export type InsightId =
  | 'blind-side-run' | 'scanning' | 'body-shape' | 'foot'
  | 'half-space-run' | 'striker-wide' | 'rotation' | 'overlap' | 'third-man' | 'hook-run'
  | 'line-break' | 'one-two' | 'better-option'
  // the second batch (Yi agreed 2026-10-23, detect2.ts)
  | 'crossing' | 'onside-run' | 'second-ball' | 'one-on-one' | 'keeper-set' | 'shooter-look' | 'no-look'
  | 'no-pressure' | 'lost-marker' | 'pressed-habit' | 'one-touch' | 'pass-pair' | 'jumped-line'
  // Yi's notes on the 15:53 video (2026-10-24)
  | 'hand-up' | 'lane-swap';

export type Layer = 'pattern' | 'skeleton' | 'habit' | 'defence';

export interface Entry {
  id: InsightId;
  zh: string;
  layer: Layer;
  /** what the term means, as a coach would put it */
  definition: string;
  /** what the detector reads */
  data: string;
  /** the rule, thresholds in numbers */
  rule: string;
  /** the numbers the line may quote */
  evidence: string[];
  /** how it was checked, with the numbers; 'unvalidated' keeps it out of the narration (debug view only) */
  validation: string;
  validated: boolean;
  /** telestration kinds */
  draw: string;
  /** line templates: {n:i} a player as the HUD names him; {x} the numbers */
  tone: { praise: string; improve: string };
}

export const CATALOGUE: Entry[] = [
  {
    id: 'blind-side-run', zh: '盲侧跑位', layer: 'skeleton',
    definition: '无球跑动从防守球员视线之外开始：他回头看球的那一刻，身后的进攻球员起跑，等他再转头已经晚了。',
    data: '骨骼 25 Hz（鼻子和双耳给出脸的朝向）、跟踪 10 Hz（跑动）、球。',
    rule: '跑动（runSpan：峰值 ≥ 20 km/h，位移 ≥ 8 m）起点前 0.4 s 到 2 s 内，6 m 内最近的防守球员脸朝向离跑者 ≥ 110° 且离球 ≤ 70° 的最长连续段 ≥ 0.4 s = 真空期；之后脸转到 < 60° 的时刻 = 发现时刻。责任：真空期前 3 s 他看着跑者（≤ 45°）的时间 ≥ 40%（或他是盯人者且 ≥ 25%）算"丢了人"；他身后 2–12 m、横向 10 m 内的防守队友算补位，转头前成为跑者最近对手（≤ 3 m）算接管。',
    evidence: ['起跑时防守球员背对的角度', '他多久之后转头（真空期，s）', '转头时两人的距离（m）', '跑动峰值速度'],
    validation: '两个片段逐 0.2 s 检查过（probes/head-blindside.js）：89:22 起跑时 9 号 146–169°、0.6 s 后转头；15:53 21 号在 2 号背后 1.4 s，转头时差 4.1 m。头的朝向只能看头，看不到眼睛，所以阈值取 110° 以上。41 个片段里检测到 33 次，29 次能对上 Opta 的传球，其中 8 次 Opta 标为主动跑位。',
    validated: true,
    draw: 'run + marking（跑者和被甩开的防守球员）+ 防守球员的视野扇形（待遥测会话）',
    tone: { praise: '{n:runner} 在 {n:def} 回头看球的瞬间起跑，{dt} 秒后 {n:def} 才转头，已经落后 {gap} 米', improve: '按责任归属（Yi）：他之前一直盯着跑者才说"视线多留半秒"；身后没人补位说"队友该收一步补上"；有人补位但晚了说"补位的人早一步"；补位到位则不批评任何人' },
  },
  {
    id: 'scanning', zh: '接球前扫视', layer: 'skeleton',
    definition: '接球前把脸从球上移开去看周围（Jordet 的 scanning）：扫得多、扫得晚的球员接球后出球更快、更多向前。',
    data: '骨骼 25 Hz（脸的朝向）、球 25 Hz；全场档案 profile.json（每次接球的扫视次数，本场习惯）。',
    rule: '接球前 3 s 内，脸朝向离球 > 60° 连续 3 个样本算一次扫视，回到 < 40° 结束；记次数和最后一次结束到接球的时间。',
    evidence: ['扫视次数（3 s 内）', '最后一次扫视离接球多久', '接球后多久出球、往哪', '本场平均每次接球扫视 {x} 次（n 次接球）'],
    validation: '没有人工标注。全场 621 次接球：平均 0.55 次/次接球（0 次 59%、1 次 27%、2 次 11%、3+ 2%），最后一次扫视结束到接球中位 1.4 s；比文献的视频编码（顶级球员约每秒 0.3–0.6 次，[记忆，未核对]）少，因为这里只算脸离球 60° 以上的转头。',
    validated: true,
    draw: 'spotlight（接球人）+ 他的视野扇形（待遥测会话）',
    tone: { praise: '{n:p} 接球前 3 秒扫了 {k} 次，最后一次离接球只有 {s} 秒，所以能一脚出球', improve: '{n:p} 接球前没有回头看；如果提前扫一眼，接球后第一脚就能朝前' },
  },
  {
    id: 'body-shape', zh: '接球身体朝向', layer: 'skeleton',
    definition: '接球那一刻身体是打开的（侧身，能同时看到球和前场）还是背身（背对对方球门）；打开的身体第一脚就能朝前。',
    data: '骨骼 25 Hz（双肩连线的法向、鼻子定正面）、球（第一脚触球后 0.4 s 的位移）、跟踪（最近对手）。',
    rule: '第一脚触球时躯干朝向与本方进攻方向的夹角：≤ 90° 打开，≥ 135° 背身；第一脚触球方向 forward/side/back，长度 m；最近对手 ≤ 2 m 算受压。',
    evidence: ['躯干朝向角度', '第一脚触球往哪、多远', '最近对手距离', '本场接球打开/背身的比例'],
    validation: '一致性检查（全场 621 次接球）：身体打开的 429 次里第一脚朝前 29%，背身的 92 次里 13%，方向一致。',
    validated: true,
    draw: 'spotlight（接球人）+ 第一脚触球的球轨迹',
    tone: { praise: '{n:p} 侧身接球（{deg}°），第一脚直接朝前 {m} 米', improve: '{n:p} 背身接球（{deg}°）；如果提前侧身，第一脚就能转向前场' },
  },
  {
    id: 'foot', zh: '用脚', layer: 'habit',
    definition: '这一脚用的是哪只脚，以及他本场的左右脚比例：两脚均衡的球员在任何角度都能出球，只用一只脚的带球容易被预判。',
    data: '骨骼 25 Hz（触球前 0.2 s 摆动更快的脚）、球 25 Hz（触球时刻）；全场档案（传球、射门、带球触球各自的左右脚次数）。',
    rule: '触球前 0.2 s 两脚（踝和大脚趾）的峰值速度，快的那只是踢球脚；比值 < 1.05 弃权；球高于 1.5 m 算头球。',
    evidence: ['这一脚的脚', '本场传球 L/R 次数', '本场带球触球 L/R 次数', '本场射门 L/R'],
    validation: '对照 Opta MA3 的左右脚标注（全场档案，2026-10-23）：传球 30/35（86%），射门 26/28（93%）。带球触球没有标注，且每名球员都接近五五开（真实球员不会），所以带球的脚只进调试页，不进解说。',
    validated: true,
    draw: 'spotlight（球员）+ 脚下的标记（待遥测会话：左/右脚高亮）',
    tone: { praise: '{n:p} 本场两脚均衡：传球左脚 {l} 次、右脚 {r} 次，所以从哪个角度都能出球', improve: '{n:p} 本场 {n} 次带球触球 {k} 次用左脚；如果右脚也多用，防守会更难预判他的方向' },
  },
  {
    id: 'half-space-run', zh: '肋部前插', layer: 'pattern',
    definition: '无球跑动从边路或中路插进肋部（边后卫和中后卫之间的通道），到后卫线身后：现代进攻最常见的破防跑位。',
    data: '跟踪 10 Hz（跑动、后卫线）、球；Opta MA36 的 activeRun 作对照。',
    rule: '跑动（峰值 ≥ 20 km/h，位移 ≥ 8 m）在对方半场，终点落在肋部通道（|y| 9.16–20.16 m）且 x 超过起跑时的越位线或进入禁区深度；起点不在该通道。',
    evidence: ['从哪条通道插入', '越过了几名防守球员', '峰值速度', '是否接到球'],
    validation: '未验证（等 Yi 目视）。与 Opta MA36 activeRun 的一致性：41 个片段里检测到 9 次，其中 5 次 Opta 把跑者标为那脚传球的主动跑位（activeRun 只标接应跑位，不标掩护跑）。',
    validated: false,
    draw: 'zone（肋部通道）+ run + units（后卫线）',
    tone: { praise: '{n:p} 从{from}插进肋部，正好是边后卫和中后卫之间的缝', improve: '如果 {n:p} 早 {s} 秒起跑，就能在后卫线回收前插到身后' },
  },
  {
    id: 'striker-wide', zh: '中锋拉边', layer: 'pattern',
    definition: '中锋离开中路跑向边路或肋部，把中后卫带走，给队友腾出中路的空间（或自己在边路接球）。',
    data: '跟踪 10 Hz（中锋的位置、中后卫的位置、中路空间控制）、阵容角色（lineup / roles：Striker、F）。',
    rule: '中锋在对方半场从中路（|y| < 9.16）移到 |y| > 12 m 且移动 ≥ 8 m，4 s 内；一名中后卫跟着移动 ≥ 3 m（带走），或中路禁区弧顶区域的进攻方控制率上升 ≥ 0.15（腾出）。',
    evidence: ['拉边的距离', '被带走的中后卫及其位移', '中路控制率的变化', '随后谁进入中路'],
    validation: '未验证（等 Yi 目视）：41 个片段里检测到 3 次。',
    validated: false,
    draw: 'run（中锋）+ marking（他和被带走的中后卫）+ zone（腾出的中路）',
    tone: { praise: '{n:p} 拉到边路把 {n:cb} 带走 {m} 米，中路空出来给 {n:q}', improve: '如果 {n:p} 拉边时 {n:q} 同时插中路，这个空当就用上了' },
  },
  {
    id: 'rotation', zh: '局部轮转', layer: 'pattern',
    definition: '一侧的三名球员在几秒内互换位置（边锋内收、中场拉边、边后卫套上），让盯人的防守球员不知道该跟谁。',
    data: '跟踪 10 Hz（三名队友的位置）。',
    rule: '4 s 窗口内，同一侧 15 m 内的 3 名队友，各自移动 ≥ 5 m，且他们在宽度或深度上的排序至少换了两处。',
    evidence: ['三人各自的位移', '换了什么位置', '防守球员谁跟错了'],
    validation: '未验证（等 Yi 目视）：收紧后（两两 ≤ 12 m、各 ≥ 7 m、对方半场、换位 ≥ 3 处）41 个片段里 0 次；放松的版本每段都有，是噪声。',
    validated: false,
    draw: '三条 run（同一侧）+ marking',
    tone: { praise: '{n:a} 内收、{n:b} 拉边、{n:c} 套上，三人轮转，{n:def} 不知道该跟谁', improve: '如果 {n:c} 轮转时再快一步，{n:def} 就会被完全甩开' },
  },
  {
    id: 'overlap', zh: '套边 / 内插', layer: 'pattern',
    definition: '队友从持球人身后高速跑过他的外侧（套边）或内侧（内插），给他一个向前的出球点，或带走盯防。',
    data: '跟踪 10 Hz（跑者和持球人的相对位置、速度）。',
    rule: '持球期间，一名队友以 ≥ 20 km/h 从持球人后方（x 更小）跑到他前方，经过时离他 ≤ 8 m；在他外侧（|y| 更大）为套边，内侧为内插。',
    evidence: ['峰值速度', '跑动距离', '外侧还是内侧', '是否接到球或带走防守'],
    validation: '15:53 的 21 号套边目视确认；41 个片段里检测到 9 次，8 次能对上 Opta 的传球，其中 6 次 Opta 标为主动跑位。',
    validated: true,
    draw: 'run + spotlight（持球人）',
    tone: { praise: '{n:p} 从外侧套上，时速 {v} 公里，给 {n:c} 一个向前的选择', improve: '如果 {n:c} 这时把球给套上的 {n:p}，传中的角度会更好' },
  },
  {
    id: 'third-man', zh: '第三人跑位', layer: 'pattern',
    definition: 'A 传 B，B 一脚（或一次触球内）再给 C；C 在第一脚传球飞行时就已起跑，防守方盯着 A 和 B，没人管 C。',
    data: '球 25 Hz（触球）、跟踪 10 Hz（C 的跑动）。',
    rule: 'A→B 成功，B 在接球后 ≤ 1.5 s 传给 C（C ≠ A），C 在 A 出球到 B 接球之间起跑（≥ 15 km/h）且接球点比起跑点更靠前 ≥ 8 m。',
    evidence: ['B 的出球时间（接球后 s）', 'C 的起跑时间与第一脚传球的关系', 'C 越过的防守人数'],
    validation: '未验证（等 Yi 目视）：41 个片段里检测到 6 次；Opta activeRun 对第二脚传球没有可比的标注。',
    validated: false,
    draw: '两条 pass + run',
    tone: { praise: '{n:a} 传 {n:b}，{n:b} 一脚再给已经起跑的 {n:c}：第三人跑位', improve: '如果 {n:b} 再早一脚出球，{n:c} 就不会越位' },
  },
  {
    id: 'hook-run', zh: '鱼钩跑 / 折返', layer: 'pattern',
    definition: '无球跑动先往一个方向带两三步（要球、内收或回撤），把盯防带错方向，再急转钩向身后：鱼钩跑；转回来超过 135° 的是折返假跑（check-away）。',
    data: '跟踪 10 Hz（跑者的路径，从起跑前 2.5 s 起）、球、越位线。',
    rule: '路径的朝向用前后 0.3 s 的位移算；任意 1.5 s 窗口内朝向变化最大处为转折点；转折 ≥ 80° 且两段各 ≥ 3 m / ≥ 4 m 为鱼钩，≥ 135° 为折返；盯防被带偏 = 第一段里他最近的对手沿第一段方向移动 ≥ 1.5 m。',
    evidence: ['转折角度', '两段的长度和方向', '盯防被带偏多少', '是否接到球', '峰值速度'],
    validation: '未验证（等 Yi 目视，看图页 hook-run）。41 个片段 125 次跑动里 15 次鱼钩、5 次折返；89:22 的 32 号是最清楚的一例（158°，3.7 / 14.8 m，接到球）。',
    validated: false,
    draw: 'run（箭头沿真实路径，钩形自己会显出来）+ marking（转折时的盯防）+ spotlight',
    tone: { praise: '{n:p} 先{dir1} {leg1} 米把 {n:def} 带偏，再钩向{dir2}：鱼钩跑', improve: '如果 {n:passer} 在 {n:p} 钩回来的那一刻出球，就是身后的机会' },
  },
  {
    id: 'line-break', zh: '破线传球', layer: 'pattern',
    definition: '一脚传球越过对方的一条或几条线（后卫线、中场线、前锋线），把防守人甩在球后面。',
    data: 'Opta MA36 lineBreakingPass（权威）、跟踪 10 Hz（单位线、越过的人数、落点空间）。',
    rule: 'Opta 标注的条数和最深的线；几何只在没有标注的数据上代替。越过的防守人数：出球时在球和球门之间、到球时已在球后。',
    evidence: ['破几条线', '距离', 'Opta 预期成功率', '越过的人数', '接球时身边最近对手的距离'],
    validation: '对照 Opta：五个演示传球的几何与 Opta 一致的 3/5，所以 Opta 为准（telestration.md 3.2）。',
    validated: true,
    draw: 'units（出球时定格）+ pass + zone（落点空当）',
    tone: { praise: '{n:p} 一脚越过 B 队 {k} 条线，{n:q} 身边 {m} 米没人', improve: '如果 {n:p} 早 {s} 秒出球，{n:q} 身边的空间还有 {m2} 米' },
  },
  {
    id: 'one-two', zh: '撞墙配合', layer: 'pattern',
    definition: 'A 传 B，B 一脚回传给已经跑到防守人身后的 A。',
    data: '球 25 Hz（触球）、跟踪 10 Hz。',
    rule: 'A→B 成功，B 在 ≤ 4 s 内传回 A，A 在这期间跑动 ≥ 8 m 且接回时比出球时更靠前。',
    evidence: ['A 跑了多远、多快', 'B 的出球时间', '越过的防守人'],
    validation: '15:53 的 31 号–21 号目视确认。',
    validated: true,
    draw: '两条 pass + run',
    tone: { praise: '{n:a} 和 {n:b} 撞墙配合，{n:a} 跑了 {m} 米接回球', improve: '如果 {n:b} 一脚就回传，{n:a} 接球时还能再多 {m2} 米空间' },
  },
  {
    id: 'better-option', zh: '本可以', layer: 'pattern',
    definition: '同一时刻用同一个模型算每名不越位队友站的位置的 xG（或一脚传球的成功率和落点威胁），对比实际选择。',
    data: '防守感知 xG（xg.ts）、首触模型（outcomes.ts）、跟踪。',
    rule: '射门：队友 xG ≥ 0.15、≥ 射门人 2 倍、多 0.1；传球：实际 Opta xpass < 0.35 且备选 xG ≥ 0.12、传到 ≥ 55%。',
    evidence: ['两边的 xG', '传到的概率', '队友 2.5 s 前的 xG（是否最后一刻才到）', '盯防距离'],
    validation: 'xG 模型 CV AUC 0.808（private/response/README.md）；首触模型 85.5% 正确。',
    validated: true,
    draw: 'shot（队友的射门锥）+ marking + whatif pass',
    tone: { praise: '{n:q} 最后一秒跑到中路，那里 xG {xq}', improve: '如果 {n:p} 这时横传给 {n:q}，机会是这脚射门的 {ratio} 倍' },
  },
];

// ---- the second batch (detect2.ts). Validation numbers come from the 41-clip sweep; entries that read the skeleton
// for gaze or interpret a defender's duty start unvalidated until Yi's eye
CATALOGUE.push(
  { id: 'crossing', zh: '传中与包抄 / 倒三角', layer: 'pattern', definition: '边路传中（早传中、下底传中）或底线附近回传到点球点一带（倒三角）；好不好一半看包抄：前点、点球点、后点各有没有人，禁区里几打几。', data: '球 25 Hz、跟踪 10 Hz、Opta Cross 标签。', rule: '传中：出球 |y| ≥ 14、x ≥ 28，Opta 标 Cross 或下一触在禁区；倒三角：出球 x ≥ 42、|y| ≥ 6，落点 x 33–48、|y| ≤ 13、向后 ≥ 2 m、球不高于 1.5 m。包抄：球到时（≤ 1.5 s）在禁区、之前 2 s 有过 ≥ 15 km/h 的进攻球员，按位置分前点 / 点球点 / 后点。', evidence: ['类型', '禁区几打几', '包抄到的点', '出球时点球点一带的空位队友'], validation: '传中身份以 Opta Cross 为准，类型和包抄是直接几何。', validated: true, draw: 'pass + 至多两条包抄的 run', tone: { praise: '三人包抄，三个点都有人；倒三角找到点球点无人盯的队友', improve: '如果回敲倒三角给点球点的空位队友 / 后点再多一人包抄，会更好' } },
  { id: 'onside-run', zh: '反越位打身后', layer: 'pattern', definition: '接球人在出球那一刻贴着越位线、已经在跑，球一出就到了后卫线身后：时机。', data: '骨骼 25 Hz（规则承认的身体部位：除手臂和手外的所有关节）、跟踪、球。', rule: '出球时：越位线 = 倒数第二名防守球员（门将计入）身体最靠前的部位，或球、半场线中更深者；接球人身体最靠前的部位落后线 0–2.5 m，速度 ≥ 15 km/h；接球时超出线 ≥ 3 m。< 0.3 m 在跟踪误差内，不说"差半米"。', evidence: ['离线的距离', '出球时的速度', '接球时超出多少', '定线的人'], validation: '与遥测的越位墙同一规则；没有一次被判越位（Opta 无 OffsideGiven）。', validated: true, draw: 'offside（越位墙，跑者为焦点）+ pass + run', tone: { praise: '贴着越位线起跑，出球那一刻还差 0.6 米，球一出就冲到身后', improve: '—' } },
  { id: 'second-ball', zh: '第二落点', layer: 'pattern', definition: '解围、头球、封堵或扑救之后的散落球，谁先到；中文解说最常说的词之一。', data: '球 25 Hz、触球序列、跟踪。', rule: '解围 / 扑救 / 头球（球 ≥ 1.6 m）/ 被断之后，0.6–4.5 s 内下一次触球，球移动 ≥ 8 m；记双方离落点最近的人。', evidence: ['谁先到', '用时', '双方离落点最近的人和距离', '是否打出射门'], validation: '直接几何（触球序列已验证）。', validated: true, draw: 'zone（落点）+ spotlight（拿到的人）', tone: { praise: '第二落点先到，进攻继续', improve: '如果他提前一步卡位，第二落点就是 A 队的' } },
  { id: 'one-on-one', zh: '单刀', layer: 'pattern', definition: '持球人面前只剩门将：他和球门之间的走廊里没有外场防守球员。', data: '跟踪 10 Hz、球。', rule: '持球（接球到下一次传 / 射 / 丢）期间，x ≥ 20、离门 ≤ 35 m，走廊（起点 3 m 宽，向门口放宽到 9 m）里没有外场防守球员，持续 ≥ 0.6 s。', evidence: ['离门距离', '时长', '追防差距', '门将出击了多少'], validation: '直接几何。', validated: true, draw: 'spotlight + marking（追防）', tone: { praise: '单刀！面前只剩门将', improve: '如果早一步起脚，门将还来不及封角度（只在门将出击 ≥ 3 m 且被扑出时说）' } },
  { id: 'keeper-set', zh: '门将站定', layer: 'skeleton', definition: '射门那一刻门将是否已经站定（没有在移动、双脚着地），重心高低（蹲 / 低 / 常态 / 直立）。只描述，不说因此扑没扑到。', data: '骨骼（髋高比、离地）、跟踪。', rule: '射门前 0.3 s 内最大速度 < 4 km/h 且双脚着地 = 站定；髋高 / 站立高：< 0.85 蹲、0.85–0.92 低、0.92–0.97 常态、> 0.97 直立（遥测交接）。并入结果节拍，不单独成拍。', evidence: ['站定与否', '重心带', '离门线多远'], validation: '重心带由两场数据测得（遥测交接）；"站定"阈值是我们的。', validated: true, draw: '无（结果节拍的一句）', tone: { praise: '射门那一刻门将已经站定、重心压低', improve: '射门那一刻门将还在移动（只描述）' } },
  { id: 'hand-up', zh: '举手要球', layer: 'skeleton', definition: '无球的进攻球员举手，告诉持球的队友自己空着、要球。', data: '骨骼 25 Hz（手腕和鼻子的高度）+ 10 Hz 位置。', rule: '离球 > 3 m，5 m 内没有对手，一只手腕高过鼻子，持续 0.3–2 s（更长的像申诉）；身边越空、球随后传给他，显著度越高。', evidence: ['举手时长', '离最近的对手', '球有没有来'], validation: '15:53 目视（Yi）：Lowe 21.4–22.0 s 右手过头，离最近的对手 16.8 m，2.8 s 后长传给他。其他片段未验证。', validated: false, draw: 'spotlight', tone: { praise: '他举手要球：身边十几米没人', improve: '—' } },
  { id: 'lane-swap', zh: '交叉换位', layer: 'pattern', definition: '两名进攻球员几秒内交换通道：一个从里往外拉，一个从外往里插。往外拉的人常把盯他的人带走，给往里插的人腾出通道。', data: '10 Hz 位置 + 事件（接球人）。', rule: '4 s 内两人离中线的距离交叉，各自换了通道（往外的人落到对方起点的通道或更外，往里的反之），各自横移 ≥ 6 m，相距 ≤ 12 m，交叉在中路以外；往外拉的人身边同一名对手始终 ≤ 4.5 m 算"带走了盯人"。', evidence: ['交叉时刻', '往外、往里的横移', '有没有带走盯人', '往里插的人有没有接到球'], validation: '15:53（Yi 2026-10-24）：Reid 从半空间拉到边路（y 14→24），Lowe 从边路插进半空间（y 27→16），30.1 s 交叉，Thorsen 跟着 Reid（1.3–4.4 m）。其他片段未验证。', validated: false, draw: 'trail ×2', tone: { praise: '他往边路一拉，把盯人也带走了，给队友腾出了半空间', improve: '—' } },
  { id: 'shooter-look', zh: '射门前看门将', layer: 'skeleton', definition: '起脚前抬头看一眼门将和球门，再低头击球。', data: '骨骼 25 Hz（头的俯仰：鼻子对双耳中点；脸的朝向）。', rule: '起脚前 1.5–0.25 s 内，头的俯仰 ≥ 0°（看球时 −30° 到 −60°）且脸朝球门 40° 以内，连续 ≥ 0.2 s；头球除外。', evidence: ['抬头时长', '最后一次抬头到起脚'], validation: '未验证（等 Yi 目视）：41 段射门前的俯仰分布已看过，7:12 有 1.2 s 抬头。', validated: false, draw: 'spotlight', tone: { praise: '起脚前 0.6 秒抬头看了一眼门将的位置', improve: '—' } },
  { id: 'no-look', zh: '不看人传球', layer: 'skeleton', definition: '出脚时头抬着、脸朝别处，球却传给了另一个方向的队友；常常是之前扫视时就看到了。', data: '骨骼 25 Hz（脸的朝向、头的俯仰）、球。', rule: '出脚前 0.12 s 头抬着（俯仰 ≥ −15°），脸离传球方向 ≥ 70°；传球 ≥ 6 m 且到了队友脚下；记之前 3 s 最后一次看向接球人（≤ 30°）。', evidence: ['脸偏开的角度', '之前什么时候看到的'], validation: '未验证（等 Yi 目视）。', validated: false, draw: 'pass + spotlight', tone: { praise: '不看人传球——1.2 秒前他就看到了', improve: '—' } },
  { id: 'no-pressure', zh: '无人封堵', layer: 'defence', definition: '射门时身边没人：给了他时间和空间。按责任归属：接球时离他最近、之后没上前的那名防守球员。', data: '跟踪 10 Hz。', rule: '起脚时最近防守 ≥ 3 m；他接球时最近的防守球员若在 8 m 内且之后靠近 < 1 m，算他该上前。', evidence: ['起脚时最近距离', '接球到起脚的时间', '该上前的人靠近了多少'], validation: '直接几何。', validated: true, draw: 'spotlight', tone: { praise: '有 1.6 秒、5 米的空间从容起脚', improve: '如果他在接球时就上前封堵，这脚射门就没那么舒服' } },
  { id: 'lost-marker', zh: '漏人 / 交接失败', layer: 'defence', definition: '接球人在最后三区身边没人，而 2.5 秒前有人贴着他：盯人的放走了他，附近的队友也没接上。', data: '跟踪 10 Hz。', rule: '接球时最近对手 ≥ 3.5 m、x ≥ 17.5；2.5 s 前有防守球员与他互为最近且 ≤ 3 m；两人拉开到 4 m 的时刻，6 m 内另一名防守球员在接球前没有靠近到 3 m = 交接没接上；没有第二人 = 跟丢。', evidence: ['接球时的空间', '原来盯他的人', '交接对象和距离'], validation: '未验证（等 Yi 目视；交接是解读）。', validated: false, draw: 'marking（原来的盯人）+ spotlight', tone: { praise: '甩开了盯人，接球时身边 5 米没人', improve: '交接时没接上 / 如果多跟一步会更好（按责任归属）' } },
  { id: 'jumped-line', zh: '防线被扯开', layer: 'defence', definition: '后卫线上一人前出上抢，身后留下空当，进攻方立刻利用。上抢本身常常没错；按责任归属，该说的是相邻后卫有没有横移补上。', data: '跟踪 10 Hz（单位线）、球。', rule: '后卫线一人比其余人的线靠前 ≥ 4 m 且正在前出；3 s 内一名进攻球员（≥ 15 km/h，原来在线前）跑进或一脚传球落进他身后的空当（线后 −2 到 14 m、横向 ±7 m）；相邻后卫向空当横移 ≥ 2 m 算补上。', evidence: ['前出多少', '多快被利用', '补位的人横移了多少'], validation: '未验证（等 Yi 目视）。', validated: false, draw: 'units + zone（空当）+ spotlight（钻进去的人）', tone: { praise: '被吸出来 5 米，他立刻钻进身后的空当', improve: '如果相邻的后卫及时横移补上，这个空当就不会被利用' } },
  { id: 'pressed-habit', zh: '受压处理（本场）', layer: 'habit', definition: '本场贴身（≤ 2 m）接球后护住球的比例。', data: '全场档案（每次接球的最近对手和下一步是否成功）。', rule: '片段里他贴身接球并护住，且本场 ≥ 6 次里护住 ≥ 75% 时夸；护住 ≤ 45% 且这次丢了时给建议。', evidence: ['本场贴身接球次数和护住次数'], validation: '计数（档案的接球检测已验证）。', validated: true, draw: 'pressure（压迫圈）', tone: { praise: '又一次顶着贴身的对手护住球——本场 9 次贴身接球 8 次没丢', improve: '如果接球前先用身体卡住位置，会更好' } },
  { id: 'one-touch', zh: '一脚出球（本场）', layer: 'habit', definition: '接球后一脚就传出；本场一脚出球的比例。', data: '触球序列、全场档案。', rule: '接球到出球 ≤ 0.25 s；本场 ≥ 10 次接球里一脚出球 ≥ 30% 才讲。', evidence: ['本场一脚出球次数'], validation: '计数。', validated: true, draw: 'pass', tone: { praise: '一脚出球——本场 40 次接球 15 次是一脚处理', improve: '—' } },
  { id: 'pass-pair', zh: '连线（本场）', layer: 'habit', definition: '这一脚是本场配合最多的两个人之间的又一次传递。', data: 'passes.json（Opta 传球和推断的接球人，98.8% 找到队友）。', rule: '此前本场两人互相成功传球 ≥ 6 次，且在传球人的搭档里排前二。', evidence: ['互传次数', '排名'], validation: 'Opta 计数；接球人推断与 MA36 的 192 次可核对全部一致（遥测交接 §6）。', validated: true, draw: 'network（chemistry，以传球人为中心）', tone: { praise: '又是这一对：本场已经互传 14 次', improve: '—' } },
);

export const ENTRY: Record<InsightId, Entry> = Object.fromEntries(CATALOGUE.map((e) => [e.id, e])) as Record<InsightId, Entry>;
