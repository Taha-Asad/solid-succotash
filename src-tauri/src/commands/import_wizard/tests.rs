    use super::*;
    use crate::commands::test_helpers::{register_owner, register_owner_full, setup_app};
    use calamine::{CellErrorType, Data};
    use sqlx::SqlitePool;
    use std::io::Cursor;
    use tauri::test::MockRuntime;
    use tauri::Manager;

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    async fn owner_app() -> tauri::App<MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    async fn current_company_id(app: &tauri::App<MockRuntime>) -> String {
        let pool = app.state::<SqlitePool>();
        sqlx::query_scalar::<_, String>(
            "SELECT company_id FROM users WHERE email = 'owner@test.com'",
        )
        .fetch_one(&*pool)
        .await
        .expect("company id")
    }

    /// Waits for a background import job to reach a terminal state, then
    /// returns the full `ImportResult` stored on the job. Mirrors what the
    /// frontend does by polling `get_import_job`.
    async fn finish_job(app: &tauri::App<MockRuntime>, job_id: &str) -> ImportResult {
        let pool = app.state::<SqlitePool>();
        for _ in 0..400 {
            let status: String = sqlx::query_scalar("SELECT status FROM import_jobs WHERE id = ?")
                .bind(job_id)
                .fetch_one(&*pool)
                .await
                .expect("job status");
            if matches!(status.as_str(), "completed" | "failed" | "rolled_back") {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        let status = get_import_job(app.state(), app.state(), job_id.to_string())
            .await
            .expect("get job");
        status
            .result
            .expect("finished job should carry a result")
    }

    fn mapping(
        source: &str,
        index: usize,
        target: &str,
        category: &str,
        confidence: &str,
    ) -> FieldMapping {
        FieldMapping {
            source_column: source.to_string(),
            source_index: index,
            target_field: target.to_string(),
            field_category: category.to_string(),
            confidence: confidence.to_string(),
            manual_value: None,
        }
    }

    /// Builds a minimal but valid .docx (ZIP + word/document.xml) in memory.
    fn make_docx(document_xml: &str) -> Vec<u8> {
        use std::io::Write;
        let cursor = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        zip.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .expect("start file");
        zip.write_all(document_xml.as_bytes()).expect("write xml");
        zip.finish().expect("finish zip").into_inner()
    }

    // ---------------------------------------------------------------
    // normalize_header (pure)
    // ---------------------------------------------------------------

    #[test]
    fn normalize_header_lowercases_and_collapses_spaces() {
        // Input: "Product Name!", "  SKU # ", "unit__price".
        // Expected: lowercase, non-alphanumerics dropped, spaces collapsed.
        assert_eq!(normalize_header("Product Name!"), "product name");
        assert_eq!(normalize_header("  SKU # "), "sku");
        assert_eq!(normalize_header("Unit__Price"), "unit price");
        assert_eq!(normalize_header("Cost Price"), "cost price");
    }

    // ---------------------------------------------------------------
    // propose_mappings / detect_field (pure)
    // ---------------------------------------------------------------

    #[test]
    fn propose_mappings_matches_core_fields() {
        // Input: common ERP headers.
        // Expected: sku/name/sell_price/quantity/unit/category/supplier/tax/expiry mapped.
        let headers = vec![
            "SKU".to_string(),
            "Product Name".to_string(),
            "Selling Price".to_string(),
            "Qty".to_string(),
            "Unit".to_string(),
            "Category".to_string(),
            "Supplier".to_string(),
            "Tax Rate".to_string(),
            "Expiry Date".to_string(),
        ];
        let mapped = propose_mappings("products", None, &headers);
        assert_eq!(mapped[0].target_field, "sku");
        assert_eq!(mapped[0].field_category, "core");
        assert_eq!(mapped[0].confidence, "high");
        assert_eq!(mapped[1].target_field, "name");
        assert_eq!(mapped[2].target_field, "sell_price");
        assert_eq!(mapped[3].target_field, "quantity_in_stock");
        assert_eq!(mapped[4].target_field, "unit");
        assert_eq!(mapped[5].target_field, "category");
        assert_eq!(mapped[5].confidence, "medium");
        assert_eq!(mapped[6].target_field, "supplier");
        assert_eq!(mapped[7].target_field, "tax_rate");
        assert_eq!(mapped[8].target_field, "expiry_date");
        assert_eq!(mapped[8].confidence, "high");
    }

    #[test]
    fn propose_mappings_custom_fallback_for_unknown_column() {
        // Input: a header with no known pattern.
        // Expected: custom:<normalized> field, category "custom", confidence "unknown".
        let headers = vec!["Flavor".to_string()];
        let mapped = propose_mappings("products", None, &headers);
        assert_eq!(mapped[0].target_field, "custom:flavor");
        assert_eq!(mapped[0].field_category, "custom");
        assert_eq!(mapped[0].confidence, "unknown");
    }

    #[test]
    fn propose_mappings_preserves_source_column_and_index() {
        // Input: headers ["Name", "Price"].
        // Expected: source_column/source_index echo the file.
        let headers = vec!["Name".to_string(), "Price".to_string()];
        let mapped = propose_mappings("products", None, &headers);
        assert_eq!(mapped[0].source_column, "Name");
        assert_eq!(mapped[0].source_index, 0);
        assert_eq!(mapped[1].source_column, "Price");
        assert_eq!(mapped[1].source_index, 1);
        assert_eq!(mapped[1].target_field, "sell_price");
    }

    #[test]
    fn propose_mappings_matches_customer_fields() {
        // Input: FBR-focused customer headers.
        // Expected: customer_name/email/phone/address/cnic/ntn/strn/buyer_type mapped.
        let headers = vec![
            "Customer Name".to_string(),
            "Email".to_string(),
            "Phone Number".to_string(),
            "Address".to_string(),
            "CNIC".to_string(),
            "NTN".to_string(),
            "STRN".to_string(),
            "Buyer Type".to_string(),
        ];
        let mapped = propose_mappings("customers", None, &headers);
        let fields: Vec<&str> = mapped.iter().map(|m| m.target_field.as_str()).collect();
        assert_eq!(
            fields,
            vec![
                "customer_name",
                "email",
                "phone",
                "address",
                "cnic",
                "ntn",
                "strn",
                "buyer_type"
            ]
        );
        assert!(mapped.iter().all(|m| m.field_category == "core"));
        assert_eq!(mapped[0].confidence, "high");
    }

    #[test]
    fn propose_mappings_skips_unknown_customer_column() {
        // Input: a column the customer vocabulary does not know.
        // Expected: mapped as "skip".
        let headers = vec!["Customer Name".to_string(), "Notes".to_string()];
        let mapped = propose_mappings("customers", None, &headers);
        assert_eq!(mapped[0].target_field, "customer_name");
        assert_eq!(mapped[1].target_field, "skip");
        assert_eq!(mapped[1].field_category, "skip");
    }

    #[test]
    fn propose_mappings_matches_opening_stock_fields() {
        // Input: opening-stock headers.
        // Expected: sku/name/quantity/cost_price/expiry_date mapped.
        let headers = vec![
            "SKU".to_string(),
            "Product Name".to_string(),
            "Opening Qty".to_string(),
            "Cost Price".to_string(),
            "Expiry Date".to_string(),
        ];
        let mapped = propose_mappings("opening_stock", None, &headers);
        let fields: Vec<&str> = mapped.iter().map(|m| m.target_field.as_str()).collect();
        assert_eq!(
            fields,
            vec!["sku", "name", "quantity", "cost_price", "expiry_date"]
        );
        assert_eq!(mapped[0].confidence, "high");
        assert_eq!(mapped[2].confidence, "high");
    }

    // ---------------------------------------------------------------
    // parse_price (pure)
    // ---------------------------------------------------------------

    #[test]
    fn parse_price_converts_to_paisa() {
        // Input: "15.00", "1500", "1,500.00", "0".
        // Expected: 1500, 1500 (already paisa), 150000, 0.
        assert_eq!(parse_price("15.00"), 1500);
        assert_eq!(parse_price("1500"), 1500);
        assert_eq!(parse_price("1,500.00"), 150000);
        assert_eq!(parse_price("0"), 0);
    }

    #[test]
    fn parse_price_truncates_to_two_decimals() {
        // Input: "5.999", "1.2", "7".
        // Expected: 599, 120, 7.
        assert_eq!(parse_price("5.999"), 599);
        assert_eq!(parse_price("1.2"), 120);
        assert_eq!(parse_price("7"), 7);
    }

    // ---------------------------------------------------------------
    // cell_to_string (pure)
    // ---------------------------------------------------------------

    #[test]
    fn cell_to_string_converts_common_variants() {
        // Input: String/Int/Float/Bool/Error/Empty cells.
        // Expected: trimmed strings, whole floats without decimal, errors/empty = "".
        assert_eq!(
            cell_to_string(&Data::String("  Widget  ".to_string())),
            "Widget"
        );        assert_eq!(cell_to_string(&Data::Int(42)), "42");
        assert_eq!(cell_to_string(&Data::Float(5.0)), "5");
        assert_eq!(cell_to_string(&Data::Float(5.5)), "5.5");
        assert_eq!(cell_to_string(&Data::Bool(true)), "true");
        assert_eq!(cell_to_string(&Data::Error(CellErrorType::NA)), "");
        assert_eq!(cell_to_string(&Data::Empty), "");
    }

    #[test]
    fn split_text_line_uses_tabs_and_double_spaces_as_column_separators() {
        // Input: a tab-separated line and a double-space-separated line.
        // Expected: single spaces inside a cell are preserved, column runs split.
        assert_eq!(
            split_text_line("SKU\tProduct Name\tQty"),
            vec!["SKU", "Product Name", "Qty"]
        );
        assert_eq!(
            split_text_line("A-1  Widget  10"),
            vec!["A-1", "Widget", "10"]
        );
        // Single spaces inside a name must NOT split the cell.
        assert_eq!(
            split_text_line("C-2  Ijaz & Company  5"),
            vec!["C-2", "Ijaz & Company", "5"]
        );
        assert_eq!(split_text_line("   "), Vec::<String>::new());
    }

    #[test]
    fn parse_text_rows_drops_blank_lines_and_pads_cells() {
        // Input: lines with an empty line in the middle and a short cell.
        // Expected: blank lines removed, every line still becomes a row.
        let text = "SKU  Product Name  Qty\nA-1  Widget  10\n\nB-2  Gadget  20\n";
        let rows = parse_text_rows(text);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0], vec!["SKU", "Product Name", "Qty"]);
        assert_eq!(rows[2], vec!["B-2", "Gadget", "20"]);
    }

    #[test]
    fn read_pdf_rows_rejects_bytes_that_are_not_a_pdf() {
        // Input: garbage bytes for a "PDF".
        // Expected: Err with guidance, since the text layer cannot be parsed.
        let err = read_pdf_rows(b"definitely not a pdf").unwrap_err();
        assert!(err.contains("PDF"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // parse_docx_table (pure)
    // ---------------------------------------------------------------

    #[test]
    fn parse_docx_table_extracts_first_table() {
        // Input: minimal WordprocessingML with a 2x2 table.
        // Expected: two rows, multi-paragraph cell joined with a space.
        let xml = concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body><w:tbl>",
            "<w:tr><w:tc><w:p><w:r><w:t>SKU</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Product</w:t></w:r></w:p><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc></w:tr>",
            "<w:tr><w:tc><w:p><w:r><w:t>A-1</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Widget</w:t></w:r></w:p></w:tc></w:tr>",
            "</w:tbl></w:body></w:document>",
        );
        let rows = parse_docx_table(xml).expect("parse");
        assert_eq!(
            rows,
            vec![
                vec!["SKU".to_string(), "Product Name".to_string()],
                vec!["A-1".to_string(), "Widget".to_string()],
            ]
        );
    }

    #[test]
    fn parse_docx_table_rejects_malformed_xml() {
        // Input: invalid XML.
        // Expected: Err containing "XML parsing error".
        let err = parse_docx_table("<w:tbl").unwrap_err();
        assert!(err.contains("XML parsing error"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // detect_field_type / looks_like_date
    // ---------------------------------------------------------------

    #[test]
    fn looks_like_date_recognizes_common_formats() {
        // Input: ISO, slash and non-date strings.
        // Expected: date-like patterns true, others false.
        assert!(looks_like_date("2024-01-15"));
        assert!(looks_like_date("15/01/2024"));
        assert!(!looks_like_date("not a date"));
        assert!(!looks_like_date("2024"));
        assert!(!looks_like_date("Widget"));
    }

    #[tokio::test]
    async fn detect_field_type_classifies_numeric_and_text_columns() {
        // Input: CSV with a Price column of numbers and a Name column of text.
        // Expected: "number" for the price column, "text" for the name column.
        let req = ImportRequest {
            target: "products".to_string(),
            mappings: Vec::new(),
            file_bytes: b"Name,Price\nAlpha,10.50\nBeta,20.25\n".to_vec(),
            file_type: "csv".to_string(),
            template_name: String::new(),
            has_header_row: true,
            import_data: false,
        conflict_strategy: ConflictStrategy::default(),
        dry_run: false,
        file_name: None,
        };
        assert_eq!(detect_field_type(&req, &mapping("Price", 1, "skip", "core", "high")), "number");
        assert_eq!(detect_field_type(&req, &mapping("Name", 0, "skip", "core", "high")), "text");
    }

    #[tokio::test]
    async fn detect_field_type_returns_text_for_unknown_type() {
        // Input: CSV whose sampled column is neither numeric nor date-like.
        // Expected: "text".
        let req = ImportRequest {
            target: "products".to_string(),
            mappings: Vec::new(),
            file_bytes: b"Header\none\ntwo\nthree\n".to_vec(),
            file_type: "csv".to_string(),
            template_name: String::new(),
            has_header_row: true,
            import_data: false,
        conflict_strategy: ConflictStrategy::default(),
        dry_run: false,
        file_name: None,
        };
        assert_eq!(detect_field_type(&req, &mapping("Header", 0, "skip", "core", "high")), "text");
    }

    #[test]
    fn manual_field_applies_constant_value_to_every_row() {
        // Input: a manually-added mapping (no file column, fixed value)
        // plus a normal file column mapping.
        // Expected: the fixed value is used for every row even though the
        // source_index points nowhere.
        let mappings = vec![
            mapping("Name", 0, "name", "core", "high"),
            mapping("SKU", 1, "sku", "core", "high"),
            FieldMapping {
                source_column: "Category".to_string(),
                source_index: 99,
                target_field: "category".to_string(),
                field_category: "core".to_string(),
                confidence: "manual".to_string(),
                manual_value: Some("Medicines".to_string()),
            },
        ];
        let row = vec!["Aspirin".to_string(), "A-1".to_string()];
        let parsed = parse_product_row(&mappings, &row).expect("row parses");
        assert_eq!(parsed.name, "Aspirin");
        assert_eq!(parsed.sku, "A-1");
        assert_eq!(parsed.category_name, "Medicines");
    }

    // ---------------------------------------------------------------
    // analyze_import_file (integration)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn analyze_csv_returns_headers_rows_and_mappings() {
        // Input: a 2-column, 2-data-row CSV through analyze_import_file.
        // Expected: headers extracted, total_rows = 2, sku/name mappings proposed.
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\nA-2,Gadget\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            None,
            None,
        )
        .await
        .expect("analyze");
        assert_eq!(
            analysis.headers,
            vec!["SKU".to_string(), "Product Name".to_string()]
        );
        assert_eq!(analysis.total_rows, 2);
        assert_eq!(analysis.sample_rows.len(), 2);
        assert_eq!(analysis.file_type, "csv");
        assert_eq!(analysis.proposed_mappings[0].target_field, "sku");
        assert_eq!(analysis.proposed_mappings[1].target_field, "name");
    }

    #[tokio::test]
    async fn analyze_csv_with_header_row_only_has_zero_total_rows() {
        // Input: CSV with only a header line.
        // Expected: total_rows = 0, empty sample, headers still parsed.
        let app = owner_app().await;
        let csv = "SKU,Product Name\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            None,
            None,
        )
        .await
        .expect("analyze");
        assert_eq!(analysis.total_rows, 0);
        assert!(analysis.sample_rows.is_empty());
    }

    #[tokio::test]
    async fn analyze_import_file_rejects_empty_bytes() {
        // Input: empty byte vector.
        // Expected: Err "File is empty".
        let app = owner_app().await;
        let err = analyze_import_file(
            app.state(),
            app.state(),
            Vec::new(),
            "csv".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "File is empty");
    }

    #[tokio::test]
    async fn execute_import_refuses_to_commit_without_confirm_gate() {
        // Input: import_data = true, dry_run = false on execute_import.
        // Expected: Err telling the caller to preview + confirm_import, and no
        //           rows or import_jobs written (the §23.3 confirm gate).
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\n";

        let err = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect_err("execute_import must not commit directly");

        assert!(
            err.contains("confirm_import"),
            "expected confirm-gate error, got: {err}"
        );

        let pool = app.state::<SqlitePool>();
        let products: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products")
            .fetch_one(&*pool)
            .await
            .expect("products");
        assert_eq!(products, 0, "no rows may be written before confirmation");
        let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_jobs")
            .fetch_one(&*pool)
            .await
            .expect("jobs");
        assert_eq!(jobs, 0, "no import job may be created before confirmation");
    }

    #[tokio::test]
    async fn analyze_import_file_rejects_unsupported_type() {
        // Input: file_type "txt".
        // Expected: Err listing supported types.
        let app = owner_app().await;
        let err = analyze_import_file(
            app.state(),
            app.state(),
            b"data".to_vec(),
            "txt".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("Unsupported file type"), "got: {err}");
        assert!(err.contains("xlsx"));
        assert!(err.contains("pdf"));
    }

    #[tokio::test]
    async fn analyze_auto_reuses_matching_target_template() {
        // Setup: save a "Medicines" template for the products target that maps
        // SKU + Product Name.
        // Expected: analyzing a file with those headers auto-detects the
        // template, applies its mappings, and bumps its use_count.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        save_import_template(
            &*pool,
            &company_id,
            &ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    FieldMapping {
                        source_column: "SKU".to_string(),
                        source_index: 0,
                        target_field: "sku".to_string(),
                        field_category: "core".to_string(),
                        confidence: "high".to_string(),
                        manual_value: None,
                    },
                    FieldMapping {
                        source_column: "Product Name".to_string(),
                        source_index: 1,
                        target_field: "name".to_string(),
                        field_category: "core".to_string(),
                        confidence: "high".to_string(),
                        manual_value: None,
                    },
                ],
                file_bytes: Vec::new(),
                file_type: "csv".to_string(),
                template_name: "Medicines".to_string(),
                has_header_row: true,
                import_data: false,
                conflict_strategy: ConflictStrategy::Skip,
                dry_run: true,
                file_name: None,
            },
        )
        .await;

        let csv = "SKU,Product Name\nA-1,Widget\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            Some("products".to_string()),
            None,
        )
        .await
        .expect("analyze");

        assert_eq!(analysis.auto_template_name.as_deref(), Some("Medicines"));
        assert!(
            analysis.auto_template_id.is_some(),
            "template id should be attached"
        );
        assert_eq!(analysis.proposed_mappings[0].target_field, "sku");
        assert_eq!(analysis.proposed_mappings[1].target_field, "name");

        let template_id = analysis.auto_template_id.unwrap();
        let use_count: i64 = sqlx::query_scalar(
            "SELECT use_count FROM import_templates WHERE id = ?",
        )
        .bind(&template_id)
        .fetch_one(&*pool)
        .await
        .expect("use_count");
        assert_eq!(use_count, 1, "auto-reuse must bump use_count");
    }

    #[tokio::test]
    async fn analyze_does_not_auto_apply_template_from_other_target() {
        // Setup: save a template for the "customers" target only.
        // Expected: analyzing a products file does NOT match it.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        save_import_template(
            &*pool,
            &company_id,
            &ImportRequest {
                target: "customers".to_string(),
                mappings: vec![FieldMapping {
                    source_column: "Name".to_string(),
                    source_index: 0,
                    target_field: "name".to_string(),
                    field_category: "core".to_string(),
                    confidence: "high".to_string(),
                    manual_value: None,
                }],
                file_bytes: Vec::new(),
                file_type: "csv".to_string(),
                template_name: "CustomerList".to_string(),
                has_header_row: true,
                import_data: false,
                conflict_strategy: ConflictStrategy::Skip,
                dry_run: true,
                file_name: None,
            },
        )
        .await;

        let csv = "SKU,Product Name\nA-1,Widget\n".to_string();
        let analysis = analyze_import_file(
            app.state(),
            app.state(),
            csv.into_bytes(),
            "csv".to_string(),
            Some("products".to_string()),
            None,
        )
        .await
        .expect("analyze");

        assert!(analysis.auto_template_id.is_none());
        assert!(analysis.auto_template_name.is_none());
    }

    #[tokio::test]
    async fn analyze_import_file_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = analyze_import_file(
            app.state(),
            app.state(),
            b"a,b\n1,2".to_vec(),
            "csv".to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn analyze_docx_extracts_table_from_real_zip() {
        // Input: an in-memory .docx (ZIP) containing one table.
        // Expected: headers/rows/mappings extracted; file_type "docx".
        let app = owner_app().await;
        let xml = concat!(
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body><w:tbl>",
            "<w:tr><w:tc><w:p><w:r><w:t>SKU</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Product Name</w:t></w:r></w:p></w:tc></w:tr>",
            "<w:tr><w:tc><w:p><w:r><w:t>A-1</w:t></w:r></w:p></w:tc>",
            "<w:tc><w:p><w:r><w:t>Widget</w:t></w:r></w:p></w:tc></w:tr>",
            "</w:tbl></w:body></w:document>",
        );
        let bytes = make_docx(xml);

        let analysis =
            analyze_import_file(app.state(), app.state(), bytes, "docx".to_string(), None, None)
                .await
                .expect("analyze");
        assert_eq!(analysis.file_type, "docx");
        assert_eq!(
            analysis.headers,
            vec!["SKU".to_string(), "Product Name".to_string()]
        );
        assert_eq!(analysis.total_rows, 1);
        assert_eq!(analysis.proposed_mappings[0].target_field, "sku");
        assert_eq!(analysis.proposed_mappings[1].target_field, "name");
    }

    #[tokio::test]
    async fn analyze_docx_rejects_file_without_table() {
        // Input: a valid .docx whose XML has no <w:tbl>.
        // Expected: Err about no table found.
        let app = owner_app().await;
        let xml = concat!(
            "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
            "<w:body><w:p><w:r><w:t>Just text</w:t></w:r></w:p></w:body></w:document>",
        );
        let bytes = make_docx(xml);
        let err = analyze_import_file(app.state(), app.state(), bytes, "docx".to_string(), None, None)
        .await
        .unwrap_err();
        assert!(err.contains("No table found"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // execute_import (integration)
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn execute_import_creates_products_relations_and_batches() {
        // Input: CSV with sku/name/category/supplier/qty/prices/tax/expiry/custom columns.
        // Expected: 2 products imported, 1 custom field, category+supplier created,
        //           stock movement + expiry batch recorded, tax as basis points.
        let app = setup_app().await;
        let company = register_owner_full(&app, "owner@test.com").await;
        let company_id = &company.company.id;

        let csv = concat!(
            "SKU,Product Name,Category,Supplier,Quantity,Sell Price,Cost Price,Tax Rate,Expiry Date,Flavor\n",
            "A-1,Widget One,Gadgets,Acme Supplies,10,1500.00,800.00,17.00,2026-12-31,Vanilla\n",
            "A-2,Widget Two,Gadgets,Acme Supplies,5,2000.00,1000.00,0,,\n",
        );

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Category", 2, "category", "core", "medium"),
                    mapping("Supplier", 3, "supplier", "core", "medium"),
                    mapping("Quantity", 4, "quantity_in_stock", "core", "high"),
                    mapping("Sell Price", 5, "sell_price", "core", "high"),
                    mapping("Cost Price", 6, "cost_price", "core", "high"),
                    mapping("Tax Rate", 7, "tax_rate", "core", "medium"),
                    mapping("Expiry Date", 8, "expiry_date", "core", "high"),
                    mapping("Flavor", 9, "custom:flavor", "custom", "unknown"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: "default".to_string(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 2);
        assert_eq!(result.fields_created, 1);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.errors.is_empty());

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(company_id.as_str())
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 2);

        let (name, cost, sell, tax, qty, category, supplier): (
            String,
            i64,
            i64,
            i64,
            i64,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT p.name, p.cost_price, p.sell_price, p.tax_rate, p.quantity_in_stock,
                        COALESCE(c.name, ''), COALESCE(s.name, '')
                 FROM products p
                 LEFT JOIN categories c ON c.id = p.category_id
                 LEFT JOIN suppliers s ON s.id = p.supplier_id
                 WHERE p.sku = 'A-1'",
        )
        .fetch_one(&*pool)
        .await
        .expect("product");
        assert_eq!(name, "Widget One");
        assert_eq!(cost, 80000);
        assert_eq!(sell, 150000);
        assert_eq!(tax, 1700);
        assert_eq!(qty, 10);
        assert_eq!(category, "Gadgets");
        assert_eq!(supplier, "Acme Supplies");

        let custom: Option<String> =
            sqlx::query_scalar("SELECT custom_fields FROM products WHERE sku = 'A-1'")
                .fetch_one(&*pool)
                .await
                .expect("custom");
        assert!(
            custom
                .as_ref()
                .unwrap_or(&String::new())
                .contains("Vanilla"),
            "got: {custom:?}"
        );

        let category_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM categories")
            .fetch_one(&*pool)
            .await
            .expect("categories");
        assert_eq!(
            category_count, 1,
            "categories should be shared between rows"
        );
        let supplier_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM suppliers")
            .fetch_one(&*pool)
            .await
            .expect("suppliers");
        assert_eq!(supplier_count, 1);

        let movement_note: String = sqlx::query_scalar(
            "SELECT reference_note FROM stock_movements WHERE movement_type = 'adjustment' LIMIT 1",
        )
        .fetch_one(&*pool)
        .await
        .expect("movement");
        assert_eq!(movement_note, "Imported from file");

        let (batch_qty, batch_expiry, batch_source): (i64, String, String) =
            sqlx::query_as("SELECT quantity, expiry_date, source FROM stock_batches")
                .fetch_one(&*pool)
                .await
                .expect("batch");
        assert_eq!(batch_qty, 10);
        assert_eq!(batch_expiry, "2026-12-31");
        assert_eq!(batch_source, "import");

        let (field_name, field_label, field_type): (String, String, String) = sqlx::query_as(
            "SELECT field_name, field_label, field_type FROM company_field_settings",
        )
        .fetch_one(&*pool)
        .await
        .expect("field");
        assert_eq!(field_name, "flavor");
        assert_eq!(field_label, "Flavor");
        assert_eq!(field_type, "text");

        let (tpl_name, tpl_type): (String, String) =
            sqlx::query_as("SELECT template_name, file_type FROM import_templates")
                .fetch_one(&*pool)
                .await
                .expect("template");
        assert_eq!(tpl_name, "default");
        assert_eq!(tpl_type, "csv");

        let audit_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM audit_logs WHERE action = 'import'")
                .fetch_one(&*pool)
                .await
                .expect("audit");
        assert_eq!(audit_count, 1);
    }

    #[tokio::test]
    async fn execute_import_skips_duplicate_sku_by_default() {
        // Input: two rows sharing the same SKU.
        // Expected (spec §23.7): default conflict strategy = skip,
        // so 1 product imported and 1 row skipped (not an error).
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\nA-1,Widget Dup\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 1);
        assert_eq!(result.rows_skipped, 1);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.job_id.is_some());
    }

    #[tokio::test]
    async fn execute_import_overwrite_strategy_updates_existing_sku() {
        // Input: a pre-existing product with SKU A-1, then a CSV that
        // updates it. Expected: overwrite keeps one product, changes name.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        sqlx::query(
            "INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock, unit) VALUES (?, ?, 'A-1', 'Old Name', 0, 0, 0, '')",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&company_id)
        .execute(pool.inner())
        .await
        .expect("seed product");

        let csv = "SKU,Product Name\nA-1,New Name\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::Overwrite,
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(pool.inner())
            .await
            .expect("count");
        assert_eq!(count, 1);
        let name: String = sqlx::query_scalar(
            "SELECT name FROM products WHERE company_id = ? AND sku = 'A-1'",
        )
        .bind(&company_id)
        .fetch_one(pool.inner())
        .await
        .expect("name");
        assert_eq!(name, "New Name");
    }

    #[tokio::test]
    async fn execute_import_suffix_strategy_creates_new_sku() {
        // Input: a pre-existing product with SKU A-1, then a CSV importing
        // the same SKU. Expected: suffix strategy creates A-1-1.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let pool = app.state::<SqlitePool>();

        sqlx::query(
            "INSERT INTO products (id, company_id, sku, name, cost_price, sell_price, quantity_in_stock, unit) VALUES (?, ?, 'A-1', 'Existing', 0, 0, 0, '')",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&company_id)
        .execute(pool.inner())
        .await
        .expect("seed product");

        let csv = "SKU,Product Name\nA-1,Another\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::Suffix,
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(pool.inner())
            .await
            .expect("count");
        assert_eq!(count, 2);
        let suffixed: Option<String> = sqlx::query_scalar(
            "SELECT sku FROM products WHERE company_id = ? AND sku = 'A-1-1'",
        )
        .bind(&company_id)
        .fetch_one(pool.inner())
        .await
        .expect("lookup");
        assert_eq!(suffixed.as_deref(), Some("A-1-1"));
    }

    #[tokio::test]
    async fn execute_import_errors_when_name_column_missing() {
        // Input: only an SKU column mapped, no name source.
        // Expected: every row errors with the "no product NAME" message.
        let app = owner_app().await;
        let csv = "SKU\nA-1\nA-2\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 0);
        assert_eq!(result.rows_with_errors, 2);
        assert!(
            result.errors[0].reason.contains("Row has no product NAME"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_skips_blank_rows() {
        // Input: CSV with an empty line between two data rows.
        // Expected: blank row skipped, both products imported.
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\n\nA-2,Gadget\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
    }

    #[tokio::test]
    async fn execute_import_bad_expiry_reports_row_error() {
        // Input: an unparseable expiry date in one row.
        // Expected: that row fails; others still import.
        let app = owner_app().await;
        let csv = "SKU,Product Name,Expiry Date\nA-1,Widget,not-a-date\nA-2,Gadget,\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Expiry Date", 2, "expiry_date", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 1);
        assert_eq!(result.rows_with_errors, 1);
        assert!(
            result.errors[0]
                .reason
                .contains("Cannot read date 'not-a-date'"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_without_import_data_creates_no_products() {
        // Input: same mappings but import_data = false.
        // Expected: custom field still created, 0 products imported.
        let app = owner_app().await;
        let csv = "SKU,Product Name,Flavor\nA-1,Widget,Vanilla\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Flavor", 2, "custom:flavor", "custom", "unknown"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: false,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        assert_eq!(result.products_imported, 0);
        assert_eq!(result.fields_created, 1);

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products")
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn execute_import_stops_after_fifty_errors() {
        // Input: 55 rows that all fail (no name mapping).
        // Expected: 50 counted errors + a "Stopped after 50 errors" cap entry.
        let app = owner_app().await;
        let mut csv = String::from("SKU\n");
        for i in 0..55 {
            csv.push_str(&format!("SKU-{i}\n"));
        }
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![mapping("SKU", 0, "sku", "core", "high")],
                file_bytes: csv.into_bytes(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.products_imported, 0);
        assert_eq!(result.rows_with_errors, 50);
        assert_eq!(result.errors.len(), 51);
        assert_eq!(result.errors.last().unwrap().row_number, 0);
        assert!(
            result
                .errors
                .last()
                .unwrap()
                .reason
                .contains("Stopped after 50 errors"),
            "got: {}",
            result.errors.last().unwrap().reason
        );
    }

    #[tokio::test]
    async fn execute_import_requires_login() {
        // Input: no session.
        // Expected: Err "You must log in first".
        let app = setup_app().await;
        let err = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: Vec::new(),
                file_bytes: b"a,b\n1,2".to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err, "You must log in first");
    }

    #[tokio::test]
    async fn execute_import_creates_customers() {
        // Input: CSV with FBR customer columns.
        // Expected: 2 customers inserted with all fields populated.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = concat!(
            "Customer Name,Email,Phone,Address,CNIC,NTN,STRN,Buyer Type\n",
            "Ahmed Khan,ahmed@mail.com,03001234567,Lahore,42101-1234567-1,NTN-001,STRN-001,registered\n",
            "Zainab Ali,zainab@mail.com,03111234567,Karachi,,NTN-002,STRN-002,unregistered\n",
        );

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Email", 1, "email", "core", "high"),
                    mapping("Phone", 2, "phone", "core", "high"),
                    mapping("Address", 3, "address", "core", "medium"),
                    mapping("CNIC", 4, "cnic", "core", "medium"),
                    mapping("NTN", 5, "ntn", "core", "medium"),
                    mapping("STRN", 6, "strn", "core", "medium"),
                    mapping("Buyer Type", 7, "buyer_type", "core", "medium"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.customers_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.errors.is_empty());

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customers WHERE company_id = ?")
            .bind(company_id.as_str())
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 2);

        let (_name, email, phone, address, cnic, ntn, strn, buyer_type): (
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
        ) = sqlx::query_as(
            "SELECT name, COALESCE(email, ''), COALESCE(phone, ''), COALESCE(address, ''),
                    COALESCE(cnic, ''), COALESCE(ntn, ''), COALESCE(strn, ''), buyer_type
             FROM customers WHERE company_id = ? AND name = 'Ahmed Khan'",
        )
        .bind(company_id)
        .fetch_one(&*pool)
        .await
        .expect("customer");
        assert_eq!(email, "ahmed@mail.com");
        assert_eq!(phone, "03001234567");
        assert_eq!(address, "Lahore");
        assert_eq!(cnic, "42101-1234567-1");
        assert_eq!(ntn, "NTN-001");
        assert_eq!(strn, "STRN-001");
        assert_eq!(buyer_type, "registered");
    }

    #[tokio::test]
    async fn execute_import_customers_skip_duplicates() {
        // Input: the same customer name twice.
        // Expected: 1 inserted, 1 silently skipped, no errors.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = concat!(
            "Customer Name,Phone\n",
            "Ahmed Khan,03001234567\n",
            "Ahmed Khan,03111234567\n",
        );

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Phone", 1, "phone", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.customers_imported, 1);
        assert_eq!(result.rows_with_errors, 0);

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM customers WHERE company_id = ?")
            .bind(company_id.as_str())
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn execute_import_customer_missing_name_reports_error() {
        // Input: a row with only a phone, no name.
        // Expected: row error, 0 customers imported.
        let app = owner_app().await;
        let csv = "Customer Name,Phone\n,03001234567\n";

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Phone", 1, "phone", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.customers_imported, 0);
        assert_eq!(result.rows_with_errors, 1);
        assert_eq!(result.errors[0].row_number, 2);
        assert!(
            result.errors[0].reason.contains("no customer NAME"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_opening_stock_adds_quantity_and_batch() {
        // Input: a product imported first, then an opening-stock CSV.
        // Expected: product quantity increases, movement + expiry batch recorded.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;

        // Seed the product via the products import path.
        let product_csv = "SKU,Product Name,Quantity\nA-1,Widget One,5\n";
        let product_result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Quantity", 2, "quantity_in_stock", "core", "high"),
                ],
                file_bytes: product_csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("product import");
        let product_job_id = product_result.job_id.expect("product job id");
        let product_result = finish_job(&app, &product_job_id).await;
        assert_eq!(product_result.products_imported, 1);

        let stock_csv = concat!(
            "SKU,Opening Qty,Cost Price,Expiry Date\n",
            "A-1,10,850.00,2026-12-31\n",
        );
        let stock_result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "opening_stock".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Opening Qty", 1, "quantity", "core", "high"),
                    mapping("Cost Price", 2, "cost_price", "core", "high"),
                    mapping("Expiry Date", 3, "expiry_date", "core", "high"),
                ],
                file_bytes: stock_csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("stock import");

        let stock_job_id = stock_result.job_id.expect("stock job id");
        let stock_result = finish_job(&app, &stock_job_id).await;

        assert_eq!(stock_result.items_imported, 1);
        assert_eq!(stock_result.rows_with_errors, 0);

        let pool = app.state::<SqlitePool>();
        let qty: i64 = sqlx::query_scalar(
            "SELECT quantity_in_stock FROM products WHERE company_id = ? AND sku = 'A-1'",
        )
        .bind(company_id)
        .fetch_one(&*pool)
        .await
        .expect("qty");
        assert_eq!(qty, 15);

        let movement: String = sqlx::query_scalar(
            "SELECT reference_note FROM stock_movements
             WHERE movement_type = 'adjustment' AND reference_note = 'Opening stock from import'",
        )
        .fetch_one(&*pool)
        .await
        .expect("movement");
        assert_eq!(movement, "Opening stock from import");

        let (batch_qty, batch_cost, batch_expiry): (i64, i64, String) =
            sqlx::query_as("SELECT quantity, unit_cost, expiry_date FROM stock_batches")
                .fetch_one(&*pool)
                .await
                .expect("batch");
        assert_eq!(batch_qty, 10);
        assert_eq!(batch_cost, 85000);
        assert_eq!(batch_expiry, "2026-12-31");
    }

    #[tokio::test]
    async fn execute_import_opening_stock_unknown_sku_reports_error() {
        // Input: opening stock row for a SKU that does not exist.
        // Expected: row error, no movement created.
        let app = owner_app().await;
        let csv = "SKU,Opening Qty\nMISSING-1,10\n";

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "opening_stock".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Opening Qty", 1, "quantity", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
            conflict_strategy: ConflictStrategy::default(),
            dry_run: false,
            file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.items_imported, 0);
        assert_eq!(result.rows_with_errors, 1);
        assert!(
            result.errors[0]
                .reason
                .contains("No product with SKU 'MISSING-1'"),
            "got: {}",
            result.errors[0].reason
        );

        let pool = app.state::<SqlitePool>();
        let movement_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM stock_movements")
            .fetch_one(&*pool)
            .await
            .expect("movements");
        assert_eq!(movement_count, 0);
    }

    #[tokio::test]
    async fn execute_import_suppliers_creates_suppliers() {
        // Input: a supplier CSV. Expected: 2 suppliers with contact details.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = concat!(
            "Supplier Name,Contact Person,Phone,Email,NTN\n",
            "Acme Supplies,Raza Ali,03001234567,raza@acme.pk,1234567-8\n",
            "Global Traders,Sana,03111234567,sana@global.pk,7654321-0\n",
        );

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "suppliers".to_string(),
                mappings: vec![
                    mapping("Supplier Name", 0, "supplier_name", "core", "high"),
                    mapping("Contact Person", 1, "contact_person", "core", "medium"),
                    mapping("Phone", 2, "phone", "core", "high"),
                    mapping("Email", 3, "email", "core", "high"),
                    mapping("NTN", 4, "tax_number", "core", "medium"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.items_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
        assert!(result.job_id.is_some());

        let pool = app.state::<SqlitePool>();
        let (name, tax): (String, String) = sqlx::query_as(
            "SELECT name, tax_number FROM suppliers WHERE company_id = ? AND name = 'Acme Supplies'",
        )
        .bind(&company_id)
        .fetch_one(&*pool)
        .await
        .expect("supplier");
        assert_eq!(name, "Acme Supplies");
        assert_eq!(tax, "1234567-8");
    }

    #[tokio::test]
    async fn execute_import_supplier_missing_name_reports_error() {
        // Input: a supplier row with no name. Expected: row error.
        let app = owner_app().await;
        let csv = "Supplier Name,Phone\n,03001234567\n";

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "suppliers".to_string(),
                mappings: vec![
                    mapping("Supplier Name", 0, "supplier_name", "core", "high"),
                    mapping("Phone", 1, "phone", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");

        let job_id = result.job_id.expect("job id");
        let result = finish_job(&app, &job_id).await;

        assert_eq!(result.items_imported, 0);
        assert_eq!(result.rows_with_errors, 1);
        assert!(
            result.errors[0].reason.contains("no supplier NAME"),
            "got: {}",
            result.errors[0].reason
        );
    }

    #[tokio::test]
    async fn execute_import_dry_run_writes_nothing() {
        // Input: a valid products CSV with dry_run = true.
        // Expected: counts reported, but zero rows actually written.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = "SKU,Product Name,Quantity\nA-1,Widget,5\nA-2,Widget Two,3\n";

        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Quantity", 2, "quantity_in_stock", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: true,
                file_name: None,
            },
        )
        .await
        .expect("dry run");

        assert_eq!(result.products_imported, 2);
        assert_eq!(result.rows_with_errors, 0);
        assert_eq!(result.job_id, None);

        let pool = app.state::<SqlitePool>();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(count, 0);
        let job_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_jobs")
            .fetch_one(&*pool)
            .await
            .expect("job count");
        assert_eq!(job_count, 0);
    }

    #[tokio::test]
    async fn rollback_import_reverts_imported_records() {
        // Input: products imported, then rollback_import on the job.
        // Expected: products/movements removed, job marked rolled_back.
        let app = owner_app().await;
        let company_id = current_company_id(&app).await;
        let csv = "SKU,Product Name,Quantity\nA-1,Widget,5\n";

        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Quantity", 2, "quantity_in_stock", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: Some("products.csv".to_string()),
            },
        )
        .await
        .expect("import");
        let job_id = result.job_id.expect("job id");
        // Wait for the background import to finish before checking state.
        let result = finish_job(&app, &job_id).await;
        assert_eq!(result.products_imported, 1);

        let pool = app.state::<SqlitePool>();
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(before, 1);

        let rollback = rollback_import(
            app.state(),
            app.state(),
            job_id.clone(),
        )
        .await
        .expect("rollback");

        assert_eq!(rollback.products_deleted, 1);
        assert!(rollback.movements_deleted >= 1);

        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM products WHERE company_id = ?")
            .bind(&company_id)
            .fetch_one(&*pool)
            .await
            .expect("count");
        assert_eq!(after, 0);

        let status: String =
            sqlx::query_scalar("SELECT status FROM import_jobs WHERE id = ?")
                .bind(&job_id)
                .fetch_one(&*pool)
                .await
                .expect("status");
        assert_eq!(status, "rolled_back");

        // A second rollback must be rejected.
        let err = rollback_import(app.state(), app.state(), job_id)
            .await
            .expect_err("second rollback should fail");
        assert!(err.contains("already been rolled back"), "got: {err}");
    }

    // ---------------------------------------------------------------
    // import job metadata: target / failed status / no job on setup
    // ---------------------------------------------------------------

    #[tokio::test]
    async fn import_job_records_target_and_is_listed() {
        // Input: import customers.
        // Expected: the created job lists target "customers" and the
        //           list_import_jobs command returns it with counts.
        let app = owner_app().await;
        let csv = "Customer Name,Email\nAcme Corp,a@b.com\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "customers".to_string(),
                mappings: vec![
                    mapping("Customer Name", 0, "customer_name", "core", "high"),
                    mapping("Email", 1, "customer_email", "core", "medium"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: Some("customers.csv".to_string()),
            },
        )
        .await
        .expect("import");
        let job_id = result.job_id.expect("job created");
        // Wait for the background import to finish so the job is "completed".
        let result = finish_job(&app, &job_id).await;
        assert_eq!(result.customers_imported, 1);

        let jobs = list_import_jobs(app.state(), app.state()).await.expect("list");
        let job = jobs.into_iter().find(|j| j.id == job_id).expect("job found");
        assert_eq!(job.target, "customers");
        assert_eq!(job.file_name.as_deref(), Some("customers.csv"));
        assert_eq!(job.status, "completed");
        assert_eq!(job.imported_records, 1);
        assert_eq!(job.error_rows, 0);
        assert!(job.rollback_available, "fresh job should be rollback-able");
    }

    #[tokio::test]
    async fn import_job_marked_failed_when_all_rows_error() {
        // Input: every row is missing a required field (no name mapping).
        // Expected: job status "failed" (not completed).
        let app = owner_app().await;
        let csv = "SKU,Product Name\nA-1,Widget\n";
        let result = confirm_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    // Only SKU mapped; required "name" is missing so the row
                    // fails validation.
                    mapping("SKU", 0, "sku", "core", "high"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: true,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");
        let job_id = result.job_id.expect("job created");
        // Wait for the background import to finish (job will be "failed").
        let result = finish_job(&app, &job_id).await;
        assert_eq!(result.products_imported, 0);
        assert!(result.rows_with_errors >= 1);

        let status: String = sqlx::query_scalar("SELECT status FROM import_jobs WHERE id = ?")
            .bind(&job_id)
            .fetch_one(&*app.state::<SqlitePool>())
            .await
            .expect("status");
        assert_eq!(status, "failed");
    }

    #[tokio::test]
    async fn setup_only_import_creates_no_job() {
        // Input: import_data = false (field/template setup only).
        // Expected: result.job_id is None and no import_jobs row exists.
        let app = owner_app().await;
        let csv = "SKU,Product Name,Flavor\nA-1,Widget,Vanilla\n";
        let result = execute_import(
            app.state(),
            app.state(),
            ImportRequest {
                target: "products".to_string(),
                mappings: vec![
                    mapping("SKU", 0, "sku", "core", "high"),
                    mapping("Product Name", 1, "name", "core", "high"),
                    mapping("Flavor", 2, "custom:flavor", "custom", "unknown"),
                ],
                file_bytes: csv.as_bytes().to_vec(),
                file_type: "csv".to_string(),
                template_name: String::new(),
                has_header_row: true,
                import_data: false,
                conflict_strategy: ConflictStrategy::default(),
                dry_run: false,
                file_name: None,
            },
        )
        .await
        .expect("import");
        assert!(result.job_id.is_none());

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_jobs")
            .fetch_one(&*app.state::<SqlitePool>())
            .await
            .expect("count");
        assert_eq!(count, 0);
    }

