// ==========================================
// INTERNATIONALIZATION — LANGUAGE META + DICTIONARIES
// ==========================================
//
// Two languages today: English (LTR) and Urdu (RTL).
// Keys are flat dot-notation strings. `t()` looks up the
// active language first, falls back to English, then to the key.
// Params like {v}, {company} are replaced at call time.

export type Lang = "en" | "ur";

export const LANG_STORAGE_KEY = "ijaz_lang";

export interface LangMeta {
  code: Lang;
  label: string; // English label
  native: string; // written in its own script
  dir: "ltr" | "rtl";
}

export const LANGUAGES: Record<Lang, LangMeta> = {
  en: { code: "en", label: "English", native: "English", dir: "ltr" },
  ur: { code: "ur", label: "Urdu", native: "اردو", dir: "rtl" },
};

export const LANGUAGE_ORDER: Lang[] = ["en", "ur"];

type Dict = Record<string, string>;

// ==========================================
// ENGLISH (SOURCE OF TRUTH)
// ==========================================

export const en: Dict = {
  // ---------- Common ----------
  "common.loading": "Loading...",
  "common.saving": "Saving...",
  "common.save": "Save Changes",
  "common.saveSettings": "Save Settings",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.back": "Back",
  "common.next": "Next",
  "common.skip": "Skip",
  "common.finish": "Finish",
  "common.search": "Search",
  "common.done": "Done",

  // ---------- App shell / navigation ----------
  "nav.workspace": "WORKSPACE",
  "nav.home": "Dashboard",
  "nav.homeDesc": "Overview & analytics",
  "nav.inventory": "Inventory",
  "nav.inventoryDesc": "Products, stock & suppliers",
  "nav.invoices": "Invoices",
  "nav.invoicesDesc": "Bills, payments & customers",
  "nav.customers": "Customers",
  "nav.customersDesc": "Customer directory & accounts",
  "nav.purchasing": "Purchasing",
  "nav.purchasingDesc": "Purchase orders from suppliers",
  "nav.import": "Import",
  "nav.importDesc": "Import customers, products & more from Excel/CSV",
  "nav.reports": "Reports",
  "nav.reportsDesc": "Sales, stock & profit analytics",
  "nav.accounts": "Accounts",
  "nav.accountsDesc": "Chart of accounts & journal",
  "nav.users": "Team",
  "nav.usersDesc": "Manage company users",
  "nav.settings": "Settings",
  "nav.settingsDesc": "Profile, invoices, backups & audit",
  "nav.help": "Help",
  "nav.helpDesc": "How to use this software",
  "sidebar.signOut": "Sign out",

  // ---------- Top bar ----------
  "topbar.backup": "Backup",
  "topbar.backupTooltip": "Backup database",
  "topbar.settings": "Settings",
  "topbar.settingsTooltip": "Settings",
  "topbar.updateAvailable": "New version {v} available",
  "topbar.update": "Update v{version}",
  "topbar.themeTooltipLight": "Switch to light mode",
  "topbar.themeTooltipDark": "Switch to dark mode",
  "topbar.language": "Language",

  // ---------- Global search ----------
  "search.placeholder": "Search products, customers...",
  "search.products": "Products",
  "search.customers": "Customers",
  "search.noResults": "No results for \"{query}\"",
  "search.tryHint": "Try a product name, SKU, or customer name.",

  // ---------- Notifications ----------
  "notifications.title": "Notifications",
  "notifications.allClear": "All clear — no alerts",
  "notifications.viewInventory": "View Inventory",
  "notifications.markAllRead": "Mark all as read",

  // ---------- Update modal ----------
  "update.title": "Update available",
  "update.bodyIntro":
    "Version {v} is available. You are running v{current}.",
  "update.download": "Download & Install",
  "update.installing": "Update installed. The app will restart shortly.",
  "update.restartNote":
    "The app will close and restart after the update is installed. Your data is preserved.",

  // ---------- Backup ----------
  "backup.title": "Save Backup",
  "backup.success": "Backup saved: {path}",
  "backup.error": "Error: {err}",

  // ---------- Help menu ----------
  "help.menuLabel": "Help",
  "help.docs": "Help & Documentation",
  "help.replay": "Replay Tutorial",
  "help.about": "About",

  // ---------- Language ----------
  "lang.title": "Language",
  "lang.label": "App language",
  "lang.settingsIntro":
    "Choose the language used for the interface and help documentation.",
  "lang.note":
    "Content created by your team (products, invoices, customers) stays exactly as entered, regardless of the interface language.",

  // ---------- Tour ----------
  "tour.skip": "Skip tour",
  "tour.next": "Next",
  "tour.back": "Back",
  "tour.finish": "Got it",
  "tour.stepXofY": "Step {current} of {total}",
  "tour.waiting": "Waiting for you…",
  "import.backTo": "Back to {view}",
  "tour.completed": "Done!",
  "tour.continue": "Continue",

  // ---------- Onboarding tutorial ----------
  "onb.login.title": "Sign in to your workspace",
  "onb.login.content":
    "Welcome! Before you can manage your business, sign in with your user name and password.",
  "onb.login.hint": "Enter your username and password, then press Sign In.",
  "onb.welcome.title": "Welcome to your workspace",
  "onb.welcome.content":
    "This tutorial teaches you the app by having you do the work yourself. Complete each small task to unlock the next step. Let's begin!",
  "onb.navInventory.title": "Open Inventory",
  "onb.navInventory.content":
    "Inventory is where you store everything you sell or buy. Let's open it now.",
  "onb.navInventory.hint": "Click \u201CInventory\u201D in the sidebar on the left.",
  "onb.inventoryOverview.title": "Your inventory",
  "onb.inventoryOverview.content":
    "This is your Inventory page. You can add products, import from Excel, and track stock levels here. On the right you can search and add products.",
  "onb.addProduct.title": "Add your first product",
  "onb.addProduct.content":
    "Let's add a real product to your inventory. Click the button below to open the form, then fill in the name, price and quantity.",
  "onb.addProduct.hint": "Click the \u201CAdd Product\u201D button above the product list.",
  "onb.import.title": "Import your existing data",
  "onb.import.content":
    "If you already have products in Excel or CSV, you can import them all at once. Click the button below to open the import wizard, then select your file.",
  "onb.import.hint": "Click \u201CImport from Excel / CSV\u201D, then select your file and complete the wizard.",
  "onb.navInvoices.title": "Open Invoices",
  "onb.navInvoices.content":
    "Next stop: billing. This is where you create the invoices your customers pay.",
  "onb.navInvoices.hint": "Click \u201CInvoices\u201D in the sidebar on the left.",
  "onb.createInvoice.title": "Create an invoice",
  "onb.createInvoice.content":
    "Create your first invoice now. Click the button below, pick a customer, add products and quantities, then save.",
  "onb.createInvoice.hint": "Click \u201CNew Invoice\u201D, fill in the form, and click Save.",
  "onb.finalizeInvoice.title": "Finalize your invoice",
  "onb.finalizeInvoice.content":
    "Your draft invoice is ready. Click the green \u201CFinalize Invoice\u201D button to lock it as a real, collectable invoice.",
  "onb.finalizeInvoice.hint": "Click \u201CFinalize Invoice\u201D to complete this step.",
  "onb.navSettings.title": "Open Settings",
  "onb.navSettings.content":
    "Last stop: Settings. Here you manage your company profile, invoice look, backups and more.",
  "onb.navSettings.hint": "Click \u201CSettings\u201D in the sidebar on the left.",
  "onb.updateCompany.title": "Update your company profile",
  "onb.updateCompany.content":
    "Make sure your business looks professional: enter your company name, phone number and address, then click Save.",
  "onb.updateCompany.hint": "Type in the Company Profile form, then click \u201CSave Changes\u201D.",
  "onb.done.title": "You're all set!",
  "onb.done.content":
    "That's it \u2014 you now know how to run the core of your business. You can replay this tutorial any time from the Help menu. Happy selling!",

  // ---------- Help page ----------
  "help.title": "Help & Documentation",
  "help.subtitle":
    "Everything you need to know to run your business in {company}.",
  "help.searchPlaceholder": "Search help topics...",
  "help.toc": "Contents",
  "help.quickStart": "Quick Start",
  "help.noResults": "No topics match your search.",
  "help.tryAnother": "Try a different keyword, e.g. \"invoice\" or \"backup\".",
  "help.tip": "Tip",
  "help.warning": "Important",

  // ---------- Settings ----------
  "settings.title": "Settings",
  "settings.tab.company": "Company Profile",
  "settings.tab.invoice": "Invoice Settings",
  "settings.tab.theme": "Theme & Branding",
  "settings.tab.backup": "Backup & Restore",
  "settings.tab.retention": "Data Retention",
  "settings.tab.audit": "Audit Log",
  "settings.tab.language": "Language",

  // ---------- Login ----------
  "login.heroTitle": "Your business, in perfect order.",
  "login.heroSubtitle":
    "Ijaz & Company ERP brings inventory, invoicing and analytics into one clean workspace — designed for precision, built for growth.",
  "login.feat1.title": "Inventory Control",
  "login.feat1.text": "Track products, batches, stock levels and suppliers.",
  "login.feat2.title": "Smart Invoicing",
  "login.feat2.text": "Draft → finalize → paid lifecycle with tax & discounts.",
  "login.feat3.title": "Business Analytics",
  "login.feat3.text": "Live revenue trends, top products and profit insights.",
  "login.privateData":
    "Your data stays local and private on your machine.",
  "login.welcome": "Welcome back",
  "login.signinTitle": "Sign in to your workspace",
  "login.signinSubtitle": "Enter your credentials to continue.",
  "login.email": "Email",
  "login.emailPlaceholder": "you@company.com",
  "login.password": "Password",
  "login.passwordPlaceholder": "Your password",
  "login.signIn": "Sign In",

  // ---------- Setup ----------
  "setup.heroTitle": "Set up your company in under a minute.",
  "setup.heroSubtitle":
    "Register your business details and an owner account. You'll be signed in immediately and ready to start running your operations.",
  "setup.step1.title": "Company information",
  "setup.step1.text": "Name, currency and tax identifiers.",
  "setup.step2.title": "Owner account",
  "setup.step2.text": "Your personal login with secure password.",
  "setup.step3.title": "Start working",
  "setup.step3.text": "Auto sign-in straight to your dashboard.",
  "setup.singleTenant":
    "Only one company per installation — single-tenant by design.",
  "setup.firstLaunch": "First launch",
  "setup.createWorkspace": "Create your workspace",
  "setup.ownerNote": "You'll become the owner of this company.",
  "setup.companyInfo": "Company Information",
  "setup.companyName": "Company Name",
  "setup.companyNamePlaceholder": "Ijaz & Company",
  "setup.phone": "Phone",
  "setup.phonePlaceholder": "+92 300 1234567",
  "setup.taxNumber": "Tax Number",
  "setup.taxNumberPlaceholder": "NTN or STRN",
  "setup.address": "Address",
  "setup.addressPlaceholder": "Lahore, Punjab, Pakistan",
  "setup.currency": "Currency",
  "setup.ownerAccount": "Owner Account",
  "setup.fullName": "Your Full Name",
  "setup.fullNamePlaceholder": "Ijaz Ahmad",
  "setup.email": "Email",
  "setup.emailPlaceholder": "owner@ijaz.com",
  "setup.password": "Password",
  "setup.passwordPlaceholder": "Choose a strong password",
  "setup.createCompany": "Create Company & Continue",

  // ---------- Super Admin Platform ----------
  "sa.subtitle": "Command Center",
  "sa.logout": "Sign out",
  "sa.nav.overview": "Overview",
  "sa.nav.tenants": "Tenants",
  "sa.nav.packages": "Packages",
  "sa.nav.analytics": "Analytics",
  "sa.nav.settings": "Settings",
  "sa.title.overview": "Platform Overview",
  "sa.title.tenants": "Tenant Management",
  "sa.title.packages": "Subscription Packages",
  "sa.title.analytics": "Platform Analytics",
  "sa.title.settings": "Platform Settings",
  "sa.common.cancel": "Cancel",
  "sa.common.save": "Save",
  "sa.status.active": "Active",
  "sa.status.archived": "Archived",
  "sa.sub.active": "Active",
  "sa.sub.trial": "Trial",
  "sa.sub.past_due": "Past due",
  "sa.sub.suspended": "Suspended",
  "sa.sub.cancelled": "Cancelled",
  "sa.sub.ended": "Ended",
  "sa.module.dashboard": "Dashboard",
  "sa.module.inventory": "Inventory",
  "sa.module.sales": "Sales",
  "sa.module.purchases": "Purchases",
  "sa.module.reports": "Reports",
  "sa.module.employees": "Employees",
  "sa.module.branches": "Branches",
  "sa.module.invoices": "Invoices",
  "sa.module.import": "Import",
  "sa.module.dataImport": "Data Import",

  // Overview
  "sa.overview.heroTitle": "Oversee every workspace from one command center.",
  "sa.overview.heroSubtitle":
    "Register tenants, assign packages and manage subscription health across your entire platform — all in real time.",
  "sa.overview.newTenant": "New Tenant",
  "sa.overview.managePackages": "Manage Packages",
  "sa.overview.stat.tenants": "Total Tenants",
  "sa.overview.stat.active": "Active Workspaces",
  "sa.overview.stat.users": "Total Users",
  "sa.overview.stat.packages": "Packages",
  "sa.overview.recent": "Recent Tenants",
  "sa.overview.viewAll": "View all",
  "sa.overview.empty": "No tenants yet — register your first workspace.",
  "sa.overview.usersShort": "users",

  // Analytics
  "sa.analytics.subtitle": "Cross-workspace platform health and revenue signals.",
  "sa.analytics.mrr": "Monthly Recurring Revenue",
  "sa.analytics.totalTenants": "Total Tenants",
  "sa.analytics.activeTenants": "Active Workspaces",
  "sa.analytics.totalUsers": "Total Users",
  "sa.analytics.growth": "Tenant Growth (last 12 months)",
  "sa.analytics.byStatus": "Subscription Status",
  "sa.analytics.byPackage": "Tenants by Package",
  "sa.analytics.noData": "No analytics data yet.",

  // Settings
  "sa.settings.subtitle": "Configure platform behavior and appearance.",
  "sa.settings.theme": "Platform Theme",
  "sa.settings.themeDesc": "Applies to the entire platform console.",
  "sa.settings.dark": "Obsidian (Dark)",
  "sa.settings.light": "Daylight (Light)",
  "sa.settings.language": "Interface Language",
  "sa.settings.languageDesc": "Switch between supported languages.",
  "sa.settings.about": "About",
  "sa.settings.aboutDesc": "Platform build and version information.",
  "sa.settings.version": "Version",
  "sa.settings.build": "Build",
  "sa.settings.channel": "Channel",
  "sa.settings.stable": "Stable",
  "sa.settings.saved": "Saved",

  // Tenants
  "sa.tenants.searchPh": "Search by name or email...",
  "sa.tenants.filter.all": "All",
  "sa.tenants.filter.active": "Active",
  "sa.tenants.filter.archived": "Archived",
  "sa.tenants.refresh": "Refresh",
  "sa.tenants.registerButton": "Register Tenant",
  "sa.tenants.empty": "No tenants match your search.",
  "sa.tenants.archive": "Archive",
  "sa.tenants.activate": "Activate",
  "sa.tenants.register.title": "Register a New Tenant",
  "sa.tenants.register.subtitle":
    "Creates the company, admin account, subscription and default modules in one step.",
  "sa.tenants.register.companySection": "Company",
  "sa.tenants.register.companyName": "Company name",
  "sa.tenants.register.companyNamePh": "e.g. Al-Noor Traders",
  "sa.tenants.register.package": "Package",
  "sa.tenants.register.packagePh": "Choose a package",
  "sa.tenants.register.phone": "Phone",
  "sa.tenants.register.address": "Address",
  "sa.tenants.register.taxNumber": "Tax number",
  "sa.tenants.register.province": "Province",
  "sa.tenants.register.currency": "Currency",
  "sa.tenants.register.adminSection": "Owner Account",
  "sa.tenants.register.adminName": "Full name",
  "sa.tenants.register.adminEmail": "Email",
  "sa.tenants.register.adminPassword": "Password",
  "sa.tenants.register.required": "Company name, owner name, email and password are required.",
  "sa.tenants.register.needPackage": "Please choose a package.",
  "sa.tenants.register.create": "Create Tenant",
  "sa.tenants.detail.subscription": "Subscription",
  "sa.tenants.detail.package": "Package",
  "sa.tenants.detail.price": "Price",
  "sa.tenants.detail.period": "Current period",
  "sa.tenants.detail.trial": "Trial ends",
  "sa.tenants.detail.noSubscription": "No subscription assigned yet.",
  "sa.tenants.detail.modules": "Modules",
  "sa.tenants.detail.featureFlags": "Feature Flags",
  "sa.tenants.detail.noFlags": "No feature flags set.",
  "sa.tenants.register.createdTitle": "Tenant created!",
  "sa.tenants.register.createdSubtitle": "Company and owner account are ready.",
  "sa.tenants.register.done": "Done",
  "sa.tenants.edit.button": "Edit Company",
  "sa.tenants.edit.title": "Edit Company",
  "sa.tenants.edit.save": "Save Changes",
  "sa.tenants.edit.saved": "Company updated successfully.",

  // Packages
  "sa.packages.subtitle":
    "Define the plans tenants subscribe to — limits, billing and features.",
  "sa.packages.create": "New Package",
  "sa.packages.edit": "Edit",
  "sa.packages.delete": "Delete",
  "sa.packages.deleteConfirm": "Delete this package? Existing subscriptions keep running but it will no longer be selectable.",
  "sa.packages.name": "Package name",
  "sa.packages.nameRequired": "Package name must be at least 2 characters.",
  "sa.packages.description": "Description",
  "sa.packages.price": "Price",
  "sa.packages.billingCycle": "Billing cycle",
  "sa.packages.maxUsers": "Max users",
  "sa.packages.maxBranches": "Max branches",
  "sa.packages.maxStorage": "Storage (MB)",
  "sa.packages.empty": "No packages yet — create your first plan.",
};

