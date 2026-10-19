# 角色音频接入指南

本文记录杰米音频从原版资源取证、试听审阅到工程接入的流程，供后续角色复用。重点是保留可追溯的原事件、使用实际行动时钟、在碰撞确认后播放接触音，以及让项目构建独立于研究机器上的《街头霸王 6》安装目录。后续完成的170段个人语音、最新审阅覆盖和场景调度经验见 [角色个人语音接入经验](character-voice.md)。

用户已批准 v4 审阅的全部素材并授权工程接入。审阅通过表示这些声音可以使用；它不等于已经对照原游戏录音验证了全部分支、随机数、RTPC 和混音行为。

保留的原审阅 manifest 记录的是导出当时的待接入状态，不回写来改造历史；后续“全部保留并开始工程实现”的授权记录在成品 `sources.json.approval`，同时关联原审阅 manifest/HTML 的散列。

## 工程中的职责分工

音频分为三层：

1. **提取与编目**：把已经审阅的 Wwise 事件输出成浏览器可播放文件，保留源资源、事件、媒体和输出文件的散列及采样信息。
2. **角色适配**：把角色当前的原生行动、样式、分支和实际接触转成声音事件。行动声和接触声分别触发，不在播放层猜测招式行为。
3. **播放与界面**：统一管理 Web Audio 的解锁、音量、静音、BGM、暂停、重开和对象释放，不读取杰米的具体招式逻辑。

新增角色应复用播放层，在自己的模块中实现行动与接触映射。不要把原生 actionId、角色酒级或抓取逻辑放进通用播放器。

| 文件 | 用途 |
| --- | --- |
| `src/content/audio/types.ts` | 全局素材与角色音频映射类型 |
| `src/content/audio/catalog.json` | `clips`、九首场景 BGM 的各状态、通用反馈素材及各角色的语音请求/场景池 |
| `src/characters/jamie/data/audio.json` | `actions[actionId].cues`、按样式VoiceKey和 `contacts[attackId]` 的效果/语音字段 |
| `src/characters/jamie/audio.ts` | 实际行动、分支、捕获双方、接触和饮酒升级的音频适配 |
| `src/runtime/BattleRuntime.ts` | 包含 freeze 的声音时钟、预加载、设置、暂停与重开生命周期 |
| `src/view/audio/BattleAudio.ts` | 角色无关的 Web Audio 播放器 |
| `public/assets/audio/*.ogg` | 可直接部署的浏览器音频 |
| `public/assets/audio/sources.json` | v4 审阅身份、来源链、输出散列、采样验证和未确认项 |
| `scripts/sync-sf6-audio.mjs` | 从已提取研究包生成素材，或独立验证已提交的成品 |

`ActionAudioCue` 保留 `frame`、`clipId`、`kind`、`soundId`、`stopMode`、`afterBranch`、`onlyOnce`、`targetData`、`targetPos`。`ContactAudio` 按 attackId 保存原 `type/power/attr`、ExtraSE 和条件覆盖表，同时给出可播放的 normal/counter/punish/guard 引用。它们是来源数据与工程路由的边界，不应在通用播放器中用猜测填补。

普通构建和验证不需要安装原版游戏、REA、IDA、Python、wwiser 或 FFmpeg：

```powershell
npm.cmd ci
npm.cmd run verify:audio
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

只有重新生成素材时才需要还原研究包和解码工具。可通过 `SF6_AUDIO_RESEARCH` 指向 `sf6-audio` 目录、`SF6_COMBAT_RESEARCH` 指向包含 `combat-values.json` 与 `jamie-action-numerics.json` 的目录、`SF6_AUDIO_PYTHON` 指向可用的 Python 解释器，然后运行 `node scripts/sync-sf6-audio.mjs`。默认 Python 路径只是研究机器现有解释器的路径，不需要启动或自动分析 IDA。生成脚本不修改原版游戏。

此次 BGM 保留九首场景曲的七种原状态，角色清单覆盖审阅中的 `76` 个普通必杀行动。素材文件数、字节数、行动、接触表与声音键数量以 `--verify` 的实际输出和 `sources.json.coverage` 为准；这些数量不是新增角色必须匹配的目标。

## 建立可核查的源链

本次研究基线为 Steam build `25071972`。原版可执行文件 SHA-256：

```text
26095ad815bca8c58205814348315f132e74a74650c63fe1b2801c752643627c
```

杰米 `021.fchar.18` SHA-256：

```text
2e530707b0dceb86921937bcd72e3f6f89d828c7bf310f2da289e0c3bc0a354f
```

REA 用于确认已安装构建、可执行文件和资源身份，原版 PAK 与 RSZ 的解析由保留的提取脚本完成。不要把 REA 成功连接、一个反编译函数或一个文件名当作完整音频调用链的证据。普通项目源代码分析无需重新启动 REA 或 IDA；再次打开完整原版可执行文件可能触发很长的自动分析。

每个新增事件至少保留下列关联：

```text
PAK index entry / canonical resource path
  → extracted source SHA-256
  → fchar SEKey / VoiceKey / contact table
  → request UniqueID / TriggerId
  → event-list EventId / language EventId
  → Wwise Event / action / switch branch
  → BNK or PCK media entry / WEM SHA-256
  → rendered sample count / encoded file SHA-256
