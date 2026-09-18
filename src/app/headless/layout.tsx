export default function HeadlessLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <style>{`
        html,
        body {
          background: transparent !important;
          background-image: none !important;
        }

        body > .star-field,
        body > .star-field-2,
        body > .star-field-3 {
          display: none !important;
          visibility: hidden !important;
        }
      `}</style>
      {children}
    </>
  );
}
