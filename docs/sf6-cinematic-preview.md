# 杰米 SA3 / CA 实时 3D 样片

本轮提供独立审阅入口 `/cinematic-preview.html`。运行 `pnpm.cmd run dev` 后打开该路径；正式构建也包含此入口。`?move=CA&frame=230` 可指定动作和帧，`?autoplay=1` 自动播放，`?embed=1` 显示紧凑播放器。第三版支持 `?p1Drink=4&p2Drink=0`，默认攻击方四酒、受击方零酒，两席位可分别选择实际酒级。

本页尚未接入正式战斗。样片从命中后的双人捕获动作开始，SA3 身体动作为 438 帧，CA 为 499 帧，采样率为 60 Hz。第二版起分别追加 15 帧停格尾响，总长 453／514 帧，使原版最后一句语音自然结束。播放器使用绝对帧采样，支持暂停、慢放、逐帧、末端回拖、循环、自由观察。第三版的酒级切换同时控制原版躯干、上衣、头发和各席位配件。

`public/assets/jamie/cinematic/review.mp4` 是从本页 WebGL 画布连续录制的 30 FPS、960×540 录像，依次播放 SA3 和 CA，总长约 15.6 秒。`review-preview.mp4` 为两个关键段落拼接的 6 秒节选，`poster.jpg` 来自完整录像的一帧；均为本样片渲染结果，不是原游戏录屏。

第二版有声录像为 `review-v2.mp4`，约 16.1 秒。`review-v2-preview.mp4` 为关键镜头节选，`poster-v2.jpg` 取自第二版录像。第一版文件保留以供对比。

第三版为 `review-v3.mp4`，同样约 16.1 秒，默认 1P 四酒／2P 零酒；`review-v3-preview.mp4` 与 `poster-v3.jpg` 分别为节选及实际画面帧。前两版保留供对照。

## 第三版面部、物理与四酒

本轮重新读取安装 PAK 的 36 个精确成员，核对索引与压缩／解压散列，再用 REA 的 `open_binary`、`inspect_artifact`、`extract_artifact` 对原始资源包编目、核验并解包。37 个解包文件包含 36 个原件和清单，均与安装来源逐字节一致。证据导出于 `research/sf6-cinematic-v3/rea-recovery-forward-evidence.json`；成品来源及散列汇总于 `recovery.json`。

`FacialAnimation.ts` 使用恢复的原版 FastFacialBlendNode：210 个 CBFA 控制沿 Z 轴、倍率 100，驱动 FCE_ROM 内的原始骨骼姿势。当前头部绑定 148 个实际脸骨、3558 条非零姿势增量，覆盖眉、眼睑、嘴唇与下颌；攻击方读取原 FacialKey 控制曲线，受击方按原帧选择 FCE_SCAD 姿势。身体停格尾响期间继续采样原有攻击方面部曲线，使最后台词的嘴型自然收束。ROM 另有一个 `C_Frontalis_00` 目标，同样未出现在原头部 mesh 名称中，保留为无绑定记录。身体头颈朝向不被面部层覆盖。浏览器的四元数累积与切换属于可复现移植，尚未与运行中的原引擎逐帧对齐。

`SecondaryMotion.ts` 从三份原版 chain.52 读取 93 组、363 个节点和 23 个可绑定碰撞体，保留重力、阻尼、弹力、骨段长度、角度及衣服链约束。两人分别在固定 60 Hz 下预热并缓存 SA3／CA，再按当前帧读取，回拖不进行墙钟积分。嵌套链根跟随已解算的父骨，骨骼旋转保留原局部扭转；依据原枚举及已固定版本查看器，为 mode 4 移植椭圆角度限制，修正披发上翻。球、渐缩胶囊用于头部／身体碰撞；另两个 hash 为零的无名碰撞体保留原数据并跳过。求解器为浏览器实现，原引擎全部附着／各向异性／过滤模式和风场启动时序尚未完整恢复。六段带 fourth 命名的短 secondary MOT 与当前骨架不匹配，未强行重定向或拉伸，也没有仅凭文件名认定所属服装。

`Appearance.ts` 以原 `Style.DefaultProps` 联结 PartsContainer。0～3 酒为上衣／躯干组 20、束发组 22；真实四酒为组 21 开襟／躯干及组 23 披发。1P 腰壶为 24／26，2P 为 124／126；手持及独立道具默认隐藏。真实 Style4 的 `[1,3,4,7]` 与临时 Style5～8 的 `[1,2,4,7]` 明确区分。原模型已含四酒几何，不需要猜测形态键或另造网格。第三版另外从原 REME 材质图补烘六张开襟／披发法线图，保持原骨骼、动画及几何二进制不变。

## 第二版特效与原声

`PresentationEffects.ts` 参照项目缓存的 CAPCOM `603.mp4` 重建白金色击打光、短促冲击环、火花、烟气、随真实手足运动的拖尾，以及低饱和暖色调、暗角、轻微颗粒、画幅与小幅镜头震动。命中时刻直接来自原版数值中的捕获接触帧，位置从实际骨骼姿势采样；零伤害释放事件不产生打击闪光。粒子与拖尾全部由绝对动作帧确定，暂停和回拖不使用独立墙钟。系统要求减少动态效果时会降低闪光并关闭震动、拖尾。特效属于浏览器重建，尚未导入原引擎 VFX 图与材质。

`audio.json` 从已批准的 `src/characters/jamie/data/audio.json`、全局音频目录和原始捕获命中表生成，复用 20 个原版音效及日语个人语音素材，保留来源散列。SA3 使用捕获动作 1212／1213 的 SEKey／VoiceKey，CA 使用 1216／1217；受击喊声来自对应原接触表的语音请求。开始时的两条长 SE 是各自完整 Wwise 事件编排，其内部延迟已保留，接触 SE 表为空，因此不会额外叠加一套通用击打声。

