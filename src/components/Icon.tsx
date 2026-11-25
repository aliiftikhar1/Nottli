import type { LucideIcon } from 'lucide-react';

type IconProps = { icon: LucideIcon; size?: number; strokeWidth?: number };

export function Icon({ icon: IconComponent, size = 18, strokeWidth = 1.8 }: IconProps) {
  return <IconComponent aria-hidden="true" size={size} strokeWidth={strokeWidth} />;
}
