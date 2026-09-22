// ==========================================
// MINIMAL PDF GENERATOR (pure std, no deps)
// ==========================================
//
// Renders text + tables into a real PDF file using only the standard
// library. Used for report exports. Handles page breaks, a company
// header band and a small platform watermark footer.

pub struct PdfColumn {
    pub header: String,
    pub width: f64,
}

pub struct PdfDoc {
    pages: Vec<Vec<String>>,
    page: Vec<String>,
    y: f64,
    page_width: f64,
    page_height: f64,
    margin: f64,
    pub company_name: String,
    pub tagline: String,
}

const NAVY: &str = "0.110 0.133 0.329";
const DARK: &str = "0.20 0.24 0.32";
const GRAY: &str = "0.42 0.47 0.55";
const FOOTER_GRAY: &str = "0.60 0.63 0.70";
const RULE: &str = "0.78 0.82 0.88";

impl PdfDoc {
    pub fn new(_title: &str, company_name: &str, tagline: &str) -> Self {
        let mut doc = PdfDoc {
            pages: Vec::new(),
            page: Vec::new(),
            y: 0.0,
            page_width: 595.0,
            page_height: 842.0,
            margin: 50.0,
            company_name: company_name.to_string(),
            tagline: tagline.to_string(),
        };
        doc.start_page();
        doc
    }

    /// One self-contained text element.
    fn emit_text(&mut self, x: f64, y: f64, font: u8, size: f64, rgb: &str, text: &str) {
        self.page.push(format!(
            "BT /F{font} {size} Tf {rgb} rg {x} {y} Td ({}) Tj ET",
            pdf_escape(text)
        ));
    }

    fn emit_rule(&mut self, y: f64) {
        self.page.push(format!(
            "{RULE} RG 0.8 w {x1} {y} m {x2} {y} l S",
            x1 = self.margin,
            x2 = self.page_width - self.margin
        ));
    }

    fn start_page(&mut self) {
        if !self.page.is_empty() {
            self.pages.push(std::mem::take(&mut self.page));
        }
        self.page = Vec::new();

        // Company header band (company branding is the main identity).
        let top = self.page_height - self.margin;
        let company = self.company_name.clone();
        let tagline = self.tagline.clone();
        self.emit_text(self.margin, top - 4.0, 2, 16.0, NAVY, &company);
        if !tagline.is_empty() {
            self.emit_text(self.margin, top - 22.0, 1, 9.0, GRAY, &tagline);
        }
        self.emit_rule(top - 32.0);
        self.y = top - 48.0;
    }

    fn ensure_space(&mut self, needed: f64) {
        if self.y - needed < 60.0 {
            self.flush_footer();
            self.start_page();
        }
    }

    fn flush_footer(&mut self) {
        let page_num = self.pages.len() + 1;
        self.emit_text(
            self.margin,
            32.0,
            1,
            8.0,
            FOOTER_GRAY,
            &format!("Powered by Ijaz & Company ERP  ·  Page {page_num}"),
        );
    }

    pub fn add_title(&mut self, text: &str) {
        self.ensure_space(40.0);
        let width = self.page_width - self.margin * 2.0;
        let text_width = (text.chars().count() as f64) * 7.2;
        let x = self.margin + ((width - text_width) / 2.0).max(0.0);
        self.emit_text(x, self.y, 2, 15.0, NAVY, text);
        self.emit_rule(self.y - 14.0);
        self.y -= 34.0;
    }

    pub fn add_text(&mut self, text: &str, size: f64, bold: bool) {
        self.ensure_space(20.0);
        self.emit_text(
            self.margin,
            self.y,
            if bold { 2 } else { 1 },
            size,
            if bold { NAVY } else { DARK },
            text,
        );
        self.y -= 16.0;
    }

    pub fn add_blank(&mut self) {
        self.ensure_space(16.0);
        self.y -= 16.0;
    }

    /// Renders a table with proportional column widths.
    pub fn add_table(&mut self, columns: &[PdfColumn], rows: &[Vec<String>]) {
        let width = self.page_width - self.margin * 2.0;
        let total: f64 = columns.iter().map(|c| c.width).sum();
        let col_x: Vec<f64> = columns
            .iter()
            .scan(0.0, |acc, c| {
                let start = *acc;
                *acc += width * (c.width / total);
                Some(start + self.margin)
            })
            .collect();
        let col_w: Vec<f64> = columns.iter().map(|c| width * (c.width / total)).collect();

        // Header row
        self.ensure_space(28.0);
        for (i, col) in columns.iter().enumerate() {
            self.emit_text(
                col_x[i],
                self.y,
                2,
                9.0,
                NAVY,
                &truncate(&col.header, col_w[i]),
            );
        }
        self.emit_rule(self.y - 3.0);
        self.y -= 18.0;

        // Body rows
        for (idx, row) in rows.iter().enumerate() {
            self.ensure_space(15.0);
            let rgb = if idx % 2 == 0 { DARK } else { GRAY };
            for (i, cell) in row.iter().enumerate() {
                self.emit_text(col_x[i], self.y, 1, 9.0, rgb, &truncate(cell, col_w[i]));
            }
            self.y -= 15.0;
        }
        self.add_blank();
    }

    /// Finalizes the document and returns PDF bytes.
    pub fn finish(mut self) -> Vec<u8> {
        self.flush_footer();
        self.pages.push(std::mem::take(&mut self.page));

        let n_pages = self.pages.len();
        let mut objects: Vec<String> = Vec::new();

        let mut kids: Vec<String> = Vec::new();
        let mut next_obj = 5;
        for _ in 0..n_pages {
            kids.push(format!("{next_obj} 0 R"));
            next_obj += 2;
        }

        // 1 catalog, 2 pages, 3 F1 regular, 4 F2 bold
        objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());
        objects.push(format!(
            "<< /Type /Pages /Kids [{}] /Count {} >>",
            kids.join(" "),
            n_pages
        ));
        objects.push(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .to_string(),
        );
        objects.push(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
                .to_string(),
        );

        let mut page_obj = 5;
        for page in &self.pages {
            let content_stream = page.join("\n");
            objects.push(format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {} 0 R >>",
                self.page_width,
                self.page_height,
                page_obj + 1
            ));
            objects.push(format!(
                "<< /Length {} >>\nstream\n{}\nendstream",
                content_stream.len(),
                content_stream
            ));
            page_obj += 2;
        }

        let mut out = String::from("%PDF-1.4\n");
        let mut offsets: Vec<usize> = Vec::new();
        for (i, obj) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.push_str(&format!("{} 0 obj\n{}\nendobj\n", i + 1, obj));
        }
        let xref_start = out.len();
        out.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
        out.push_str("0000000000 65535 f \n");
        for off in &offsets {
            out.push_str(&format!("{:010} 00000 n \n", off));
        }
        out.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            objects.len() + 1,
            xref_start
        ));

        out.into_bytes()
    }
}

fn pdf_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
        .chars()
        .map(|c| if (c as u32) < 128 { c } else { '?' })
        .collect()
}

fn truncate(value: &str, width: f64) -> String {
    let max_chars = (width / 5.2).max(2.0) as usize;
    if value.chars().count() > max_chars {
        let cut: String = value.chars().take(max_chars.saturating_sub(1)).collect();
        format!("{cut}…")
    } else {
        value.to_string()
    }
}
