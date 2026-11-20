/** The app's calendar mark (also the basis of the PWA icon in Phase 3). */
export function AppMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="mc-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f4fd1" />
          <stop offset="1" stopColor="#0b1f3a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#mc-g)" />
      <rect x="14" y="17" width="36" height="32" rx="6" fill="#fff" opacity="0.96" />
      <rect x="14" y="17" width="36" height="9" rx="4" fill="#cfdcff" />
      <rect x="21" y="12" width="4" height="9" rx="2" fill="#fff" />
      <rect x="39" y="12" width="4" height="9" rx="2" fill="#fff" />
      <circle cx="24" cy="33" r="2.4" fill="#1f4fd1" />
      <circle cx="32" cy="33" r="2.4" fill="#93acf0" />
      <circle cx="40" cy="33" r="2.4" fill="#93acf0" />
      <circle cx="24" cy="41" r="2.4" fill="#93acf0" />
      <circle cx="32" cy="41" r="2.4" fill="#0b1f3a" />
    </svg>
  );
}
