import { renderRadarOgImage, RADAR_OG_IMAGE_SIZE } from "@/lib/radarOgImage";

export const alt = "Codex Reset Observatory current reset status";
export const size = RADAR_OG_IMAGE_SIZE;
export const contentType = "image/png";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 600;

export default function Image() {
  return renderRadarOgImage("en");
}
