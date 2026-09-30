import { useState } from "react";
import InvoiceCreatePage from "./InvoiceCreatePage";
import { InvoiceListView } from "./components/InvoiceListView";
import { InvoiceDetailView } from "./components/InvoiceDetailView";

export default function InvoicePage() {
  const [view, setView] = useState<"list" | "detail" | "create">("list");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    null,
  );

  function openInvoice(invoiceId: string) {
    setSelectedInvoiceId(invoiceId);
    setView("detail");
  }

  function backToList() {
    setSelectedInvoiceId(null);
    setView("list");
  }

  function openCreate() {
    setSelectedInvoiceId(null);
    setView("create");
  }

  if (view === "create") {
    return (
      <InvoiceCreatePage onBack={backToList} onInvoiceCreated={openInvoice} />
    );
  }

  if (view === "detail" && selectedInvoiceId) {
    return (
      <InvoiceDetailView
        invoiceId={selectedInvoiceId}
        onBack={backToList}
      />
    );
  }

  return (
    <InvoiceListView
      onOpenInvoice={openInvoice}
      onOpenCreate={openCreate}
    />
  );
}
