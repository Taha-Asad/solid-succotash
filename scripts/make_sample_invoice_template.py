#!/usr/bin/env python3
# Generates src/assets/sample-invoice-template.xlsx — an invoice layout
# matching the Ijaz & Company theme (deep navy #1D2B54 + antique gold #C9952A).
# Uses {{placeholder}} tokens that the app's fill engine recognises.

import zipfile
import os

OUT = "src/assets/sample-invoice-template.xlsx"

# ---------------------------------------------------------------- strings
ss = []
def s(v):
    ss.append(v)
    return len(ss) - 1

C = {}  # ref -> (style, shared_idx)
def put(ref, val, style):
    if isinstance(val, int):
        C[ref] = (style, None, val)
    else:
        C[ref] = (style, s(val), None)

MERGE = []

# Header band (navy)
put("A1", "{{company_name}}", 1); put("B1", "{{company_name}}", 1); put("C1", "{{company_name}}", 1)
put("D1", "{{company_name}}", 1); put("E1", "{{company_name}}", 1); put("F1", "{{company_name}}", 1)
put("A2", "{{company_tagline}}", 2); put("B2", "{{company_tagline}}", 2); put("C2", "{{company_tagline}}", 2)
put("D2", "{{company_tagline}}", 2); put("E2", "{{company_tagline}}", 2); put("F2", "{{company_tagline}}", 2)
MERGE += ["A1:F1", "A2:F2"]

# Title row
put("A4", "INVOICE", 3); put("B4", "INVOICE", 3)
put("C4", "Invoice #:  {{invoice_number}}", 0)
put("D4", "Invoice #:  {{invoice_number}}", 0)
put("E4", "Invoice #:  {{invoice_number}}", 0)
put("F4", "Invoice #:  {{invoice_number}}", 0)
MERGE += ["A4:B4", "C4:F4"]

put("C5", "Date: {{invoice_date}}    Due: {{due_date}}    PO: {{po_number}}", 0)
put("D5", "Date: {{invoice_date}}    Due: {{due_date}}    PO: {{po_number}}", 0)
put("E5", "Date: {{invoice_date}}    Due: {{due_date}}    PO: {{po_number}}", 0)
put("F5", "Date: {{invoice_date}}    Due: {{due_date}}    PO: {{po_number}}", 0)
MERGE.append("C5:F5")

put("C6", "Status: {{status}}", 0)
put("D6", "Status: {{status}}", 0)
put("E6", "Status: {{status}}", 0)
put("F6", "Status: {{status}}", 0)
MERGE.append("C6:F6")

# Bill To
put("A8", "BILL TO", 4); put("B8", "BILL TO", 4); MERGE.append("A8:B8")
put("A9", "{{customer_name}}", 0); put("B9", "{{customer_name}}", 0); MERGE.append("A9:B9")
put("A10", "{{customer_address}}", 0); put("B10", "{{customer_address}}", 0); MERGE.append("A10:B10")
put("A11", "{{customer_phone}}", 0); put("B11", "{{customer_phone}}", 0); MERGE.append("A11:B11")
put("A12", "{{customer_email}}", 0); put("B12", "{{customer_email}}", 0); MERGE.append("A12:B12")
put("A13", "NTN: {{customer_ntn}}    CNIC: {{customer_cnic}}", 0)
put("B13", "NTN: {{customer_ntn}}    CNIC: {{customer_cnic}}", 0)
MERGE.append("A13:B13")

# FBR band (gold soft)
put("A15", "FBR TAX INFORMATION", 10); put("B15", "FBR TAX INFORMATION", 10); put("C15", "FBR TAX INFORMATION", 10)
put("D15", "FBR TAX INFORMATION", 10); put("E15", "FBR TAX INFORMATION", 10); put("F15", "FBR TAX INFORMATION", 10)
MERGE.append("A15:F15")
put("A16", "Company NTN: {{company_ntn}}   STRN: {{company_strn}}", 0)
put("B16", "Company NTN: {{company_ntn}}   STRN: {{company_strn}}", 0)
put("C16", "Company NTN: {{company_ntn}}   STRN: {{company_strn}}", 0)
put("D16", "Company NTN: {{company_ntn}}   STRN: {{company_strn}}", 0)
put("E16", "Company NTN: {{company_ntn}}   STRN: {{company_strn}}", 0)
put("F16", "Company NTN: {{company_ntn}}   STRN: {{company_strn}}", 0)
MERGE.append("A16:F16")

