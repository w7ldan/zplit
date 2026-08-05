import { ImageResponse } from "next/og";
import { socialPreviewSize, ZplitSocialPreview } from "@/components/social/zplit-social-preview";

export const alt = "Zplit shared expense ledger preview";
export const size = socialPreviewSize;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(<ZplitSocialPreview />, { ...size });
}
