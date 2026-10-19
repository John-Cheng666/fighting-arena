import type { CSSProperties } from "react";

export type IconName =
  | "swords"
  | "play"
  | "pause"
  | "reset"
  | "sound"
  | "muted"
  | "expand"
  | "chevron"
  | "dice"
  | "settings"
  | "activity"
  | "arrow"
  | "trophy"
  | "music"
  | "claw"
  | "sun" | "moon" | "help" | "check" | "clock" | "download"
  | "search" | "document" | "users" | "close" | "pin" | "info";
const paths: Record<IconName, string> = {
  swords:
    "m5 3 14 18M19 3 5 21M3 3l6 2-4 4-2-6Zm18 0-6 2 4 4 2-6ZM3 17l4 4m14-4-4 4",
  play: "m9 5 11 7-11 7V5Z",
  pause: "M8 5v14M16 5v14",
  reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
  sound: "m11 5-6 4H2v6h3l6 4V5Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  muted: "m11 5-6 4H2v6h3l6 4V5Zm5 4 5 6m0-6-5 6",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  chevron: "m8 4 8 8-8 8",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  trophy:
    "M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v6m-4 2h8",
  music:
    "M9 18V5l11-2v13M9 8l11-2M9 18c0 2-6 3-6 0s6-3 6 0Zm11-2c0 2-6 3-6 0s6-3 6 0Z",
  claw: "m6 4 2 16M12 3l1 17M18 4l-1 15",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  moon: "M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2.5 6a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 2.5M12 17h.01",
  check: "m5 12 4 4L19 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
  download: "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5",
  document: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h5",
  users: "M9 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2",
  close: "m6 6 12 12M6 18 18 6",
  pin: "m9 3 6 0-1 6 4 4H6l4-4-1-6Zm3 10v8",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10h.01",
};

export function Icon({
  name,
  size = 18,
  className = "",
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
