// ==========================================
// HELP / WIKI DOCUMENTATION CONTENT
// ==========================================
// Structured help content shown in the Help & Documentation page.
// Each section has a title + a list of blocks. Blocks come in five
// shapes: paragraph (p), bullet list (list), numbered steps (steps),
// tip and warning. Content is fully localized (en / ur).

import type { Lang } from "./translations";

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "howto"; title: string; items: string[] }
  | { type: "tip"; text: string }
  | { type: "warn"; text: string };

export interface HelpSection {
  id: string;
  title: string;
  blocks: HelpBlock[];
}

// ==========================================
// ENGLISH
// ==========================================

const EN: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    blocks: [
      {
        type: "p",
        text: "Ijaz & Company ERP keeps your whole business — inventory, invoicing, customers, purchasing and accounts — in one place. All data is stored locally on your computer, so it works offline and stays private.",
      },
      {
        type: "howto",
        title: "First-time setup: get your business running in 4 steps",
        items: [
          "On first launch, enter your company name, phone and address, then click Save.",
          "Go to Team in the sidebar and click Add User to create accounts for your staff.",
          "Sign in with your new username and password.",
          "Open Inventory from the sidebar and click Add Product to list what you sell.",
        ],
      },
      {
        type: "tip",
        text: "Open the Help menu anytime to replay the guided tour or jump back to this documentation.",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    blocks: [
      {
        type: "howto",
        title: "How to read your dashboard",
        items: [
          "Open Dashboard from the sidebar to see today's sales, revenue and unpaid invoices at a glance.",
          "Scroll down to find low-stock alerts — any product below its minimum stock level is flagged here.",
          "Check the overdue invoices card to see who owes you money and how many days overdue.",
          "Click any notification or stat card to jump straight to the relevant invoice, product or customer.",
        ],
      },
      {
        type: "tip",
        text: "The dashboard refreshes every time you open the app. For the latest numbers, close and reopen the Dashboard.",
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    blocks: [
      {
        type: "howto",
        title: "How to add a product",
        items: [
          "Open Inventory from the sidebar.",
          "Click the Add Product button above the product list.",
          "Fill in the product name, SKU (stock-keeping unit), selling price and initial quantity.",
          "Optionally set a category, supplier and minimum stock level for low-stock alerts.",
          "Click Save. The product now appears in your inventory and is available when creating invoices.",
        ],
      },
      {
        type: "howto",
        title: "How to import products from Excel or CSV",
        items: [
          "Open Inventory and click Import from Excel / CSV.",
          "Click Choose File and select your .xlsx or .csv file.",
          "The wizard shows a preview — map each column to the matching app field (name, price, quantity, etc.).",
          "Click Import. Any rows with errors are listed with clear messages so you can fix and re-import.",
        ],
      },
      {
        type: "howto",
        title: "How to record a stock movement",
        items: [
          "Open Inventory and find the product you want to adjust.",
          "Click the Stock Movement button (or open the product detail).",
          "Choose the movement type: Stock In (received from supplier) or Stock Out (sold, damaged, or sample).",
          "Enter the quantity and any notes, then click Save.",
        ],
      },
      {
        type: "warn",
        text: "Stock movements affect your accounting ledger. Double-check the movement type (in vs. out) before saving.",
      },
    ],
  },
  {
    id: "invoices",
    title: "Invoices",
    blocks: [
      {
        type: "howto",
        title: "How to create an invoice",
        items: [
          "Open Invoices from the sidebar.",
          "Click New Invoice.",
          "Select or type the customer name. The customer's details auto-fill.",
          "Add line items: pick a product from the dropdown, set quantity and unit price.",
          "Optionally set a discount percentage and tax rate.",
          "Click Save to create the draft. The invoice is now editable.",
        ],
      },
      {
        type: "howto",
        title: "How to finalize an invoice",
        items: [
          "Open the invoice detail view by clicking on a draft invoice in the list.",
          "Review all line items, quantities and totals to make sure everything is correct.",
          "Click the green Finalize Invoice button. The invoice is now locked and cannot be edited.",
          "To print, click the Print button in the top-right corner.",
        ],
      },
      {
        type: "howto",
        title: "How to mark an invoice as paid",
        items: [
          "Open a finalized invoice from the Invoices list.",
          "Click Mark as Paid. The invoice is now counted in your revenue reports.",
        ],
      },
      {
        type: "howto",
        title: "How to configure invoice numbering and tax fields",
        items: [
          "Open Settings from the sidebar and click the Invoice Settings tab.",
          "Set your invoice number prefix (e.g. INV-) and next number.",
          "Enter your NTN, STRN or CNIC if applicable — these appear on printed invoices.",
          "Choose the default number of due days and tax rate.",
          "Click Save to apply.",
        ],
      },
      {
        type: "tip",
        text: "Use the Excel template option to produce invoices in your own layout. Placeholders like {{customer_name}} and {{grand_total}} are filled automatically.",
      },
    ],
  },
  {
    id: "customers",
    title: "Customers",
    blocks: [
      {
        type: "howto",
        title: "How to add a customer",
        items: [
          "Open Customers from the sidebar.",
          "Click Add Customer.",
          "Enter the customer's name, phone number, email and address.",
          "Optionally set a credit limit — the system warns you if an invoice exceeds this amount.",
          "Click Save. The customer now appears in the customer list and in the invoice customer dropdown.",
        ],
      },
      {
        type: "howto",
        title: "How to view a customer's balance",
        items: [
          "Open Customers from the sidebar.",
          "Click on a customer name to open their detail view.",
          "You'll see their outstanding balance, total invoices and payment history.",
        ],
      },
      {
        type: "tip",
        text: "Search any customer instantly from the global search bar in the top bar.",
      },
    ],
  },
  {
    id: "purchasing",
    title: "Purchasing",
    blocks: [
      {
        type: "howto",
        title: "How to create a purchase order",
        items: [
          "Open Purchasing from the sidebar.",
          "Click New Purchase Order.",
          "Select or type the supplier name.",
          "Add line items: pick a product, set quantity and cost price per unit.",
          "Click Save to create the draft purchase order.",
        ],
      },
      {
        type: "howto",
        title: "How to receive a purchase order",
        items: [
          "Open an unreceived purchase order from the Purchasing list.",
          "Click Receive Order. Stock levels for all line items are increased automatically.",
        ],
      },
      {
        type: "howto",
        title: "How to mark a purchase order as paid",
        items: [
          "Open a received purchase order from the Purchasing list.",
          "Click Mark as Paid when you've settled the bill with the supplier.",
        ],
      },
    ],
  },
  {
    id: "reports",
    title: "Reports & Analytics",
    blocks: [
      {
        type: "howto",
        title: "How to view reports",
        items: [
          "Open Reports from the sidebar to see the available report types.",
          "Click a report card (Sales, Profit, Stock, Customers) to open it.",
          "Use the date-range filter at the top to focus on a specific period (today, this week, this month, custom range).",
          "Click Export to download the report as Excel or PDF.",
        ],
      },
      {
        type: "howto",
        title: "How to check your profit",
        items: [
          "Open Reports and click the Profit Analysis card.",
          "Set the date range to the period you want to review.",
          "The report shows revenue, cost of goods sold and net profit for the selected period.",
        ],
      },
      {
        type: "tip",
        text: "Use the date-range filters to focus on a specific period such as a month or a quarter.",
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    blocks: [
      {
        type: "howto",
        title: "How to view the chart of accounts",
        items: [
          "Open Accounts from the sidebar.",
          "You'll see the full chart of accounts — assets, liabilities, equity, income and expense categories.",
          "Click any account to see its transaction history and current balance.",
        ],
      },
      {
        type: "howto",
        title: "How to understand journal entries",
        items: [
          "Journal entries are created automatically whenever you create an invoice, record a payment or move stock.",
          "Open Accounts and click Journal Entries to see the full list.",
          "Each entry shows the debit and credit sides, the date, and which transaction generated it.",
        ],
      },
      {
        type: "warn",
        text: "Journal entries are created automatically by invoices and stock movements. Editing them manually requires care and accounting knowledge.",
      },
    ],
  },
  {
    id: "team",
    title: "Team & User Roles",
    blocks: [
      {
        type: "p",
        text: "Only the owner and admins can manage team members.",
      },
      {
        type: "howto",
        title: "How to add a team member",
        items: [
          "Open Team from the sidebar.",
          "Click Add User.",
          "Enter the new user's name, email and password.",
          "Choose a role: Owner (full access), Admin (manages users and settings), or Employee (day-to-day operations).",
          "Click Save. The new user can now sign in with their credentials.",
        ],
      },
      {
        type: "howto",
        title: "How to change a user's role",
        items: [
          "Open Team from the sidebar.",
          "Find the user in the list and click the Edit (pencil) icon.",
          "Change the Role dropdown to the new role.",
          "Click Save.",
        ],
      },
      {
        type: "tip",
        text: "Every user has their own login and password. Keep your credentials private and secure.",
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    blocks: [
      {
        type: "howto",
        title: "How to update your company profile",
        items: [
          "Open Settings from the sidebar.",
          "On the Company Profile tab, update your company name, phone, address and currency.",
          "Click Save Changes at the bottom of the tab.",
        ],
      },
      {
        type: "howto",
        title: "How to change the invoice design",
        items: [
          "Open Settings and click the Invoice Settings tab.",
          "Scroll to the Invoice Design section.",
          "Choose a layout template and customize colors, fonts and the logo.",
          "Click Save to apply the new design to all future invoices.",
        ],
      },
      {
        type: "howto",
        title: "How to change the app language",
        items: [
          "Open Settings and click the Language tab.",
          "Select your preferred language from the dropdown.",
          "Click Save. The interface updates immediately.",
        ],
      },
      {
        type: "list",
        items: [
          "Company Profile — name, contact, currency",
          "Invoice Settings — numbering, tax fields, design",
          "Theme & Branding — colors, logo, tagline",
          "Data Retention — archive old records",
          "Audit Log — a history of who did what",
          "Language — choose the interface language",
        ],
      },
    ],
  },
  {
    id: "backups",
    title: "Backup & Restore",
    blocks: [
      {
        type: "howto",
        title: "How to create a backup",
        items: [
          "Open Settings from the sidebar and click the Backup & Restore tab.",
          "Click Create Backup.",
          "Choose a save location — use a USB drive or cloud folder (Google Drive, Dropbox) for safety.",
          "The backup file is saved. Keep it in a safe place.",
        ],
      },
      {
        type: "howto",
        title: "How to restore from a backup",
        items: [
          "Open Settings and click the Backup & Restore tab.",
          "Click Restore from Backup and select your backup file.",
          "The app automatically creates a safety backup of your current data before restoring.",
          "Confirm the restore. Your data is replaced with the backup contents.",
        ],
      },
      {
        type: "warn",
        text: "Restoring replaces your current data. The app automatically creates a safety backup before restoring, but always keep a recent backup file handy.",
      },
      {
        type: "tip",
        text: "Back up at least weekly, or after every major change to your records.",
      },
    ],
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    blocks: [
      {
        type: "list",
        items: [
          "Where is my data stored? Locally on this computer.",
          "Is an internet connection required? No — everything works offline.",
          "Can a finalized invoice be edited? No — it must be cancelled or reversed instead.",
          "How do I get the Urdu interface? Use the language menu in the top bar, or Settings → Language.",
          "How do I recover lost data? Restore from your latest backup file.",
        ],
      },
    ],
  },
];

// ==========================================
// URDU (اردو)
// ==========================================

const UR: HelpSection[] = [
  {
    id: "getting-started",
    title: "شروع کرنا",
    blocks: [
      {
        type: "p",
        text: "آئی جاز اینڈ کمپنی ای آر پی ایک ڈیسک ٹاپ ایپلیکیشن ہے جو آپ کے پورے کاروبار — انوینٹری، انوائسنگ، گاہک، خریداری اور اکاؤنٹس — کو ایک جگہ رکھتی ہے۔ تمام ڈیٹا آپ کے کمپیوٹر پر مقامی طور پر محفوظ ہوتا ہے، اس لیے یہ آف لائن چلتا ہے اور نجی رہتا ہے۔",
      },
      {
        type: "steps",
        items: [
          "کمپنی بنائیں (پہلی بار لانچ پر)",
          "ٹیم کے اراکین شامل کریں اور سائن ان کریں",
          "انوینٹری میں اپنی مصنوعات شامل کریں",
          "اپنی پہلی انوائس بنائیں",
        ],
      },
      {
        type: "p",
        text: "ورک اسپیسز کے درمیان جانے کے لیے سائیڈ بار استعمال کریں۔ ٹاپ بار میں ہر وقت گلوبل تلاش، اطلاعات، بیک اپ اور ترتیبات دستیاب رہتی ہیں۔",
      },
      {
        type: "tip",
        text: "گائیڈڈ ٹیوٹوریل دوبارہ چلانے یا اس دستاویز پر واپس جانے کے لیے کسی بھی وقت مدد مینو کھولیں۔",
      },
    ],
  },
  {
    id: "dashboard",
    title: "ڈیش بورڈ",
    blocks: [
      {
        type: "p",
        text: "ڈیش بورڈ آپ کی ہوم اسکرین ہے۔ یہ ایپ کھولتے ہی کاروبار کی حالت کا خلاصہ دکھاتا ہے۔",
      },
      {
        type: "list",
        items: [
          "آج کی سیلز اور ریونیو",
          "بقایا اور واجب الادا انوائسز",
          "کم اسٹاک اور ختم ہونے والے بیچز",
          "ٹاپ مصنوعات اور حالیہ سرگرمی",
        ],
      },
      {
        type: "tip",
        text: "کسی بھی اطلاع پر کلک کریں تاکہ براہ راست متعلقہ انوائس یا مصنوعات پر پہنچ جائیں۔",
      },
    ],
  },
  {
    id: "inventory",
    title: "انوینٹری",
    blocks: [
      {
        type: "p",
        text: "انوینٹری وہ جگہ ہے جہاں آپ مصنوعات، بیچز، اسٹاک لیولز اور سپلائرز کا انتظام کرتے ہیں۔",
      },
      {
        type: "steps",
        items: [
          "نام، SKU، قیمت اور اکائیوں کے ساتھ مصنوعات شامل کریں",
          "اختیاری طور پر میعاد ختم ہونے کی تاریخ کے ساتھ بیچز کا سراغ رکھیں",
          "اسٹاک کی آمد اور روانگی ریکارڈ کریں",
          "کم اسٹاک الرٹس کے لیے کم از کم اسٹاک مقرر کریں",
        ],
      },
      {
        type: "p",
        text: "آپ امپورٹ وزرڈ کے ذریعے ایکسل فائل سے ایک ساتھ بہت سی مصنوعات امپورٹ کر سکتے ہیں۔ یہ آپ کے کالمز پڑھتا ہے، ایپ سے میل کرتا ہے اور کسی بھی غلطی کی واضح اطلاع دیتا ہے۔",
      },
      {
        type: "warn",
        text: "اسٹاک کی حرکت آپ کے لیجر کو متاثر کرتی ہے۔ محفوظ کرنے سے پہلے حرکت کی قسم دوبارہ چیک کریں۔",
      },
    ],
  },
  {
    id: "invoices",
    title: "انوائسز",
    blocks: [
      {
        type: "p",
        text: "انوائسز واضح مراحل پر چلتی ہیں: ڈرافٹ → حتمی → ادا شدہ۔ ڈرافٹ شروع کریں، اشیاء شامل کریں، ٹیکس اور چھوٹ لگائیں، پھر حتمی کر کے نمبرز لاک کریں۔",
      },
      {
        type: "list",
        items: [
          "ڈرافٹ — قابل تدوین، ابھی حتمی نہیں",
          "حتمی — لاک شدہ اور پرنٹ ایبل، ادا شدہ نشان لگایا جا سکتا ہے",
          "ادا شدہ — لین دین مکمل، رپورٹس میں شمار",
        ],
      },
      {
        type: "p",
        text: "نمبرنگ، ٹیکس فیلڈز (NTN / STRN / CNIC)، ادائیگی کے دن اور انوائس کا ڈیزائن ترتیبات → انوائس کی ترتیبات میں ترتیب دیا جاتا ہے۔",
      },
      {
        type: "tip",
        text: "اپنے لے آؤٹ میں انوائس بنانے کے لیے ایکسل ٹیمپلیٹ آپشن استعمال کریں۔ {{customer_name}} اور {{grand_total}} جیسے پلیس ہولڈرز خودکار بھر جاتے ہیں۔",
      },
    ],
  },
  {
    id: "customers",
    title: "گاہک",
    blocks: [
      {
        type: "p",
        text: "گاہک صفحہ آپ کی گاہکوں کی فہرست محفوظ رکھتا ہے۔ ہر گاہک کے لیے رابطہ تفصیلات، کریڈٹ کی حد اور اپنی قیمتیں ہو سکتی ہیں۔",
      },
      {
        type: "list",
        items: [
          "گاہک شامل کریں اور تدوین کریں",
          "ہر گاہک کی انوائسز اور بیلنس دیکھیں",
          "وصولیاں — گاہکوں کے ذمے رقم کا سراغ رکھیں",
        ],
      },
      {
        type: "tip",
        text: "ٹاپ بار میں گلوبل تلاش کے ذریعے کسی بھی گاہک کو فوری تلاش کریں۔",
      },
    ],
  },
  {
    id: "purchasing",
    title: "خریداری",
    blocks: [
      {
        type: "p",
        text: "پرچیز آرڈرز سپلائرز سے کیے گئے آرڈرز کا سراغ رکھتے ہیں۔ پی او بنانے سے معلوم ہوتا ہے کہ آپ نے کیا، کس قیمت پر اور کس سے خریدا۔",
      },
      {
        type: "steps",
        items: [
          "سپلائر کے ساتھ پرچیز آرڈر بنائیں",
          "مصنوعات اور مقدار شامل کریں",
          "آرڈر وصول کریں تاکہ اسٹاک خودکار اپ ڈیٹ ہو",
          "بل ادا کرنے پر ادا شدہ نشان لگائیں",
        ],
      },
      {
        type: "p",
        text: "پرچیز آرڈر وصول کرنے سے آپ کا اسٹاک بڑھ جاتا ہے۔ غیر وصول شدہ پی اوز میں ابھی باقی مقدار ظاہر ہوتی ہے۔",
      },
    ],
  },
  {
    id: "reports",
    title: "رپورٹس اور تجزیات",
    blocks: [
      {
        type: "p",
        text: "رپورٹس آپ کے ڈیٹا کو فیصلوں میں بدلتی ہیں۔ سیلز، اسٹاک، گاہک اور منافع کے تجزیات سب یہاں ہیں، اور ہر رپورٹ ایکسپورٹ کی جا سکتی ہے۔",
      },
      {
        type: "list",
        items: [
          "سیلز اور ریونیو رجحانات",
          "منافع کا تجزیہ",
          "اسٹاک کی مالیت اور حرکت",
          "ٹاپ مصنوعات اور گاہک",
        ],
      },
      {
        type: "tip",
        text: "کسی مخصوص مدت جیسے مہینہ یا سہ ماہی پر توجہ دینے کے لیے تاریخ کی رینج فلٹر استعمال کریں۔",
      },
    ],
  },
  {
    id: "accounts",
    title: "اکاؤنٹس",
    blocks: [
      {
        type: "p",
        text: "اکاؤنٹس ماڈیول ایپ کا حساب کتاب حصہ ہے: چارٹ آف اکاؤنٹس اور ہر مالی حرکت کا جرنل۔",
      },
      {
        type: "list",
        items: [
          "چارٹ آف اکاؤنٹس",
          "ہر لین دین کے جرنل اندراجات",
          "ہر اکاؤنٹ کا بیلنس",
        ],
      },
      {
        type: "warn",
        text: "جرنل اندراجات انوائسز اور اسٹاک کی حرکت سے خودکار بنتے ہیں۔ دستی تدوین کے لیے احتیاط اور حساب کتاب کی سمجھ درکار ہے۔",
      },
    ],
  },
  {
    id: "team",
    title: "ٹیم اور صارف کے کردار",
    blocks: [
      {
        type: "p",
        text: "صرف مالک اور ایڈمنز ٹیم کے اراکین کا انتظام کر سکتے ہیں۔ ملازمین شامل کریں اور ہر ایک کے لیے صحیح کردار منتخب کریں۔",
      },
      {
        type: "list",
        items: [
          "مالک — ہر چیز تک مکمل رسائی",
          "ایڈمن — صارفین اور ترتیبات کا انتظام",
          "ملازم — روزمرہ کے کام",
        ],
      },
      {
        type: "tip",
        text: "ہر صارف کا اپنا لاگ ان اور پاس ورڈ ہوتا ہے۔ اپنی اسناد نجی اور محفوظ رکھیں۔",
      },
    ],
  },
  {
    id: "settings",
    title: "ترتیبات",
    blocks: [
      {
        type: "p",
        text: "ترتیبات وہ جگہ ہے جہاں آپ کمپنی کو ترتیب دیتے ہیں۔ کچھ ٹیب صرف مالک کے لیے دستیاب ہیں۔",
      },
      {
        type: "list",
        items: [
          "کمپنی پروفائل — نام، رابطہ، کرنسی",
          "انوائس کی ترتیبات — نمبرنگ، ٹیکس فیلڈز، ڈیزائن",
          "تھیم اور برانڈنگ — رنگ، لوگو، ٹیگ لائن",
          "ڈیٹا رکھنے کی پالیسی — پرانے ریکارڈ آرکائیو",
          "آڈٹ لاگ — کس نے کیا کیا کی تاریخ",
          "زبان — انٹرفیس کی زبان منتخب کریں",
        ],
      },
      {
        type: "tip",
        text: "ہر ٹیب کا اپنا محفوظ بٹن ہے۔ تبدیلیاں ٹیب کے لحاظ سے لاگو ہوتی ہیں۔",
      },
    ],
  },
  {
    id: "backups",
    title: "بیک اپ اور بحالی",
    blocks: [
      {
        type: "p",
        text: "آپ کا ڈیٹا بیس آپ کے کمپیوٹر پر ہے۔ اسے باقاعدگی سے بیک اپ کریں تاکہ آپ کا کاروباری ڈیٹا کبھی ضائع نہ ہو۔",
      },
      {
        type: "steps",
        items: [
          "ترتیبات → بیک اپ اور بحالی کھولیں",
          "'بیک اپ بنائیں...' پر کلک کریں اور مقام منتخب کریں (USB یا کلاؤڈ فولڈر)",
          "بیک اپ فائل محفوظ جگہ پر رکھیں",
        ],
      },
      {
        type: "warn",
        text: "بحالی آپ کے موجودہ ڈیٹا کو بدل دیتی ہے۔ ایپ بحالی سے پہلے خودکار طور پر سیفٹی بیک اپ بناتی ہے۔",
      },
      {
        type: "tip",
        text: "کم از کم ہفتہ وار بیک اپ کریں، یا اپنے ریکارڈ میں ہر بڑی تبدیلی کے بعد۔",
      },
    ],
  },
  {
    id: "faq",
    title: "اکثر پوچھے گئے سوالات",
    blocks: [
      {
        type: "list",
        items: [
          "میرا ڈیٹا کہاں محفوظ ہے؟ اس کمپیوٹر پر مقامی طور پر۔",
          "کیا انٹرنیٹ کنکشن ضروری ہے؟ نہیں — سب کچھ آف لائن چلتا ہے۔",
          "کیا حتمی شدہ انوائس میں ترمیم ہو سکتی ہے؟ نہیں — اسے منسوخ یا ریورس کرنا ہوتا ہے۔",
          "اردو انٹرفیس کیسے ملے گا؟ ٹاپ بار میں زبان کا مینو استعمال کریں، یا ترتیبات → زبان۔",
          "ضائع شدہ ڈیٹا کیسے واپس ملے گا؟ اپنی تازہ ترین بیک اپ فائل سے بحال کریں۔",
        ],
      },
    ],
  },
];

export function getHelpDocs(lang: Lang): HelpSection[] {
  return lang === "ur" ? UR : EN;
}
