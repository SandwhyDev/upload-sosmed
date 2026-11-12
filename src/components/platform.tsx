import { Instagram, Facebook, Youtube, Linkedin } from "lucide-react";
import type { Platform } from "@/lib/domain";
const icons = {
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  linkedin: Linkedin,
};
export function PlatformIcon({
  platform,
  size = 18,
}: {
  platform: Platform;
  size?: number;
}) {
  const Icon = icons[platform];
  return <Icon size={size} aria-hidden="true" />;
}