```

PAK 以原版路径的双 Murmur 散列查找索引，随后核对索引项的偏移、压缩大小、解压大小和解压结果。不要依赖目录扫描或仅凭两个相同的文件名就认定源数据相同。此次主 PAK 索引 SHA-256 为 `c0333667383dea138e392e5558696ebe0b6a795b153734e5c3e3a4869deffaac`，包含 `286816` 项。

原版游戏安装目录中存在松散文件覆盖的可能。本次日语语音取自原版 PAK，而非安装目录中同名的松散语音；后续角色必须保持同一原则。

### RSZ 解码时的具体陷阱

使用与资源对应的 schema，并核对每个实例的类型 CRC、字段边界、对齐填充和块结束位置。此次参考 schema 固定到 `alphazolam/RE_RSZ@871a1d5c4c7b81c60c966d73ee63f4c4413ab56e`；字段仍需与当前可执行文件的类型信息交叉核对。

- `Resource` 与 `String` 一样按带长度的 UTF-16 字符串读取；只处理 `String` 会使资源路径及后续字段整体错位。
- 当前 `CharacterAsset.SEKey`、`VoiceKey` 的 `AfterBranch` 是布尔字段。不要用过期 schema 把它解成整数，也不要凭非零值推断停止命令。
- `ESoundStopMode.NONE` 的枚举值在本构建是 `4`；`stopMode !== 0` 不能直接当作停止音频。仅在已识别的控制事件与生命周期条件下停止对应声音。
- BranchKey 的参数别名可能属于同一个 union，不代表串行数据中额外存在一份字段。
- 没有通过边界校验的类型保持未知，不补零后继续声称已经完整解析。
- 本次完整验证的是所选事件、请求、音库和媒体资源；没有据此宣称所有 `.user` 容器图都已完整解码。

源素材和中间证据位于本机忽略的 `research/sf6-audio/`。关键索引包括 `extraction.json`、`action-sound-links.json`、`trigger-links.json`、`media.json`、`decoded-audio-resources.json`，以及 `review-v4/coverage.json`。后续开发者应使用工程内的成品目录和清单运行项目；仅在重新提取时需要这些研究文件和原版游戏。

### TriggerId 不是 Wwise EventId

本次从已知事件名确认的游戏 TriggerId 算法为：

```text
MurmurHash3 x86_32(seed = 0xffffffff, UTF-16LE(exact trigger name))
```

例如 `SND_DF_DMG_NORMAL_KICK` 得到 `733362710`，然后经原版 event-list 映射到 Wwise Event `1045401635`。不要使用 UTF-8、默认零种子或 Wwise 的名称散列算法代替这一步。

请求没有直接对应的 TXTP 文件时，先检查控制事件、语言分支、随机分支及动态材质选择。它可能是 stop/state 请求，也可能是尚未展开的可播放事件。此次 SoundID `21291`、`21212` 在完整展开随机分支后恢复为可播放音频，不能把“没有生成文件”直接记成静音。

原 SoundID `999` 的 Stop_E_O 已由原 bank dump 确认作用于节点 `299379211` 与 `205895715`，淡出 `50 ms`。生成时沿 DirectParentID 祖先链确定受影响的 clipId，运行时只停止该人物对应范围中的这些声音；不能简化成停止人物所有声音。

## 以原事件制作素材

此次使用 wwiser `v20260808`、vgmstream-cli `r2117` 和 FFmpeg 生成浏览器素材。工具只用于研究与素材生成，不是项目运行依赖。

从原版音库生成 TXTP 时包含 init bank、事件库和媒体库，并保留延迟、展开需要的分支。示例中路径相对于 `research/sf6-audio/`：

```powershell
& 'C:\Program Files\IDA94\python311\python.exe' tools/wwiser.pyz `
  -d none -g -gbs -gwd -gd -go review-v4/events -gw ../../wem `
  banks/init.bnk banks/wt_skill_210103xx_es.bnk banks/wt_skill_210103xx_m.bnk
