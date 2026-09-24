// ==========================================
// INVOICE PRINT UTILITY
// ==========================================
//
// Reliable, cross-platform print runner for both web browser and Tauri WebKitGTK.
//
// Root Cause of Previous Failures:
// 1. In WebKitGTK (Tauri on Linux), calling .print() on an iframe with 0px width/height
//    silently no-ops because zero-sized frames cannot be paginated.
// 2. Calling opener.open_path on an external browser can fail or open in the background
//    without user feedback.
//
// This utility mounts an offscreen, full-size (1024x768) iframe, writes the complete HTML,
// waits for stylesheets and DOM readiness, and triggers window.print().

export function printHtmlContent(html: string): void {
  // Remove any stale print frame from prior print invocations
  const existingFrame = document.getElementById("app-invoice-print-frame");
  if (existingFrame) {
    existingFrame.remove();
  }

  // Create an iframe with positive dimensions placed off-screen
  const iframe = document.createElement("iframe");
  iframe.id = "app-invoice-print-frame";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "0";
  iframe.style.width = "1024px";
  iframe.style.height = "768px";
  iframe.style.border = "none";
  iframe.style.zIndex = "-9999";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    console.error("Failed to access print iframe document");
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.warn("Iframe print failed, falling back to window.open:", err);
      try {
        const win = window.open("", "_blank");
        if (win) {
          win.document.open();
          win.document.write(html);
          win.document.close();
          win.focus();
          setTimeout(() => win.print(), 250);
        }
      } catch (fallbackErr) {
        console.error("Window fallback print failed:", fallbackErr);
      }
    } finally {
      // Clean up after print dialog finishes (give 60 seconds)
      setTimeout(() => {
        const frame = document.getElementById("app-invoice-print-frame");
        if (frame) frame.remove();
      }, 60000);
    }
  };

  // Wait for document to be fully parsed and rendered
  if (doc.readyState === "complete") {
    setTimeout(triggerPrint, 150);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 150);
  }
}
