import type { ReactNode } from 'react';

export default function HeadlessLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        html,
        body {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          overflow: hidden !important;
        }

        body::before,
        body::after,
        .star-field,
        .star-field-2,
        .star-field-3 {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          background: none !important;
          background-image: none !important;
        }
      `}</style>
      {children}
    </>
  );
}
