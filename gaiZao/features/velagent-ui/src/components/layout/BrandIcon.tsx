import React from 'react';

/** VelAgent 品牌图标：芯片轮廓 + AI 星芒（内联 SVG，无外部资源）。 */
export const BrandIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4.5" y="4.5" width="15" height="15" rx="3.4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M9 2.6v2.2M15 2.6v2.2M9 19.2v2.2M15 19.2v2.2M2.6 9h2.2M2.6 15h2.2M19.2 9h2.2M19.2 15h2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 8.1l1.05 2.35L15.4 11.5l-2.35 1.05L12 14.9l-1.05-2.35L8.6 11.5l2.35-1.05L12 8.1z" fill="currentColor" />
  </svg>
);
