import type { SVGProps } from 'react';

export type IconProps = {
  className?: string;
  size?: number;
};

function svgProps(size: number, className?: string): SVGProps<SVGSVGElement> {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    className,
  };
}

export function Undo({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3.5 7.5V4.5h3" />
      <path d="M3.5 7.5a4.5 4.5 0 1 0 1-3.2" />
    </svg>
  );
}

export function Redo({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12.5 7.5V4.5h-3" />
      <path d="M12.5 7.5a4.5 4.5 0 1 1-1-3.2" />
    </svg>
  );
}

export function Pin({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M8 1.5v7.5" />
      <path d="M5.5 9h5" />
      <path d="M6.5 9v3a1.5 1.5 0 0 0 3 0V9" />
    </svg>
  );
}

export function Info({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7v4" />
      <circle cx="8" cy="5.25" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Key({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="5.5" cy="5.5" r="2.5" />
      <path d="M7.5 7.5L14 14" />
      <path d="M10.5 10.5l1.5 1.5" />
      <path d="M12 9l1.5 1.5" />
    </svg>
  );
}

export function Dot({ className, size = 16, filled = true }: IconProps & { filled?: boolean }) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="8" cy="8" r="3.5" fill={filled ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function Doc({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5 1.5h4.5L13.5 5.5V14.5H5z" />
      <path d="M9.5 1.5V5.5H13.5" />
      <path d="M7 9h5" />
      <path d="M7 11.5h3.5" />
    </svg>
  );
}

export function Search({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

export function Chevron({
  className,
  size = 16,
  dir = 'down',
}: IconProps & { dir?: 'up' | 'down' | 'left' | 'right' }) {
  const rotate = { up: 180, down: 0, left: 90, right: -90 }[dir];
  return (
    <svg {...svgProps(size, className)} style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function Close({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4.5 4.5l7 7" />
      <path d="M11.5 4.5l-7 7" />
    </svg>
  );
}

export function Check({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3.5 8.5l3 3 6-6.5" />
    </svg>
  );
}

export function Warning({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M8 2.5L14.5 13.5H1.5z" />
      <path d="M8 6.5v3.5" />
      <circle cx="8" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Layers({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2 5.5L8 2.5l6 3" />
      <path d="M2 8.5l6 3 6-3" />
      <path d="M2 11.5l6 3 6-3" />
    </svg>
  );
}

export function Edit({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 12.5V14h1.5L12 7.5 10.5 6 4 12.5z" />
      <path d="M9.5 4.5l2 2" />
    </svg>
  );
}

export function Duplicate({ className, size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="5.5" y="5.5" width="7" height="8" rx="1" />
      <path d="M4 11V4.5A1.5 1.5 0 0 1 5.5 3H11" />
    </svg>
  );
}
