// Panel Builder page (Supplement Facts today; Nutrition Facts to come). The builder
// is a self-contained tool served from /public/tools/panel-builder.html and shown
// here full-height. Projects are still saved as files (Save project / Open…).
export default function PanelBuilder() {
  return (
    <iframe
      src="/tools/panel-builder.html"
      title="Panel Builder"
      allow="clipboard-read; clipboard-write"
      style={{
        display: "block",
        width: "100%",
        // fill the space under the app header (72px) minus the page's own padding
        height: "calc(100dvh - 72px - 2 * clamp(16px, 3vw, 40px))",
        minHeight: 640,
        border: 0,
        background: "transparent",
      }}
    />
  );
}
