# Ijaz & Company ERP — Sample Onboarding Files Guide

Welcome to **Ijaz & Company ERP**. This directory contains ready-to-use sample spreadsheets designed to help you test and explore all onboarding workflows (catalog creation, stock management, customer accounts, and supplier tracking) without having to manually type data.

---

## 📁 Available Sample Files

| Filename | Target Type | Contents |
| :--- | :--- | :--- |
| [`sample_products_pharma_fmcg.csv`](./sample_products_pharma_fmcg.csv) | **Products** | 15 realistic FMCG, grocery, and pharmacy items with SKUs, buying costs, retail sell prices, categories, and batch expiry dates. |
| [`sample_products_general_retail.csv`](./sample_products_general_retail.csv) | **Products** | 10 electronics, appliances, and POS hardware items (mice, chargers, receipt paper, cash drawers). |
| [`sample_customers.csv`](./sample_customers.csv) | **Customers** | 8 customer profiles with authentic Pakistani phone numbers (03xx), CNIC numbers, NTNs, and addresses across Karachi, Lahore, Rawalpindi, and Islamabad. |
| [`sample_suppliers.csv`](./sample_suppliers.csv) | **Suppliers** | 6 authentic distributor profiles (GSK, Engro, National Foods, Hamdard, Abbott, POS Tech) with sales contacts and tax numbers. |
| [`sample_opening_stock.csv`](./sample_opening_stock.csv) | **Opening Stock** | Starting inventory quantities and batch dates mapped to the existing product SKUs. |

---

## 🚀 How to Use with the Smart Import Dropzone

1. Open the ERP application.
2. In the left navigation menu, click **Import** (or in **Inventory**, click the **Import** button in the toolbar).
3. Select the appropriate target pill at the top:
   - Click `📦 Products` for product spreadsheets.
   - Click `👥 Customers` for customer lists.
   - Click `🏭 Suppliers` for distributor directories.
   - Click `📊 Opening Stock` for initial inventory counts.
4. **Drag and Drop** any of the sample `.csv` files into the large dropzone, or click **Choose Spreadsheet File** to browse.
5. The system will **automatically scan** headers and match them to the correct ERP fields.
6. Review the **Live 3-Row Item Cards Preview** to verify product names, prices, and gross margins.
7. Click **`🚀 Import Items Now`** to write the records directly to your local database.

---

## 💡 Customizing for Your Own Business

You can open any of these CSV files in **Microsoft Excel**, **Google Sheets**, or **LibreOffice Calc**:
1. Edit the names, prices, and stock numbers to match your actual shop inventory.
2. Ensure you keep the column headers in row 1:
   - For Products: `Product Name`, `SKU`, `Cost Price`, `Sell Price`, `Stock Quantity`, `Unit`, `Category`, `Supplier`, `Expiry Date`.
3. Save as `.csv` or `.xlsx`.
4. Drop into the ERP Import Dropzone!
