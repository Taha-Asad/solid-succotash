import type { PublicCompany } from "../../../types/backend";

interface TestInvoiceHtmlOptions {
  company: PublicCompany | null;
  values: {
    invoiceDesign: string;
    designAccentColor: string;
    invoicePrefix: string;
    companyNtn: string;
    invoiceFooter: string;
    termsConditions: string;
  };
  showPreviousBalance: boolean;
  showSignatures: boolean;
}

export function generateTestInvoiceHtml({
  company,
  values,
  showPreviousBalance,
  showSignatures,
}: TestInvoiceHtmlOptions): string {
  const isThermal = values.invoiceDesign === "thermal_80mm";
  const isCompact = values.invoiceDesign === "compact_a5";
  const accent = values.designAccentColor || "#1d2b54";
  const compName = company?.name || "Corbel Trading Co.";
  const prefix = values.invoicePrefix || "INV";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice Test Print</title>
  <style>
    @page {
      size: ${isThermal ? "80mm auto" : isCompact ? "A5 portrait" : "A4 portrait"};
      margin: ${isThermal ? "2mm" : "12mm"};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ${isThermal ? "'Courier New', Courier, monospace" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"};
      font-size: ${isThermal ? "11px" : "12px"};
      color: #111827;
      background: #fff;
      padding: ${isThermal ? "4mm 2mm" : "0"};
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid ${accent};
      padding-bottom: 8px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .comp-title {
      font-size: ${isThermal ? "15px" : "20px"};
      font-weight: 800;
      color: ${accent};
    }
    .meta { font-size: 11px; color: #4b5563; }
    .inv-title { font-size: 16px; font-weight: 800; text-align: right; color: ${accent}; }
    .customer-box {
      background: #f9fafb;
      padding: 8px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      margin-bottom: 12px;
    }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th {
      background: ${isThermal ? "transparent" : accent};
      color: ${isThermal ? "#111" : "#fff"};
      border-bottom: ${isThermal ? "1px solid #000" : "none"};
      padding: 6px 8px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
    }
    td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .totals { margin-top: 10px; margin-left: auto; width: ${isThermal ? "100%" : "280px"}; }
    .totals-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
    .totals-row.grand {
      font-size: 14px;
      font-weight: 800;
      border-top: 2px solid #111;
      padding-top: 6px;
      margin-top: 4px;
      color: ${accent};
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 36px;
      padding-top: 8px;
    }
    .sig-line {
      width: 140px;
      border-top: 1px dashed #6b7280;
      text-align: center;
      font-size: 10px;
      padding-top: 4px;
      color: #374151;
    }
    .footer {
      margin-top: 20px;
      text-align: center;
      font-size: 10px;
      color: #9ca3af;
      border-top: 1px solid #e5e7eb;
      padding-top: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="comp-title">${compName}</div>
      <div class="meta">${company?.address || "Circular Road, Shah Alam, Lahore"}</div>
      <div class="meta">Phone: ${company?.phone || "+92 300 1234567"}${values.companyNtn ? " · NTN: " + values.companyNtn : ""}</div>
    </div>
    ${
      !isThermal
        ? `
    <div style="text-align: right;">
      <div class="inv-title">INVOICE</div>
      <div style="font-weight: 700; font-size: 12px;"># ${prefix}-000142</div>
      <div class="meta">Date: ${new Date().toLocaleDateString("en-PK")}</div>
    </div>`
        : ""
    }
  </div>

  ${
    isThermal
      ? `
    <div style="text-align:center; font-weight:700; margin-bottom:8px; font-size:11px;">
      INVOICE: ${prefix}-000142 · ${new Date().toLocaleDateString("en-PK")}
    </div>
  `
      : ""
  }

  <div class="customer-box">
    <div style="font-weight: 700; font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 2px;">Billed To:</div>
    <div style="font-weight: 700; font-size: 12px;">Al-Madina General Store (Chaudhry Akram)</div>
    <div style="font-size: 11px; color: #4b5563;">Badami Bagh, Lahore · Phone: 0300-9876543</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 24px;">#</th>
        <th>Description</th>
        <th class="num" style="width: 50px;">Qty</th>
        <th class="num" style="width: 80px;">Rate</th>
        <th class="num" style="width: 90px;">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>Dalda Cooking Oil 5L Can</td>
        <td class="num">10</td>
        <td class="num">2,850.00</td>
        <td class="num">28,500.00</td>
      </tr>
      <tr>
        <td>2</td>
        <td>Tapal Danedar Tea 450g Pack</td>
        <td class="num">24</td>
        <td class="num">620.00</td>
        <td class="num">14,880.00</td>
      </tr>
      <tr>
        <td>3</td>
        <td>National Super Kernel Basmati Rice 5kg</td>
        <td class="num">15</td>
        <td class="num">1,450.00</td>
        <td class="num">21,750.00</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span>Subtotal:</span><span class="num">Rs. 65,130.00</span></div>
    <div class="totals-row"><span>Trade Discount (2%):</span><span class="num">-Rs. 1,302.60</span></div>
    <div class="totals-row"><span>GST (18%):</span><span class="num">Rs. 11,488.93</span></div>
    <div class="totals-row grand"><span>Total Payable:</span><span class="num">Rs. 75,316.33</span></div>
    ${
      showPreviousBalance
        ? `
      <div class="totals-row" style="margin-top: 6px; color: #dc2626; font-weight: 700;">
        <span>Previous Balance:</span><span class="num">Rs. 18,400.00</span>
      </div>
      <div class="totals-row" style="font-weight: 800; border-top: 1px dashed #ccc; padding-top: 4px;">
        <span>Net Total Due:</span><span class="num">Rs. 93,716.33</span>
      </div>
    `
        : ""
    }
  </div>

  ${
    showSignatures
      ? `
    <div class="signatures">
      <div class="sig-line">Customer Signature</div>
      <div class="sig-line">Authorized Signature</div>
    </div>
  `
      : ""
  }

  <div class="footer">
    <div>${values.invoiceFooter || "Thank you for your business!"}</div>
    <div>${values.termsConditions || "Goods once sold can be exchanged within 7 days with original invoice."}</div>
  </div>
</body>
</html>`;
}
