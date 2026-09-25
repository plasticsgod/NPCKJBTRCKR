// Supplement Facts Builder page. The builder is a self-contained tool served from
// /public/tools/supplement-facts.html and shown here full-height. Its projects are
// still saved as files (Save project / Open…); nothing is stored in the database.
export default function SupplementFacts() {
  return (
    <iframe
      src="/tools/supplement-facts.html"
      title="Supplement Facts Builder"
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
