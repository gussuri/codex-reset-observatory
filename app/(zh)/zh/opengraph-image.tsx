import { renderRadarOgImage, RADAR_OG_IMAGE_SIZE } from "@/lib/radarOgImage";

export const alt = "Codex 重置观测站当前重置状态";
export const size = RADAR_OG_IMAGE_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 600;

export default function Image() {
  return renderRadarOgImage("zh");
}
