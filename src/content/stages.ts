export const STAGES = [
  {
    id: "metro", number: "01", name: "霓虹街区", englishName: "NEON DISTRICT",
    style: "都市街头", location: "都市 · 雨夜", time: "23:48",
    description: "高架桥下的地下擂台，霓虹在雨后的柏油路上交锋。",
    detail: "霓虹反光 / 细雨 / 涂鸦街墙", accent: "#c68aff", color: 0xc68aff,
    image: "/assets/stages/metro.webp", ambience: "rain",
  },
  {
    id: "temple", number: "02", name: "朱枫古寺", englishName: "CRIMSON SHRINE",
    style: "东方古寺", location: "山间 · 初秋", time: "06:15",
    description: "晨雾掠过石庭，朱红山门前，落叶与拳风一同起舞。",
    detail: "枫叶 / 山雾 / 青石庭院", accent: "#f6b078", color: 0xf6b078,
    image: "/assets/stages/temple.webp", ambience: "leaves",
  },
  {
    id: "market", number: "03", name: "龙灯夜市", englishName: "LANTERN QUARTER",
    style: "市井夜市", location: "旧城 · 灯火", time: "20:36",
    description: "灯笼点亮老街，热气与人间烟火，围起今夜的主场。",
    detail: "流光灯笼 / 热气 / 老城石街", accent: "#ffcc78", color: 0xffcc78,
    image: "/assets/stages/market.webp", ambience: "lanterns",
  },
  {
    id: "foundry", number: "04", name: "熔炉码头", englishName: "IRON HARBOR",
    style: "工业重地", location: "港区 · 夜班", time: "02:10",
    description: "集装箱与钢铁巨构之间，炽热的火星划破港口深夜。",
    detail: "熔炉火星 / 蒸汽 / 重型钢板", accent: "#ff945e", color: 0xff945e,
    image: "/assets/stages/foundry.webp", ambience: "embers",
  },
  {
    id: "beach", number: "05", name: "落日海湾", englishName: "GOLDEN COAST",
    style: "热带海滨", location: "海岸 · 日落", time: "18:42",
    description: "椰影落在海边舞台，浪潮与落日，为这一局打着节拍。",
    detail: "海风 / 潮汐 / 落日木栈台", accent: "#7ae0d1", color: 0x7ae0d1,
    image: "/assets/stages/beach.webp", ambience: "sea",
  },
  {
    id: "colosseum", number: "06", name: "日曜斗场", englishName: "SOLAR COLOSSEUM",
    style: "古典竞技", location: "古城 · 午后", time: "16:20",
    description: "金色阳光穿过古老拱门，圆形斗场迎来新一轮较量。",
    detail: "浮尘 / 旌旗 / 古典石砌", accent: "#e4cc85", color: 0xe4cc85,
    image: "/assets/stages/colosseum.webp", ambience: "dust",
  },
] as const;

export type Stage = (typeof STAGES)[number];
export type StageId = Stage["id"];
export const DEFAULT_STAGE: StageId = "metro";

export function getStage(id: string | null | undefined): Stage {
  return STAGES.find((stage) => stage.id === id) ?? STAGES[0];
}

export function readSavedStage(): StageId {
  try {
    return getStage(localStorage.getItem("arena-lab-stage")).id;
  } catch {
    return DEFAULT_STAGE;
  }
}