```

`-gwd` 很关键：wwiser 默认可能省略 bank 的 InitialDelay。例如本次 SPECIAL 踢击事件包含约 `16 ms` 的延迟，即 `48000 Hz` 下的 `768` 个采样；只使用底层 WEM 时会提前。保留到 TXTP/输出文件后，运行时不要再次补这段延迟。

`-gd` 可展开默认未生成的重复或随机节点。每次更换 wwiser 版本先查看它的帮助与生成结果，核对实际覆盖范围。`-gf` 过滤参数会接收后续参数列表，避免把音库路径误吞进过滤列表。

使用 vgmstream 同一组配置读取元信息并渲染，核对事件的 `playSamples`，不能只看源媒体的 `numberOfSamples`。源媒体长度可能与事件的 trim、delay、padding 和循环后实际播放长度不同。

```powershell
tools/vgmstream/vgmstream-cli.exe -i -m -I path/to/event.txtp
tools/vgmstream/vgmstream-cli.exe -i -W 4 -D 2 -o path/to/event.wav path/to/event.txtp
```

输出整段原事件，保留完整尾响。允许为避免削波统一降低增益；不要固定截到某个秒数、用边界淡出来隐藏截断，或把短文件拉伸到游戏招式时长。先保留事件的真实长度，再找出声音为什么在错误的时刻触发。

编码后将 Ogg 解码为原始 PCM，按字节数计算采样帧数，与渲染 WAV 的实际帧数比较：

```text
decodedFrames = pcmBytes / (channelCount × bytesPerSample)
seconds = decodedFrames / sampleRate
```

不要用 FFmpeg 的进度 `out_time_us` 证明采样长度精确一致；容器时间戳和编码延迟可能造成毫秒级差异。每次重新编码后的文件散列也可能因 Ogg serial 改变，已批准的文件应按字节保留，不能只比较听感或文件名。

如果后续确认旧审阅导出漏了原版 bank 延迟，应保留旧审阅及其来源身份，在新成品中明确记录修复差异。本次日语轻受伤 Event `2453329291` 恢复了旧 TXTP 漏掉的 `50 ms` InitialDelay（`2400` 个 `48000 Hz` 采样），保持相同随机样本，在来源清单记录 `restoredBankInitialDelaySeconds` 与 `approvedSourceVariant`；它没有做声音拉伸。BGM 和无需修正的已批准文件复用原字节。

### 审阅预混音与游戏素材的区别

审阅页的“完整动作＋全部命中”用于比较，含有明确假设，例如每个独立 HitID 在最早窗口命中，以及之后累计先前的攻击方 hitstop。它不能直接替代工程中的逐事件调度。

运行时使用原事件片段，并由真实行动发出动作声、真实碰撞发出接触声。这样打空、防御、迟命中、被打断、手动派生和空中落地都不会仍然播放整套假设命中的声音。重复判定框共享一个 HitID 时也只应产生一次实际接触。

## 把原帧映射到本项目的实际时钟

项目使用固定 `60 Hz` 战斗步进。`Battle.state.tick`、行动帧、超必杀演出前段和捕获序列不是同一个时钟。不要用 `setTimeout` 预排整招，也不要从渲染姿势、百分比进度或视频时长反推声音帧。

| 区间 | 工程状态 | 接音频时必须处理的区别 |
| --- | --- | --- |
| 行动开始 | `requestJamieMove` 创建 `frame = 0`、`introFrame = 0` | 初始化本次行动的去重状态；零帧事件有明确入口 |
| 普通行动 | `action.frame = state.tick - action.startTick` | 原 fchar SEKey 使用零起帧；本项目普通碰撞/资源事件通常已经加一 |
| 超必杀 intro | `advanceJamieFreeze` 递增 `introFrame` | `Battle.step` 此时不增加 `state.tick`，仍要推进行动自己的声音键 |
| intro 后续 | `action.frame + introDuration` | 接续同一原行动，避免重新播放 intro 中已发出的声音键 |
| 确认捕获 | `beginJamieCapture` 记录 `confirmedAtFrame` | 换到捕获 actionId，新的捕获局部时钟从零开始 |
| 捕获演出 | `action.frame - confirmedAtFrame` | `nativeCapture.hits.from` 保留原帧，不能再次套普通行动的加一规则 |

`scripts/sync-jamie-numerics.mjs` 对普通 `eventsByStyle.from` 明确执行 `原 from + 1`，而捕获数据保留 `from/to`。声音 JSON 保留原生帧时，应在一个适配函数中统一转换，而不是在每个招式里零散加减一。零帧应单独测试，尤其是行动开始、super intro 首帧和捕获首帧；不要在创建行动及首个 step 各播放一次。

此次接入采用：普通行动 `rawFrame = max(0, action.frame + introDuration - 1)`，冻结 intro `rawFrame = max(0, introFrame - 1)`，捕获 `rawFrame = action.frame - confirmedAtFrame`。创建行动与进入捕获分支时派发零帧键，再由该实例的去重状态避免首个 step 重复。intro 的最后一个 raw 帧到普通行动第一帧保持连续。

**创建带 intro 的行动时也必须使用 intro 时钟。** 本次 runtime 测试曾发现创建入口直接使用普通公式，一开始就把完整 `introDuration` 加入 raw 帧，导致 SA1/SA2 的多段开场声音挤到首个 tick，之后 freeze 时游标反而无法再推进。修复后创建入口从 `introFrame = 0` 派发，再随真实 freeze 步进运行；测试同时断言“相同 combat tick 下，声音分布在不同 presentation tick”。只验证最终事件总数会漏掉这种错误。

另有仅供声音调度的 runtime `audioTick`：每个真正执行的 `battle.step()` 都推进一次，包括不增加 `state.tick` 的 super freeze。播放器接收的声音事件使用这个时钟；战斗日志继续保留 `state.tick`。否则 SA1 的 55 帧和 SA2 的 124 帧 intro 会在播放器看来全部发生于同一 tick。暂停期间不执行战斗步，声音时钟也不会凭墙钟增加。

`BattleRuntime.advance()` 收集一次渲染调用内每个战斗步的声音事件，先投影到各自的 `audioTick`，再批量交给播放器。不要先把所有事件都改成这一批的最后一帧，否则低帧率或 `4×` 模式下的声音会挤在一起。预加载期间不推进战斗，也不积攒待补的模拟时间；旧预加载完成回调还需通过 generation 检查，避免静音或重开后解除新一轮加载状态。

使用该行动开始时保存的 `nativeStyleAtStart` 选择样式，不能在饮酒或 SA2 改变当前状态后把此前行动的样式悄悄替换。一次声音键应按“行动实例＋分支实例＋键索引”去重，不能仅按 SoundID 去重：同一个 SoundID 可能在同一招中被有意触发数次。

当前杰米已支持的音频以基础行动加显式酒级分支组织。另一个角色若在不同 style 中复用同一个 actionId、但声音键不同，需将映射扩展为 `styleId + actionId` 并执行正确的样式继承；不要用第一个匹配行动覆盖其他样式。先比较所选行动各样式的完整键列表，再决定是否可以共用素材与时序。

当前宿主的 `hitStopOwner`、`hitStopTarget` 是战斗数据，尚不意味着它们已经使实际角色行动时钟逐帧停止。音频跟随宿主当前真正推进的时钟，不能再把审阅预混音的假设 hitstop 加一遍。以后实现真实 hitstop 时，只冻结后续事件触发；已经开始的声音维持正常采样速率与尾响，不拉伸声音。

### 杰米需要显式处理的分支

| 家族 | 关键 actionId | 工程接入注意 |
| --- | --- | --- |
| S01 饮酒 | `1010` 起手、`1011` 循环、`1012` 松开、`1013` 升至 Lv4、`1014–1016` 满级变体 | 由真实 hold、release、已完成饮酒数与起始酒级驱动；循环重新建立局部时钟，松开不清掉已经完成的饮酒 |
| S02 流酔拳 | `900–914` 与 Lv4 `934–943` 的选定行动 | 一、二、三段分别对应实际输入请求，不能一开始播放整套三段；同强度不同酒级可有不同起手和追加声 |
| S03 流酔脚 | `917–930`，Lv4 第三段 `919/923/927/931` | 与 S02 共享起手，后续踢击和饮酒收尾分别切行动 |
| S04 酔疾歩 | `951–954` | 轻中重 OD 分开，动作 SE 与确认接触的掌击 ExtraSE 分开 |
| S05 昇踢 | `974–977`，非命中后续 `973` | 后续多踢不能在打空时无条件播放；轻版进入 `973` 的零帧，其余强度从 `15` 帧进入，不能重播入口之前的键 |
| S06 无影蹴 | `962–965`，落地 `966–969` | 接触时刻和落地由实际空中轨迹决定；不能把固定秒数的落地声拼在俯冲后面 |
| S07 爆廻 | `999–1002` | 4/6/7/10 个独立接触，按实际命中逐次发声，不直接播放全中预混音 |
| S08 点辰 | 起手 `981/982`、OD `989/990`；成功 `985/993`；被捕获方 `986/994` | 原生起手有随机代表行动；成功才切捕获，同时保留对手声音层；打空起手的后段不能与成功捕获叠播 |
| S09 疾歩仙掌 | `957/958` | 按真实派生请求触发，普通和 OD 保留，ExtraSE 只随确认接触 |

这张表用于解释本次取证结构；具体强度、酒级、控制标志与声音键以工程内的角色音频 JSON 为准。未知的原生条件位仍应标注为宿主适配，不能把表中的代表分支称作已经对照原版 runtime 验证。

### Super intro 与捕获序列

- **SA1**：原 action `1200` 的声音键包含 `55` 帧 intro。不能把它与去掉 freeze 后的 active 帧直接相减，或用 outerFrameCount 当整招时长。
- **SA1 饮酒收尾**：原 `1200` 在 raw `119` 可转 `1201`，满级分支为 `1202`；两者动作声的主要键为局部 `10/25/50` 帧。当前 `row-87-drink` 的 native override 已将时长改为 `202`、饮酒帧改为 `177`，不是构造初期的 `240`。对应宿主行动帧 `65` 切声音分支，后续局部帧为 `action.frame - 65`；原资源帧 `111` 经加一落在宿主 `177`，不要继续叠播 `1200` 的普通 SA1 后半段。
- **SA2**：action `1205` 有 `124` 帧 intro，之后仍有本地行动段。演出期间的声音、资源事件和临时酒级必须使用同一实际 intro 进度；不要只在 `state.tick` 增长时检查。
- **SA3 / CA**：起手 action 分别为 `1211/1215`，各有 `84` 帧 intro。成功捕获后切到 `1212/1216`，捕获局部帧来自 `action.frame - confirmedAtFrame`。
- **SA3**：本项目捕获时长 `448`、release `439`、world stop `438` 帧。
- **CA**：本项目捕获时长 `554`、release `532`、world stop `499` 帧。

这些捕获值来自当前保留的 native numerics。姿势演出的 `cinematicTimeScale` 只适配画面，不能用来缩放原声音时间。`isWorldStopped` 在此宿主中不等于停止声音或停止来源角色的捕获行动时钟；不得因此暂停整个 AudioContext。

普通前投饮酒收尾也是独立行动：原 `720` 在捕获局部 raw `80` 可转 `728`，其主要声音为局部 `10` 帧 SoundID `21163` 与 `28` 帧 `21164`，不是重新播放 `1010` 的举壶声。捕获释放帧 `73` 早于这次分支，不能把 `captureTargetId` 清除误当作整个攻击方行动结束；仍需保留这次确认的 `confirmedAtFrame`。项目现在在该分支帧检查实际有效酒级：普通前投命中且未满4酒时自动切到 `row-91-drink`，保留原命中时钟、伤害和PC元数据；空投、拆投、普通后投与有效4酒均不自动喝酒，SA2临时4酒也算满级。

分支时间统一由 `JAMIE_THROW_DRINK` 提供：局部 `50` 帧执行一次饮酒，`56` 帧结束可操作段，声音轨同步切到 `728`，因此局部 `46` 帧的收尾语音也能播放。不能继续使用捕获动作原来的 `120` 帧总长，或在饮酒分支开始前就把动作设为喝酒姿势；那会截断收尾，或在仍抓住对手时提前举壶。受击中断发生在饮酒帧之前时，不增加酒级。自动选择分支是用户指定的项目行为；对PC继承和原版按键条件仍采用宿主适配，未声称运行验证了原版条件解释器。

投后必须通过引擎公共普通投结算保留推开距离，否则捕获释放后仍相距53，会在喝酒前被起身轻拳命中。当前前投170、后投240竞技场单位，后投换位由公共层处理一次。几何约束、后续角色契约和原版位移/受身证据边界见[普通投实现说明](normal-throws.md)。

### 接触声的条件

动作键属于攻击方行动；接触声属于碰撞解析结果。应该在通用伤害结果和角色接触上下文均已确定时读取 attackId、hit/block/parry、counter/punish、armor 和额外 SE。

本次所选普通必杀多为 `Type = PUNCH(2)` 或 `KICK(3)`、`Power = SPECIAL(4)`、`Attr = 0`。序列化的强度 switch 中 `DmgLevel.Special(3)` 对应值 `1137669552`；原 `Power` 枚举数值与 switch level 数值不同，不能直接把 `4` 当成 switch 值使用。普通拳脚、最终击、防御及 counter 分支应按各自表映射。

不要对这些情况重复发通用冲击：仅作为抓取闩锁的零伤害命中、释放 metadata、deferred KO、另一系统已经负责的 parry/armor 反馈。也不能用是否扣血替代所有接触判断：防御、成功无伤捕获和 ExtraSE 仍可能有声音。

## BGM 与播放生命周期

本项目的低血切换要求为：**任意一方当前生命不高于最大生命的 25%**，不是只检查玩家，也不是只在最后一回合检查。此阈值是本次用户明确要求；原版游戏中具体比较器、渐变曲线与量化切换逻辑尚未由 runtime 录音验证。

每个场景音乐按清单提供的普通回合与 danger 分支选择。`on_dj` 是本次保留的低血候选链；World Tour 的 Master assist 音库不是低血证据。循环段使用清单实际 loop 信息，不截取开头若干秒伪造无限背景音乐。

通用播放器位于 `src/view/audio/BattleAudio.ts`，类型位于同目录 `types.ts`。主要 API：

| API | 调用责任 |
| --- | --- |
| `setEnabled(boolean)` | 在用户手势回调中直接调用，创建/恢复 AudioContext；关闭时使旧请求失效 |
| `configure(partialSettings)` | 配置 master/music/effects/voice 音量、语音开关、场景/杰米音乐模式及 stageId |
| `warmup(clipIds?)` | 预解码音效与所选音乐，默认并发六路；runtime 在开始战斗步进前等待 |
| `consume(events, fighters?, { tick, speed })` | 消费实际 `audio`、`audio-stop` 事件，使用包含 freeze 的声音时钟 |
| `updateMusic({ phase, fighters })` | 依据阶段和双方血量维护 normal/danger/intro/outro |
| `pause()` / `resume()` | 挂起/恢复同一 AudioContext，保留已开始的尾响与循环位置 |
| `reset()` / `restart()` | 丢弃本轮声音与待处理请求，复用已解码缓存 |
| `getStatus()` | 获取 off/unsupported/blocked/paused/ready、加载数与失败数 |
| `dispose()` | 终止请求、源节点和 AudioContext，释放资源 |

播放器使用 master/music/sfx/voice 四条 gain 总线。`audio-stop` 可按 fighter、scope、clipIds 定位，并支持 `loopsOnly` 与 `fadeMs`。普通行动结束只清理需停止的循环，有限事件允许尾响结束；明确的原生 stop 则可精确停止指定事件。声音加载晚于计划时刻 `150 ms` 会丢弃该次声音，不在画面之后补播。BGM 使用秒制 loopStart/loopEnd，切换时交叉淡化 `180 ms`；血量双方都回到阈值以上时恢复普通音乐。准备阶段可播 Intro；开始对战时若 Intro 尚未结束，淡出并立即进入常态，不能让战斗等待二十秒的完整素材。如果常态循环已经自然开始，则保持当前位置续播。这些是本项目播放策略，不是对原版 Wwise 转场参数的断言。

页面通过 `BattleRuntime.toggleSound()` 解锁/关闭音频，通过 `setAudioSettings()` 更新音量、语音和音乐模式，通过 `setAudioStage()` 同步场景。设置经过范围校验后保存在可选的 `arena-lab-audio` 本地存储中；浏览器禁用存储时仍可使用当前会话内的设置。语音默认关闭，避免将两段已批准的代表语音误作全角色完整语音组。

浏览器播放层应满足这些生命周期约束，后续角色也应沿用同一处理：

- 由用户手势创建或恢复 AudioContext；首个尚未解锁的声音不能产生未处理的 promise rejection。
- 素材下载与 decode 缓存以 clipId/URL 为键，下载失败不会卡住战斗步进。
- 重开、换演示、换场景、销毁与新的 BGM 选择使旧异步请求失效；解码刚返回时再次核对 session/epoch，避免旧对局突然响起。
- 每个行动实例与声音实例有独立身份；分支或取消可停止需要终止的持续声，已经允许结束的尾响不因其他角色行动被误杀。
- 静音、BGM 音量、音效音量通过分开的 gain 控制，不改变命中事件和游戏随机数。
- 暂停与页面离开按统一 runtime 生命周期管理；恢复不得补播暂停期间根本未发生的行动声，也不得叠加旧 BGM。
- 慢速模式需要明确声音策略。音频采样本身保持原速时，只有实际战斗触发间隔随步进改变，不能声称音频也做了无变调时间伸缩。
- 所有 AudioBufferSourceNode 只启动一次，结束或销毁后断开节点，并移除事件监听。

### React StrictMode 与 runtime 的所有权

本次真实 Chrome 验证发现一个单独测试播放器无法发现的问题：`App` 用 `useState` 持有同一个 `BattleRuntime`，但原 `useEffect` cleanup 直接调用 `runtime.dispose()`。React StrictMode 在开发模式会演练 effect 的 cleanup/setup，却保留这份 state，结果同一个 runtime 在用户第一次开声音之前已被永久销毁，后续 `setEnabled()` 不再创建 AudioContext，界面操作正常却一直静音。

当前 `src/app/App.tsx` 用所有权 ref 和延后的检查，仅在真正卸载或替换 runtime 后释放它：

```tsx
const runtimeOwner = useRef<BattleRuntime | null>(null);
useEffect(() => {
  runtimeOwner.current = runtime;
  return () => {
    runtimeOwner.current = null;
    queueMicrotask(() => {
      if (runtimeOwner.current !== runtime) runtime.dispose();
    });
  };
}, [runtime]);
```

同一个 runtime 的下一次 effect setup 会先恢复 ref，因此模拟 cleanup 不会销毁它；真正卸载时 ref 保持空，替换时 ref 指向新实例，旧实例才会被释放。这个处理依赖此处明确的 runtime 所有权，不应将所有 cleanup 一律延后。新增角色或重构 React 容器时，须在真实启用 StrictMode 的页面检查首次解锁、实际非零声音输出和卸载释放，而不只检查按钮状态或 mock 的 `resume()` 调用。

## 为另一个角色实施

1. 固定该角色对应构建、原版 fchar、请求表、事件表、bank/pck 和语音语言。先记录身份和散列，再做解码。
2. 枚举全部官方动作和项目实际支持的 variant：轻中重、OD、等级/姿态、手动派生、成功/未中、空中/落地、捕获双方、Super/CA。产出覆盖表，空白项写明原因。
3. 逐行动提取 SEKey/VoiceKey，逐 attackId 提取 contact/ExtraSE；保存 raw 帧、onlyOnce、stopMode、afterBranch 和未解析控制请求，不丢字段。
4. 追踪 request → trigger → event → branch → media。需要的随机或 switch 分支分别生成；仅凭名字相似不复用另一角色的文件。
5. 生成完整原事件，验证采样数、散列、循环和延迟。先审阅独立动作声，再提供明确标注条件的组合试听。
6. 在角色适配器中定义普通、intro、capture、loop 和 landing 时钟，建立行动实例及分支实例的去重范围。在实际触发点发事件，不让播放器推断战斗行为。
7. 依真实接触选择声音，并验证打空、格挡、无伤抓取、多段、同 HitID 多框、armor、parry、counter/punish、取消和 KO。
8. 把成品音频、角色映射、来源清单和验证脚本放入项目；生产构建不可读取本机安装路径、研究文件或外部 Python/FFmpeg。
9. 用真实浏览器验证首次解锁、暂停/恢复、慢放、静音、后台、快速换场景、重开和销毁。自动测试无法替代最后的听感核对。

## 验证与证据边界

最低验证集包含：所有引用素材都存在且可解码、输出散列与清单一致、采样计数一致、所有支持 variant 有行动映射、同一键只触发一次、两个角色互不去重、分支不漏零帧、打空没有假命中、intro 有声音、捕获时钟不混用、低血边界覆盖双方，以及已作废的异步解码不会播放。

播放器回归测试位于 `src/view/audio/BattleAudio.test.ts`，可用 `npm exec -- vitest run src/view/audio/BattleAudio.test.ts` 单独执行。它覆盖解锁、BASE_URL、1×/4× 事件间隔、缓存去重、尾响与局部停止、未完成 decode 时的 stop 淡出、语音开关、reset/mute/dispose 竞态、失败与过期素材、暂停恢复、无可用 AudioContext、低血边界与 BGM 快速切回。不可取消的 `decodeAudioData` 通过 abort 竞态释放旧 warmup 等待；原生 decode 即使稍后完成，也不会写回失效缓存或启动声音。

另外两组关键测试分别位于 `src/runtime/BattleRuntime.audio.test.ts` 与 `src/characters/jamie/__tests__/audio.test.ts`：前者验证真实战斗步、freeze 声音时钟、批量调度与预加载生命周期，后者验证杰米动作、接触和条件分支。后续角色要新增自己的角色适配测试，同时保留通用播放器和 runtime 的回归。

BGM／音效阶段验证记录（个人语音扩展前）：

| 检查 | 结果与范围 |
| --- | --- |
| `npm test` | 全量 `401` 项通过，含播放器、runtime、角色音频及既有战斗回归 |
| `npm run build` | 类型检查及生产构建通过 |
| `npm run verify:audio` | `260` 个 Ogg、`37,091,207` 字节的清单、引用、散列与元信息校验通过，无原版安装或研究目录依赖 |
| 真实 Chrome / Web Audio / 页面 | `14` 项检查通过；抽样实际 PCM 非零，已观察源的 playbackRate 均为 `1`，循环使用原采样边界；开始对战及时离开长 Intro、首次解锁、暂停、静音、重开和移动端无溢出通过，控制台错误与音频请求失败均为 `0` |

本机浏览器验证记录保留在 `research/sf6-audio/runtime-browser/verification.json`。它验证的是本项目实际页面和 Web Audio 链路，不是原版 SF6 的 runtime 对照录音，也不代表对全部素材逐条完成了人工听感比较。新角色仍需重跑其动作与条件分支，并做实际浏览器试听。

另一个回归经验是冻结期去重：不能在整个待消费事件队列中用 combat tick + clipId 去重。SA1 intro 的原生第15、32、54帧会三次使用同一足迹事件，但 combat tick 均为0；全队列去重会因 `takeEvents()` 调用频率不同而漏声。只折叠同一行动、同一原生帧的事件别名，并用行动实例的游标记录已派发键。回归已验证“逐帧取事件”与“冻结结束后一次取出”产生相同声音序列。

本次素材身份与静态事件链、已审阅声音，以及宿主内的触发测试构成不同证据。没有原版 runtime 对照录音时，不宣称完全复现 Wwise 的随机数、RTPC、音量曲线、空间定位、材质射线选择、插件处理和所有 branch 条件。新的运行观察应补入来源清单或测试，保留“已确认”“宿主适配”“未确认”的区别。

当前成品还保留这些明确边界：材质与服装采用代表性的 `Sneakers + stone` 和 `costume 0`；未确认独立 punish 音时使用已支持的 counter 分支；`Type.AUTO` 不猜成拳或脚。本次此前未映射的通用脚步、衣物和落地请求已通过原始 typed trigger 表补齐，追加链在 `sources.json.supplementalRequestMappings`，已选范围的 `unresolved` 为空；未来新角色遇到未解析项时仍应列在该字段，不能合成冒充原版声音。随后个人语音审阅保留170段、排除18段，工程已用按样式的VoiceKey和原生接触Voice字段替换轻攻击/轻受伤占位。最新拒绝覆盖旧的轻攻击样本保留意见；来源、独立随机数、优先级和开场/胜利规则见个人语音指南，语音仍由独立开关控制。

