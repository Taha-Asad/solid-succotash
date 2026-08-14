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
        text: "Ijaz & Company ERP is a desktop application that keeps your whole business — inventory, invoicing, customers, purchasing and accounts — in one place. All data is stored locally on your computer, so it works offline and stays private.",
      },
      {
        type: "steps",
        items: [
          "Create a company (first launch)",
          "Add team members and sign in",
          "Add your products in Inventory",
          "Create your first invoice",
        ],
      },
      {
        type: "p",
        text: "Use the sidebar to navigate between workspaces. The top bar gives you global search, notifications, backup and settings at all times.",
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
        type: "p",
        text: "The Dashboard is your home screen. It summarizes the state of the business the moment you open the app.",
      },
      {
        type: "list",
        items: [
          "Today's sales and revenue",
          "Overdue and due invoices",
          "Low stock and expiring batches",
          "Top products and recent activity",
        ],
      },
      {
        type: "tip",
        text: "Click any notification to jump straight to the relevant invoice or product.",
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    blocks: [
      {
        type: "p",
        text: "Inventory is where you manage products, batches, stock levels and suppliers.",
      },
      {
        type: "steps",
        items: [
          "Add a product with name, SKU, price and units",
          "Optionally track batches with expiry dates",
          "Record stock-in and stock-out movements",
          "Set a minimum stock to receive low-stock alerts",
        ],
      },
      {
        type: "p",
        text: "You can import many products at once from an Excel file using the Import Wizard. It reads your columns, matches them to the app and reports any errors clearly.",
      },
      {
        type: "warn",
        text: "Stock movements affect your ledger. Double-check the movement type before saving.",
      },
    ],
  },
  {
    id: "invoices",
    title: "Invoices",
    blocks: [
      {
        type: "p",
        text: "Invoices follow a clear lifecycle: Draft → Finalized → Paid. Start a draft, add items, apply tax and discounts, then finalize to lock the numbers.",
      },
      {
        type: "list",
        items: [
          "Draft — editable, not yet final",
          "Finalized — locked and printable, can be marked as paid",
          "Paid — transaction complete, counted in reports",
        ],
      },
      {
        type: "p",
        text: "Numbering, tax fields (NTN / STRN / CNIC), due days and the invoice design are configured in Settings → Invoice Settings.",
      },
      {
        type: "tip",
        text: "Use the Excel template option to produce invoices in your own layout. Placeholders such as {{customer_name}} and {{grand_total}} are filled automatically.",
      },
    ],
  },
  {
    id: "customers",
    title: "Customers",
    blocks: [
      {
        type: "p",
        text: "The Customers page stores your customer directory. Each customer can have contact details, a credit limit and their own pricing.",
      },
      {
        type: "list",
        items: [
          "Add and edit customers",
          "See each customer's invoices and balances",
          "Track receivables — what customers owe you",
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
        type: "p",
        text: "Purchase orders track the orders you place with suppliers. Creating a PO records what you bought, at what cost and from whom.",
      },
      {
        type: "steps",
        items: [
          "Create a purchase order with a supplier",
          "Add the products and quantities",
          "Receive the order to update stock automatically",
          "Mark it as paid when you settle the bill",
        ],
      },
      {
        type: "p",
        text: "Receiving a purchase order increases your stock. Unreceived POs show the quantity still outstanding.",
      },
    ],
  },
  {
    id: "reports",
    title: "Reports & Analytics",
    blocks: [
      {
        type: "p",
        text: "Reports turn your data into decisions. Sales, stock, customers and profit analytics are all here, and every report can be exported.",
      },
      {
        type: "list",
        items: [
          "Sales and revenue trends",
          "Profit analysis",
          "Stock valuation and movement",
          "Top products and customers",
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
        type: "p",
        text: "The Accounts module is the bookkeeping side of the app: a chart of accounts and a journal of every financial movement.",
      },
      {
        type: "list",
        items: [
          "Chart of accounts",
          "Journal entries for every transaction",
          "Balances for each account",
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
        text: "Only the owner and admins can manage team members. Add employees and choose the right role for each.",
      },
      {
        type: "list",
        items: [
          "Owner — full access to everything",
          "Admin — manages users and settings",
          "Employee — day-to-day operations",
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
        type: "p",
        text: "Settings is where you configure the company. Some tabs are available only to the owner.",
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
      {
        type: "tip",
        text: "Each tab has its own Save button. Changes are applied per tab.",
      },
    ],
  },
  {
    id: "backups",
    title: "Backup & Restore",
    blocks: [
      {
        type: "p",
        text: "Your database lives on your computer. Back it up regularly so you never lose your business data.",
      },
      {
        type: "steps",
        items: [
          "Open Settings → Backup & Restore",
          "Click Create Backup... and choose a location (USB drive or cloud folder)",
          "Keep the backup file in a safe place",
        ],
      },
      {
        type: "warn",
        text: "Restoring replaces your current data. The app automatically creates a safety backup before restoring.",
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