// ==========================================
// URDU (اردو)
// ==========================================

export const ur: Dict = {
  "common.loading": "لوڈ ہو رہا ہے...",
  "common.saving": "محفوظ ہو رہا ہے...",
  "common.save": "تبدیلیاں محفوظ کریں",
  "common.saveSettings": "ترتیبات محفوظ کریں",
  "common.cancel": "منسوخ",
  "common.close": "بند کریں",
  "common.back": "پیچھے",
  "common.next": "اگلا",
  "common.skip": "چھوڑیں",
  "common.finish": "سمجھ گیا",
  "common.search": "تلاش",
  "common.done": "مکمل",

  "nav.workspace": "ورک اسپیس",
  "nav.home": "ڈیش بورڈ",
  "nav.homeDesc": "جائزہ اور تجزیات",
  "nav.inventory": "انوینٹری",
  "nav.inventoryDesc": "مصنوعات، اسٹاک اور سپلائرز",
  "nav.invoices": "انوائسز",
  "nav.invoicesDesc": "بلز، ادائیگیاں اور گاہک",
  "nav.customers": "گاہک",
  "nav.customersDesc": "گاہکوں کی فہرست اور اکاؤنٹس",
  "nav.purchasing": "خریداری",
  "nav.purchasingDesc": "سپلائرز سے پرچیز آرڈرز",
  "nav.import": "درآمد",
  "nav.importDesc": "گاہکوں، مصنوعات اور مزید کو ایکسل/سی ایس وی سے درآمد کریں",
  "nav.reports": "رپورٹس",
  "nav.reportsDesc": "سیلز، اسٹاک اور منافع کے تجزیات",
  "nav.accounts": "اکاؤنٹس",
  "nav.accountsDesc": "چارٹ آف اکاؤنٹس اور جرنل",
  "nav.users": "ٹیم",
  "nav.usersDesc": "کمپنی کے صارفین کا انتظام",
  "nav.settings": "ترتیبات",
  "nav.settingsDesc": "پروفائل، انوائسز، بیک اپ اور آڈٹ",
  "nav.help": "مدد",
  "nav.helpDesc": "سافٹ ویئر استعمال کرنے کا طریقہ",
  "sidebar.signOut": "سائن آؤٹ",

  "topbar.backup": "بیک اپ",
  "topbar.backupTooltip": "ڈیٹا بیس کا بیک اپ",
  "topbar.settings": "ترتیبات",
  "topbar.settingsTooltip": "ترتیبات",
  "topbar.updateAvailable": "نیا ورژن {v} دستیاب ہے",
  "topbar.update": "اپ ڈیٹ کریں v{version}",
  "topbar.themeTooltipLight": "لائٹ موڈ پر جائیں",
  "topbar.themeTooltipDark": "ڈارک موڈ پر جائیں",
  "topbar.language": "زبان",

  "search.placeholder": "مصنوعات، گاہک تلاش کریں...",
  "search.products": "مصنوعات",
  "search.customers": "گاہک",
  "search.noResults": "\"{query}\" کے لیے کوئی نتیجہ نہیں",
  "search.tryHint": "مصنوعات کا نام، SKU یا گاہک کا نام آزمائیں۔",

  "notifications.title": "اطلاعات",
  "notifications.allClear": "سب صاف — کوئی الرٹ نہیں",
  "notifications.viewInventory": "انوینٹری دیکھیں",
  "notifications.markAllRead": "سب پڑھا ہوا نشان لگائیں",
  "update.title": "اپ ڈیٹ دستیاب ہے",
  "update.bodyIntro":
    "ورژن {v} دستیاب ہے۔ آپ فی الحال v{current} چلا رہے ہیں۔",
  "update.download": "ڈاؤن لوڈ اور انسٹال کریں",
  "update.installing": "اپ ڈیٹ انسٹال ہو گیا۔ ایپ جلد دوبارہ شروع ہو گی۔",
  "update.restartNote":
    "اپ ڈیٹ انسٹال ہونے کے بعد ایپ بند ہو کر دوبارہ شروع ہو جائے گی۔ آپ کا ڈیٹا محفوظ رہے گا۔",

  "backup.title": "بیک اپ محفوظ کریں",
  "backup.success": "بیک اپ محفوظ ہو گیا: {path}",
  "backup.error": "خرابی: {err}",

  "help.menuLabel": "مدد",
  "help.docs": "مدد اور دستاویزات",
  "help.replay": "ٹیوٹوریل دوبارہ چلائیں",
  "help.about": "معلومات",

  "lang.title": "زبان",
  "lang.label": "ایپ کی زبان",
  "lang.settingsIntro":
    "انٹرفیس اور مدد کی دستاویزات کے لیے زبان منتخب کریں۔",
  "lang.note":
    "آپ کی ٹیم کا بنایا ہوا مواد (مصنوعات، انوائسز، گاہک) بالکل ویسا ہی رہے گا جیسا درج کیا گیا، چاہے انٹرفیس کی زبان کوئی بھی ہو۔",

  "tour.skip": "ٹیوٹوریل چھوڑیں",
  "tour.next": "اگلا",
  "tour.back": "پیچھے",
  "tour.finish": "سمجھ گیا",
  "tour.stepXofY": "مرحلہ {current} از {total}",
  "tour.waiting": "آپ کا انتظار ہے…",
  "import.backTo": "واپس {view} پر",
  "tour.completed": "مکمل!",
  "tour.continue": "جاری رکھیں",

  // ---------- Onboarding tutorial ----------
  "onb.login.title": "اپنے ورک اسپیس میں سائن ان کریں",
  "onb.login.content":
    "خوش آمدید! کاروبار چلانے سے پہلے اپنے صارف نام اور پاس ورڈ سے سائن ان کریں۔",
  "onb.login.hint": "اپنی سائن ان تفصیلات درج کریں اور سائن ان دبائیں۔",
  "onb.welcome.title": "آپ کے ورک اسپیس میں خوش آمدید",
  "onb.welcome.content":
    "یہ ٹیوٹوریل آپ کو سکھاتا ہے کہ ایپ کو اصل میں کر کے استعمال کریں۔ ہر چھوٹے کام کو مکمل کریں تاکہ اگلا مرحلہ کھل سکے — آپ یہ کر سکتے ہیں!",
  "onb.navInventory.title": "انوینٹری کھولیں",
  "onb.navInventory.content":
    "انوینٹری وہ جگہ ہے جہاں آپ وہ سب کچھ رکھتے ہیں جو آپ بیچتے یا خریدتے ہیں۔ آئیے اسے کھولیں۔",
  "onb.navInventory.hint": "بائیں جانب سائیڈ بار میں 'انوینٹری' پر کلک کریں۔",
  "onb.inventoryOverview.title": "آپ کی انوینٹری",
  "onb.inventoryOverview.content":
    "یہ آپ کا انوینٹری صفحہ ہے۔ یہاں آپ مصنوعات، اسٹاک، کیٹیگریز اور سپلائرز کا ریکارڈ رکھ سکتے ہیں۔ دائیں جانب تلاش، مصنوعات شامل کرنے اور اپنی Excel یا CSV فائلیں امپورٹ کرنے کے اختیارات ہیں۔",
  "onb.addProduct.title": "اپنی پہلی مصنوعات شامل کریں",
  "onb.addProduct.content":
    "آئیے ایک حقیقی مصنوعات شامل کریں۔ 'Add Product' پر کلک کریں اور نام، قیمت اور مقدار بھریں — آپ کی انوینٹری زندہ ہو جائے گی۔",
  "onb.addProduct.hint": "مصنوعات کی فہرست کے اوپر 'Add Product' بٹن پر کلک کریں۔",
  "onb.import.title": "اپنا موجودہ ڈیٹا امپورٹ کریں",
  "onb.import.content":
    "کیا آپ کی مصنوعات پہلے سے Excel یا CSV میں ہیں؟ آپ کو دوبارہ ٹائپ کرنے کی ضرورت نہیں۔ امپورٹ وزرڈ کھولیں، یہ آپ کی فائل پڑھ کر کالم خود ملا دے گا۔",
  "onb.import.hint": "'Import from Excel / CSV' پر کلک کریں اور وزرڈ مکمل کریں۔",
  "onb.navInvoices.title": "انوائسز کھولیں",
  "onb.navInvoices.content":
    "اگلا پڑاؤ: بلنگ۔ یہ وہ جگہ ہے جہاں آپ وہ انوائسز بناتے ہیں جو آپ کے گاہک ادا کرتے ہیں۔",
  "onb.navInvoices.hint": "بائیں جانب سائیڈ بار میں 'انوائسز' پر کلک کریں۔",
  "onb.createInvoice.title": "انوائس بنائیں",
  "onb.createInvoice.content":
    "اپنی پہلی انوائس بنائیں: گاہک چنیں، مصنوعات منتخب کریں اور محفوظ کریں۔ یہ ڈرافٹ آپ کا بل بن جائے گا۔",
  "onb.createInvoice.hint": "'New Invoice' پر کلک کر کے فارم بھریں۔",
  "onb.finalizeInvoice.title": "اپنی انوائس حتمی کریں",
  "onb.finalizeInvoice.content":
    "آپ کی ڈرافٹ انوائس تیار ہے۔ سبز \u201CFinalize Invoice\u201D بٹن دبائیں تاکہ یہ ایک حقیقی وصول شدنی انوائس بن جائے۔",
  "onb.finalizeInvoice.hint": "\u201CFinalize Invoice\u201D پر کلک کریں۔",
  "onb.navSettings.title": "ترتیبات کھولیں",
  "onb.navSettings.content":
    "آخری پڑاؤ: ترتیبات۔ یہاں آپ اپنی کمپنی کا پروفائل، انوائس کی شکل، بیک اپ وغیرہ کا انتظام کریں گے۔",
  "onb.navSettings.hint": "بائیں جانب سائیڈ بار میں 'ترتیبات' پر کلک کریں۔",
  "onb.updateCompany.title": "اپنا کمپنی پروفائل اپ ڈیٹ کریں",
  "onb.updateCompany.content":
    "یقینی بنائیں کہ آپ کا کاروبار پیشہ ورانہ لگے: کمپنی کا نام، فون نمبر اور پتہ یہاں درج کریں۔",
  "onb.updateCompany.hint": "کمپنی پروفائل فارم میں لکھیں اور 'Save Changes' پر کلک کریں۔",
  "onb.done.title": "آپ تیار ہیں!",
  "onb.done.content":
    "بس — اب آپ جانتے ہیں کہ اپنے کاروبار کا بنیادی حصہ کیسے چلانا ہے۔ مدد کے مینو سے کسی بھی وقت یہ ٹیوٹوریل دوبارہ چلا سکتے ہیں۔ مبارک ہو!",

  "help.title": "مدد اور دستاویزات",
  "help.subtitle":
    "{company} میں اپنا کاروبار چلانے کے لیے ہر وہ چیز جو آپ کو جاننے کی ضرورت ہے۔",
  "help.searchPlaceholder": "مدد کے موضوعات تلاش کریں...",
  "help.toc": "مشمولات",
  "help.quickStart": "فوری آغاز",
  "help.noResults": "آپ کی تلاش سے کوئی موضوع نہیں ملا۔",
  "help.tryAnother": "کوئی اور لفظ آزمائیں، مثلاً \"انوائس\" یا \"بیک اپ\"۔",
  "help.tip": "مشورہ",
  "help.warning": "اہم",

  "settings.title": "ترتیبات",
  "settings.tab.company": "کمپنی پروفائل",
  "settings.tab.invoice": "انوائس کی ترتیبات",
  "settings.tab.theme": "تھیم اور برانڈنگ",
  "settings.tab.backup": "بیک اپ اور بحالی",
  "settings.tab.retention": "ڈیٹا رکھنے کی پالیسی",
  "settings.tab.audit": "آڈٹ لاگ",
  "settings.tab.language": "زبان",

  "login.heroTitle": "آپ کا کاروبار، مکمل ترتیب میں۔",
  "login.heroSubtitle":
    "آئی جاز اینڈ کمپنی ای آر پی انوینٹری، انوائسنگ اور تجزیات کو ایک صاف ستھری ورک اسپیس میں لاتا ہے — درستگی کے لیے بنایا گیا، ترقی کے لیے تیار۔",
  "login.feat1.title": "انوینٹری کنٹرول",
  "login.feat1.text": "مصنوعات، بیچز، اسٹاک لیولز اور سپلائرز کا سراغ رکھیں۔",
  "login.feat2.title": "سمارٹ انوائسنگ",
  "login.feat2.text": "ڈرافٹ → حتمی → ادا شدہ، ٹیکس اور چھوٹ کے ساتھ۔",
  "login.feat3.title": "بزنس اینالٹکس",
  "login.feat3.text": "لائیو ریونیو رجحانات، ٹاپ مصنوعات اور منافع کی بصیرتیں۔",
  "login.privateData": "آپ کا ڈیٹا آپ کی مشین پر مقامی اور نجی رہتا ہے۔",
  "login.welcome": "خوش آمدید",
  "login.signinTitle": "اپنے ورک اسپیس میں سائن ان کریں",
  "login.signinSubtitle": "جاری رکھنے کے لیے اپنی اسناد درج کریں۔",
  "login.email": "ای میل",
  "login.emailPlaceholder": "you@company.com",
  "login.password": "پاس ورڈ",
  "login.passwordPlaceholder": "آپ کا پاس ورڈ",
  "login.signIn": "سائن ان",

  "setup.heroTitle": "ایک منٹ سے کم میں اپنی کمپنی قائم کریں۔",
  "setup.heroSubtitle":
    "اپنے کاروبار کی تفصیلات اور ایک مالک اکاؤنٹ رجسٹر کریں۔ آپ فوراً سائن ان ہو جائیں گے اور اپنے کام شروع کرنے کے لیے تیار ہوں گے۔",
  "setup.step1.title": "کمپنی کی معلومات",
  "setup.step1.text": "نام، کرنسی اور ٹیکس شناخت۔",
  "setup.step2.title": "مالک اکاؤنٹ",
  "setup.step2.text": "محفوظ پاس ورڈ کے ساتھ آپ کی ذاتی لاگ ان۔",
  "setup.step3.title": "کام شروع کریں",
  "setup.step3.text": "براہ راست آپ کے ڈیش بورڈ میں خودکار سائن ان۔",
  "setup.singleTenant": "ایک انسٹالیشن پر صرف ایک کمپنی — ڈیزائن کے لحاظ سے۔",
  "setup.firstLaunch": "پہلی بار",
  "setup.createWorkspace": "اپنا ورک اسپیس بنائیں",
  "setup.ownerNote": "آپ اس کمپنی کے مالک بن جائیں گے۔",
  "setup.companyInfo": "کمپنی کی معلومات",
  "setup.companyName": "کمپنی کا نام",
  "setup.companyNamePlaceholder": "آئی جاز اینڈ کمپنی",
  "setup.phone": "فون",
  "setup.phonePlaceholder": "+92 300 1234567",
  "setup.taxNumber": "ٹیکس نمبر",
  "setup.taxNumberPlaceholder": "NTN یا STRN",
  "setup.address": "پتہ",
  "setup.addressPlaceholder": "لاہور، پنجاب، پاکستان",
  "setup.currency": "کرنسی",
  "setup.ownerAccount": "مالک اکاؤنٹ",
  "setup.fullName": "آپ کا مکمل نام",
  "setup.fullNamePlaceholder": "آئی جاز احمد",
  "setup.email": "ای میل",
  "setup.emailPlaceholder": "owner@ijaz.com",
  "setup.password": "پاس ورڈ",
  "setup.passwordPlaceholder": "مضبوط پاس ورڈ منتخب کریں",
  "setup.createCompany": "کمپنی بنائیں اور جاری رکھیں",

  // ---------- Super Admin Platform ----------
  "sa.subtitle": "کمانڈ سینٹر",
  "sa.logout": "سائن آؤٹ",
  "sa.nav.overview": "جائزہ",
  "sa.nav.tenants": "ادارے",
  "sa.nav.packages": "پیکجز",
  "sa.nav.analytics": "تجزیات",
  "sa.nav.settings": "ترتیبات",
  "sa.title.overview": "پلیٹ فارم کا جائزہ",
  "sa.title.tenants": "اداروں کا انتظام",
  "sa.title.packages": "سبسکرپشن پیکجز",
  "sa.title.analytics": "پلیٹ فارم تجزیات",
  "sa.title.settings": "پلیٹ فارم کی ترتیبات",
  "sa.common.cancel": "منسوخ",
  "sa.common.save": "محفوظ کریں",
  "sa.status.active": "فعال",
  "sa.status.archived": "محفوظ شدہ",
  "sa.sub.active": "فعال",
  "sa.sub.trial": "ٹرائل",
  "sa.sub.past_due": "زیر التوا",
  "sa.sub.suspended": "معطل",
  "sa.sub.cancelled": "منسوخ شدہ",
  "sa.sub.ended": "ختم شدہ",
  "sa.module.dashboard": "ڈیش بورڈ",
  "sa.module.inventory": "انوینٹری",
  "sa.module.sales": "سیلز",
  "sa.module.purchases": "خریداری",
  "sa.module.reports": "رپورٹس",
  "sa.module.employees": "ملازمین",
  "sa.module.branches": "برانچیں",
  "sa.module.invoices": "انوائسز",
  "sa.module.import": "درآمد",
  "sa.module.dataImport": "ڈیٹا درآمد",

  // Overview
  "sa.overview.heroTitle": "ایک کمانڈ سینٹر سے ہر ورک اسپیس کی نگرانی کریں۔",
  "sa.overview.heroSubtitle":
    "ادارے رجسٹر کریں، پیکجز تفویض کریں اور پورے پلیٹ فارم پر سبسکرپشنز کی صحت کو حقیقی وقت میں منظم کریں۔",
  "sa.overview.newTenant": "نیا ادارہ",
  "sa.overview.managePackages": "پیکجز کا انتظام",
  "sa.overview.stat.tenants": "کل ادارے",
  "sa.overview.stat.active": "فعال ورک اسپیسز",
  "sa.overview.stat.users": "کل صارفین",
  "sa.overview.stat.packages": "پیکجز",
  "sa.overview.recent": "حالیہ ادارے",
  "sa.overview.viewAll": "سب دیکھیں",
  "sa.overview.empty": "ابھی کوئی ادارہ نہیں — اپنا پہلا ورک اسپیس رجسٹر کریں۔",
  "sa.overview.usersShort": "صارفین",

  // Analytics
  "sa.analytics.subtitle": "تمام ورک اسپیسز کی صحت اور آمدنی کے اعداد و شمار۔",
  "sa.analytics.mrr": "ماہانہ بار بار ہونے والی آمدنی",
  "sa.analytics.totalTenants": "کل ادارے",
  "sa.analytics.activeTenants": "فعال ورک اسپیسز",
  "sa.analytics.totalUsers": "کل صارفین",
  "sa.analytics.growth": "اداروں کی نشوونما (پچھلے 12 ماہ)",
  "sa.analytics.byStatus": "سبسکرپشن کی حیثیت",
  "sa.analytics.byPackage": "پیکج کے لحاظ سے ادارے",
  "sa.analytics.noData": "ابھی کوئی تجزیاتی ڈیٹا نہیں۔",

  // Settings
  "sa.settings.subtitle": "پلیٹ فارم کے رویے اور شکل کو ترتیب دیں۔",
  "sa.settings.theme": "پلیٹ فارم تھیم",
  "sa.settings.themeDesc": "پورے پلیٹ فارم کنسول پر لاگو ہوتا ہے۔",
  "sa.settings.dark": "ابیسن (ڈارک)",
  "sa.settings.light": "ڈے لائٹ (لائٹ)",
  "sa.settings.language": "انٹرفیس زبان",
  "sa.settings.languageDesc": "معاون زبانوں کے درمیان سوئچ کریں۔",
  "sa.settings.about": "تعارف",
  "sa.settings.aboutDesc": "پلیٹ فارم کی تعمیر اور ورژن کی معلومات۔",
  "sa.settings.version": "ورژن",
  "sa.settings.build": "بلڈ",
  "sa.settings.channel": "چینل",
  "sa.settings.stable": "مستحکم",
  "sa.settings.saved": "محفوظ شدہ",

  // Tenants
  "sa.tenants.searchPh": "نام یا ای میل سے تلاش کریں...",
  "sa.tenants.filter.all": "تمام",
  "sa.tenants.filter.active": "فعال",
  "sa.tenants.filter.archived": "محفوظ شدہ",
  "sa.tenants.refresh": "ریفریش",
  "sa.tenants.registerButton": "ادارہ رجسٹر کریں",
  "sa.tenants.empty": "آپ کی تلاش سے کوئی ادارہ نہیں ملا۔",
  "sa.tenants.archive": "آرکائیو",
  "sa.tenants.activate": "فعال کریں",
  "sa.tenants.register.title": "نیا ادارہ رجسٹر کریں",
  "sa.tenants.register.subtitle":
    "ایک مرحلے میں کمپنی، ایڈمن اکاؤنٹ، سبسکرپشن اور ڈیفالٹ ماڈیولز بناتا ہے۔",
  "sa.tenants.register.companySection": "کمپنی",
  "sa.tenants.register.companyName": "کمپنی کا نام",
  "sa.tenants.register.companyNamePh": "مثلاً النور ٹریڈرز",
  "sa.tenants.register.package": "پیکج",
  "sa.tenants.register.packagePh": "پیکج منتخب کریں",
  "sa.tenants.register.phone": "فون",
  "sa.tenants.register.address": "پتہ",
  "sa.tenants.register.taxNumber": "ٹیکس نمبر",
  "sa.tenants.register.province": "صوبہ",
  "sa.tenants.register.currency": "کرنسی",
  "sa.tenants.register.adminSection": "مالک اکاؤنٹ",
  "sa.tenants.register.adminName": "مکمل نام",
  "sa.tenants.register.adminEmail": "ای میل",
  "sa.tenants.register.adminPassword": "پاس ورڈ",
  "sa.tenants.register.required": "کمپنی کا نام، مالک کا نام، ای میل اور پاس ورڈ درکار ہیں۔",
  "sa.tenants.register.needPackage": "براہ کرم پیکج منتخب کریں۔",
  "sa.tenants.register.create": "ادارہ بنائیں",
  "sa.tenants.detail.subscription": "سبسکرپشن",
  "sa.tenants.detail.package": "پیکج",
  "sa.tenants.detail.price": "قیمت",
  "sa.tenants.detail.period": "موجودہ مدت",
  "sa.tenants.detail.trial": "ٹرائل ختم",
  "sa.tenants.detail.noSubscription": "ابھی کوئی سبسکرپشن تفویض نہیں ہوئی۔",
  "sa.tenants.detail.modules": "ماڈیولز",
  "sa.tenants.detail.featureFlags": "فیچر فلیگز",
  "sa.tenants.detail.noFlags": "کوئی فیچر فلیگ مقرر نہیں۔",
  "sa.tenants.register.createdTitle": "ادارہ بن گیا!",
  "sa.tenants.register.createdSubtitle": "کمپنی اور مالک کا اکاؤنٹ تیار ہیں۔",
  "sa.tenants.register.done": "مکمل",
  "sa.tenants.edit.button": "کمپنی میں ترمیم",
  "sa.tenants.edit.title": "کمپنی میں ترمیم",
  "sa.tenants.edit.save": "تبدیلیاں محفوظ کریں",
  "sa.tenants.edit.saved": "کمپنی کامیابی سے اپڈیٹ ہوئی۔",

  // Packages
  "sa.packages.subtitle":
    "ان پلانز کی وضاحت کریں جن کے لیے ادارے سبسکرائب کرتے ہیں — حدود، بلنگ اور فیچرز۔",
  "sa.packages.create": "نیا پیکج",
  "sa.packages.edit": "ترمیم",
  "sa.packages.delete": "حذف",
  "sa.packages.deleteConfirm": "کیا یہ پیکج حذف کریں؟ موجودہ سبسکرپشنز جاری رہیں گی لیکن یہ منتخب نہیں ہو سکے گا۔",
  "sa.packages.name": "پیکج کا نام",
  "sa.packages.nameRequired": "پیکج کا نام کم از کم 2 حروف کا ہونا چاہیے۔",
  "sa.packages.description": "تفصیل",
  "sa.packages.price": "قیمت",
  "sa.packages.billingCycle": "بلنگ سائیکل",
  "sa.packages.maxUsers": "زیادہ سے زیادہ صارفین",
  "sa.packages.maxBranches": "زیادہ سے زیادہ برانچیں",
  "sa.packages.maxStorage": "سٹوریج (ایم بی)",
  "sa.packages.empty": "ابھی کوئی پیکج نہیں — اپنا پہلا پلان بنائیں۔",
};

export const translations: Record<Lang, Dict> = { en, ur };