# Items table header (navy)
HDR = [("A", "#"), ("B", "Product"), ("C", "SKU"), ("D", "Qty"), ("E", "Unit Price"), ("F", "Line Total")]
for col, txt in HDR:
    put(col + "19", txt, 5)

# Item rows 20..25
for n in range(1, 7):
    r = 19 + n
    put("A%d" % r, n, 6)
    for col, tok in [
        ("B", "{{items_%d_name}}" % n),
        ("C", "{{items_%d_sku}}" % n),
        ("D", "{{items_%d_qty}}" % n),
        ("E", "{{items_%d_price}}" % n),
        ("F", "{{items_%d_line_total}}" % n),
    ]:
        put(col + str(r), tok, 6)

# Totals
put("D27", "Subtotal", 7); put("E27", "Subtotal", 7); put("F27", "{{currency}} {{subtotal}}", 6)
MERGE.append("D27:E27")
put("D28", "Discount", 7); put("E28", "Discount", 7); put("F28", "-{{currency}} {{discount_total}}", 6)
MERGE.append("D28:E28")
put("D29", "Tax", 7); put("E29", "Tax", 7); put("F29", "{{currency}} {{tax_total}}", 6)
MERGE.append("D29:E29")
put("D30", "Amount Paid", 7); put("E30", "Amount Paid", 7); put("F30", "{{currency}} {{amount_paid}}", 6)
MERGE.append("D30:E30")
put("D31", "Balance Due", 7); put("E31", "Balance Due", 7); put("F31", "{{currency}} {{balance_due}}", 6)
MERGE.append("D31:E31")
put("D32", "GRAND TOTAL", 8); put("E32", "GRAND TOTAL", 8); put("F32", "{{currency}} {{grand_total}}", 9)
MERGE.append("D32:E32")

# Terms / bank / disclaimer
put("A34", "TERMS & CONDITIONS", 4); put("B34", "TERMS & CONDITIONS", 4); put("C34", "TERMS & CONDITIONS", 4)
put("D34", "TERMS & CONDITIONS", 4); put("E34", "TERMS & CONDITIONS", 4); put("F34", "TERMS & CONDITIONS", 4)
MERGE.append("A34:F34")
put("A35", "{{terms_conditions}}", 0); put("B35", "{{terms_conditions}}", 0); put("C35", "{{terms_conditions}}", 0)
put("D35", "{{terms_conditions}}", 0); put("E35", "{{terms_conditions}}", 0); put("F35", "{{terms_conditions}}", 0)
MERGE.append("A35:F35")
put("A36", "BANK DETAILS", 4); put("B36", "BANK DETAILS", 4); put("C36", "BANK DETAILS", 4)
put("D36", "BANK DETAILS", 4); put("E36", "BANK DETAILS", 4); put("F36", "BANK DETAILS", 4)
MERGE.append("A36:F36")
put("A37", "{{bank_details}}", 0); put("B37", "{{bank_details}}", 0); put("C37", "{{bank_details}}", 0)
put("D37", "{{bank_details}}", 0); put("E37", "{{bank_details}}", 0); put("F37", "{{bank_details}}", 0)
MERGE.append("A37:F37")
put("A38", "NOTES / DISCLAIMER", 4); put("B38", "NOTES / DISCLAIMER", 4); put("C38", "NOTES / DISCLAIMER", 4)
put("D38", "NOTES / DISCLAIMER", 4); put("E38", "NOTES / DISCLAIMER", 4); put("F38", "NOTES / DISCLAIMER", 4)
MERGE.append("A38:F38")
put("A39", "{{disclaimer}}", 0); put("B39", "{{disclaimer}}", 0); put("C39", "{{disclaimer}}", 0)
put("D39", "{{disclaimer}}", 0); put("E39", "{{disclaimer}}", 0); put("F39", "{{disclaimer}}", 0)
MERGE.append("A39:F39")