`CinematicAudio.ts` 预解码后，在用户点击播放时等待 AudioContext 解锁，再启动画面时钟。暂停、回拖、重播、切换招式会清理旧节点；恢复播放按绝对帧重新定位当前有效声音。每个角色独立进行原请求优先级仲裁与避免重复，攻击方台词不抢占受击方语音。语音始终保持原音高和自然语速；慢放时整段 SE 随动作缩放，语音可能按新请求被提前结束，音画同步审阅以 1× 为准。

录制直接合并 WebGL 画布的视频轨与 Web Audio 同一混音总线的音轨，原版日语台词、受击声和特效均进入成片。没有添加 BGM；原引擎完整 DSP／RTPC 仍未重建。第三版补入原版面部曲线与姿势驱动。

音频清单可独立重建、核验：

```powershell
node scripts/prepare-cinematic-audio.mjs
node scripts/prepare-cinematic-audio.mjs --check
```

## 资源与来源

`public/assets/jamie/cinematic/` 包含可独立加载的 GLB、原始相机采样、面部、物理、外观与来源清单。GLB 保留现有转换产物的 8 段身体动画、878 个骨骼和 43 个网格，现嵌入 43 张颜色／透明度 PNG 与 13 张切线空间法线 PNG。两名角色共享模型资源，拥有独立骨骼、面部、物理缓存和动画时钟。旧 `secondary.json` 仅作为第一版历史保留，第三版不再套用静态发辫角度。

原版资源先前已从本机 Steam 构建 25071972 导出。本轮通过 `reverse-engineer-anything` 技能及 REA 的 `open_binary`、`inspect_artifact`、`extract_artifact` 对原始资源审计 ZIP 重新编目、核验并解包。准备脚本又按安装 PAK 的索引和精确字节区间重新读取并解压 164 个成员，核对导出文件散列；17 个 REA 解包原件也与其来源一致。没有运行游戏或修改游戏安装。

逐项来源、原始与成品散列、PAK 索引身份、转换步骤及限制位于 `manifest.json`。REA 原始工具返回另存于本机忽略的 `research/sf6-cinematic/rea-tool-results.json`；审计 ZIP SHA-256 为 `a23d082cf4373eee32cd22dc66159a734aa6a39387be6424935b0ed4ce0804c7`。

## 重新生成与校验

正常启动、构建与成品校验均不读取游戏安装目录，也不需要 REA 或 Blender：

```powershell
node scripts/prepare-sf6-cinematic.mjs --verify
node scripts/finalize-cinematic-v3.mjs --verify
node scripts/prepare-cinematic-face.mjs --verify
node scripts/prepare-cinematic-physics.mjs --verify
pnpm.cmd run typecheck
pnpm.cmd test
pnpm.cmd run build
```

只有重新生成素材时需要恢复已有研究包及原始安装：

```powershell
node scripts/prepare-sf6-cinematic.mjs --source-root <保留研究包的仓库> --rea-root <REA解包目录>
```

Node 24 以上提供原生 zstd 解压。脚本不会启动游戏，也不会全量解包或读取整个约 90 GB 的 PAK。

## 动作与镜头

SA3 使用 `esf021_SAA3_GETUGASAIHOU` 和 `esf021_SAD3_GETUGASAIHOU`，对应捕获 action 1212 / 1213。CA 使用 `esf021_CAA_GETUGASAIHOU` 和 `esf021_CAD_GETUGASAIHOU`，对应 action 1216 / 1217。身体资源为 `esf021v00_superarts_02.motlist.653`。

相机资源为 `esf021v00_superarts_02.mcamlist.22`。SA3 相机 `CAM_SAA3_GETUGASAIHOU` 为 MotionID 10，CA 相机 `CAM_CAA_GETUGASAIHOU` 为 MotionID 15。相机位置按原帧线性插值，并加上攻击方当前动画 `Root` 的世界平移；XYZW 四元数使用最短弧插值，properties.position.x 作为垂直 FOV 弧度转换。双人共用原点和外层朝向；受击骨骼已包含相对朝向，不额外旋转 180 度。

相机锚定由所选原始素材的投影与画面交叉核对得出：固定世界原点会让 CA 400 帧双头投影 X 超过 3，使用当前 Root 后回到约 0.73 / 0.03。使用相对首帧的 Root 增量也会破坏近景。原始相机数值和朝向保持不变；这项配对结果不代表已经重建原引擎所有相机锚定分支。

## 当前还原边界

- 模型、已转换的双人身体动画和相机曲线来自原版资产。导出器跳过了 336 个缺失骨骼通道，不能将保留的动画描述为原始全部通道无损。
- REME 材质重建与浏览器 PBR、灯光、地板均为预览实现。第二版增加相似的打击特效与电影后处理，尚未恢复完整原引擎渲染、原舞台或原作 VFX 图。
- 已恢复原 CBFA／ROM 面部和真实酒级外观；原作 JCNS 修形、肌肉、汗水和完整皱纹 shader 仍未恢复。链条参数及拓扑来自原件，完整原引擎物理解算器尚未复刻。
- 原酒级默认部件已恢复，全部条件化 timeline／Viscon 事件仍未完整恢复。没有将 fchar 的 `VisualSwitchKey.VisualFlag` 当作网格组号。
- 本页不包含启动演出、命中判定、捕获末尾接回战斗或 KO 分支；这些属于样片审阅后的工程接入工作。

Three.js 的加载与独立骨骼克隆使用官方 [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) 和 [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html) 接口；库固定为 0.180.0。
