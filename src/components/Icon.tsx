import lucideIcons from "@iconify-json/lucide/icons.json";

export type LucideIconName = keyof typeof lucideIcons.icons;

interface IconProps {
  name: LucideIconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  const entry = lucideIcons.icons[name];
  if (!entry) return null;
  const width = lucideIcons.width || 24;
  const height = lucideIcons.height || 24;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: entry.body }}
    />
  );
}