# Footer
put("A41", "{{invoice_footer}}", 6); put("B41", "{{invoice_footer}}", 6); put("C41", "{{invoice_footer}}", 6)
put("D41", "{{invoice_footer}}", 6); put("E41", "{{invoice_footer}}", 6); put("F41", "{{invoice_footer}}", 6)
MERGE.append("A41:F41")
put("A42", "Generated by Ijaz & Company ERP — {{generated_at}}", 0)
put("B42", "Generated by Ijaz & Company ERP — {{generated_at}}", 0)
put("C42", "Generated by Ijaz & Company ERP — {{generated_at}}", 0)
put("D42", "Generated by Ijaz & Company ERP — {{generated_at}}", 0)
put("E42", "Generated by Ijaz & Company ERP — {{generated_at}}", 0)
put("F42", "Generated by Ijaz & Company ERP — {{generated_at}}", 0)
MERGE.append("A42:F42")

# ---------------------------------------------------------------- xml utils
def esc(x):
    return (x.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))

def shared_strings():
    items = "".join("<si><t>%s</t></si>" % esc(v) for v in ss)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'count="%d" uniqueCount="%d">%s</sst>'
        % (len(ss), len(ss), items)
    )

def styles():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6">
    <font><sz val="11"/><color rgb="FF33415A"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><sz val="10"/><color rgb="FFE6C965"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="18"/><color rgb="FF1D2B54"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF1D2B54"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1D2B54"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFC9952A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF6F8FC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8EDC4"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFB9C8E6"/></left><right style="thin"><color rgb="FFB9C8E6"/></right><top style="thin"><color rgb="FFB9C8E6"/></top><bottom style="thin"><color rgb="FFB9C8E6"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="4" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''

def sheet():
    # rows with custom heights
    rows = {1: 34, 2: 20}
    cells_by_row = {}
    for ref, (style, idx, num) in C.items():
        import re
        m = re.match(r"([A-Z]+)(\d+)", ref)
        col, row = m.group(1), int(m.group(2))
        cells_by_row.setdefault(row, []).append((col, style, idx, num))

    out = []
    for row in sorted(cells_by_row):
        ht = rows.get(row)
        attrs = (' r="%d"' % row) + ((' ht="%d" customHeight="1"' % ht) if ht else '')
        out.append("<row%s>" % attrs)
        for col, style, idx, num in sorted(cells_by_row[row], key=lambda c: len(c[0])):
            ref = col + str(row)
            if num is not None:
                out.append('<c r="%s" s="%d"><v>%d</v></c>' % (ref, style, num))
            else:
                out.append('<c r="%s" s="%d" t="s"><v>%d</v></c>' % (ref, style, idx))
        out.append("</row>")

    merges = "".join('<mergeCell ref="%s"/>' % m for m in MERGE)
    cols = ('<cols><col min="1" max="1" width="6" customWidth="1"/>'
            '<col min="2" max="2" width="30" customWidth="1"/>'
            '<col min="3" max="3" width="14" customWidth="1"/>'
            '<col min="4" max="4" width="9" customWidth="1"/>'
            '<col min="5" max="5" width="13" customWidth="1"/>'
            '<col min="6" max="6" width="15" customWidth="1"/></cols>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<dimension ref="A1:F42"/>%s<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
        '%s<sheetData>%s</sheetData>'
        '<mergeCells count="%d">%s</mergeCells>'
        '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
        '</worksheet>'
        % (cols, "", "".join(out), len(MERGE), merges)
    )

def content_types():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''

def rels_root():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''

def workbook():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Invoice" sheetId="1" r:id="rId1"/></sheets>
</workbook>'''

def workbook_rels():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>'''

def core_props():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Ijaz &amp; Company — Invoice Template</dc:title>
  <dc:creator>Ijaz &amp; Company ERP</dc:creator>
</cp:coreProperties>'''

def app_props():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Ijaz &amp; Company ERP</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs/>
  <TitlesOfParts/>
</Properties>'''

# ---------------------------------------------------------------- write zip
files = {
    "[Content_Types].xml": content_types(),
    "_rels/.rels": rels_root(),
    "xl/workbook.xml": workbook(),
    "xl/_rels/workbook.xml.rels": workbook_rels(),
    "xl/worksheets/sheet1.xml": sheet(),
    "xl/sharedStrings.xml": shared_strings(),
    "xl/styles.xml": styles(),
    "docProps/core.xml": core_props(),
    "docProps/app.xml": app_props(),
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name, content in files.items():
        z.writestr(name, content)

print("wrote", OUT, os.path.getsize(OUT), "bytes")
