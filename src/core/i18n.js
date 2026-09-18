// تعريب/تغريب الواجهة كاملة — عربي ⇄ إنجليزي.
//
// لماذا القاموس مفتاحه النصّ العربي نفسه، لا رمزٌ مثل "btn.save"؟
//
// النصوص مكتوبة داخل ثلاث عشرة شاشة، ٩٢٠ موضعًا. تحويلها إلى رموز يعني
// تعديل كل شاشة تعمل اليوم، ونسيان موضع واحد يترك فراغًا في الشاشة.
// بالمفتاح النصّي لا نلمس أي شاشة: ما في القاموس يُترجم، وما ليس فيه
// يبقى عربيًا مقروءًا. التدهور هنا آمن — نصٌّ بلغة أخرى، لا فراغ.
//
// الترجمة تجري على DOM بعد كل رسم، ومراقب يتولّى ما يُرسم لاحقًا.
// window.mpMissing() تطبع ما لم يُترجَم بعد، فتُستكمل تدريجيًا.

const LS_LANG = "mpstore.lang";

// ============================================================
//  القاموس
// ============================================================
const EN = {
  // ---------- الدخول والجلسة ----------
  "مخزن شركه الهنا الكتريك": "El Hana Electric Store",
  "مخزن مستلزمات الكهرباء": "Electrical Supplies Store",
  "إدارة مخزن مستلزمات الكهرباء": "Electrical Supplies Store Management",
  "المخزن": "Store",
  "الخادم": "Server",
  "البيانات": "Credentials",
  "الجلسة": "Session",
  "اسم المستخدم": "Username",
  "كلمة المرور": "Password",
  "غلق القاطع": "Close breaker",
  "اضغط لغلق القاطع": "Press to close the breaker",
  "بانتظار بيانات الدخول": "Waiting for credentials",
  "جارٍ التحقق": "Verifying",
  "الدائرة مغلقة": "Circuit closed",
  "تعذّر تسجيل الدخول": "Sign-in failed",
  "تنبيه: مفتاح Caps Lock مُفعَّل": "Caps Lock is on",
  "الدخول يُسجَّل باسمك في سجل الحركات": "Your sign-in is recorded in the activity log",
  "حفظ بيانات الاتصال": "Save connection settings",
  "هذا الحساب مقفول مؤقتًا بسبب محاولات فاشلة متكررة. حاول لاحقًا.":
    "This account is temporarily locked after repeated failed attempts. Try again later.",
  "لا يوجد ملف مستخدم مرتبط بهذا الحساب. راجع مدير النظام.":
    "No user profile is linked to this account. Contact your administrator.",
  "هذا الحساب موقوف. راجع مدير النظام.":
    "This account is disabled. Contact your administrator.",
  "تسجيل الخروج": "Sign out",
  "هل تريد إنهاء الجلسة الآن؟": "End the session now?",
  "تمديد الجلسة": "Extend session",
  "الجلسة على وشك الانتهاء": "Session about to expire",
  "آخر نشاط": "Last activity",
  "انتهت الجلسة تلقائيًا بسبب عدم النشاط.": "Session ended automatically due to inactivity.",
  "انتهت مدة الجلسة القصوى. سجّل الدخول من جديد.":
    "Maximum session length reached. Please sign in again.",
  "تم تسجيل الخروج من نافذة أخرى.": "You were signed out from another window.",

  // ---------- القوائم والشاشات ----------
  "لوحة القيادة": "Dashboard",
  "الأصناف": "Items",
  "إذن وارد": "Goods In",
  "إذن صرف": "Goods Out",
  "سجل الحركات": "Activity Log",
  "التقارير": "Reports",
  "التسعير": "Pricing",
  "المحاسبة": "Accounting",
  "الجرد": "Stocktake",
  "سجل التدقيق": "Audit Log",
  "الأدوار والصلاحيات": "Roles & Permissions",
  "الإعدادات": "Settings",
  "اللوحة": "Home",
  "وارد": "In",
  "صرف": "Out",
  "المزيد": "More",
  "القائمة": "Menu",
  "أقسام النظام": "System sections",
  "التنقّل السريع": "Quick navigation",

  // ---------- عناصر عامة ----------
  "تأكيد": "Confirm",
  "إلغاء": "Cancel",
  "إغلاق": "Close",
  "حفظ": "Save",
  "إضافة": "Add",
  "تعديل": "Edit",
  "حذف": "Delete",
  "إنشاء": "Create",
  "عرض": "View",
  "طباعة": "Print",
  "تحديث": "Refresh",
  "إعادة ضبط": "Reset",
  "إزالة": "Remove",
  "تفصيل": "Details",
  "التفاصيل": "Details",
  "النتيجة": "Result",
  "السابق": "Previous",
  "التالي": "Next",
  "الإجمالي": "Total",
  "النسبة": "Share",
  "القيمة": "Value",
  "الحالة": "Status",
  "النوع": "Type",
  "التاريخ": "Date",
  "الوقت": "Time",
  "الاسم": "Name",
  "الرمز": "Code",
  "بواسطة": "By",
  "من تاريخ": "From date",
  "إلى تاريخ": "To date",
  "الشهر الحالي": "Current month",
  "فترة التحليل": "Analysis period",
  "تنزيل Excel": "Download Excel",
  "تم تنزيل ملف Excel": "Excel file downloaded",
  "تم تنزيل الملف": "File downloaded",
  "لا توجد بيانات": "No data",
  "لا توجد بيانات للتصدير": "Nothing to export",
  "لا توجد بيانات للطباعة": "Nothing to print",
  "لا توجد بيانات في هذه الفترة": "No data for this period",
  "جارٍ التنفيذ...": "Working...",
  "جارٍ الحفظ...": "Saving...",
  "جارٍ الحساب...": "Calculating...",
  "جارٍ التحديث...": "Refreshing...",
  "جارٍ الإنشاء...": "Creating...",
  "جارٍ التسجيل...": "Recording...",
  "جارٍ تحميل البيانات...": "Loading data...",
  "جارٍ تجهيز النسخة...": "Preparing backup...",
  "جارٍ الاتصال": "Connecting",
  "جارٍ إعادة الاتصال...": "Reconnecting...",
  "متصل": "Online",
  "متصل — التحديثات لحظية": "Online — live updates",
  "انقطع التحديث اللحظي": "Live updates interrupted",
  "بدون اتصال — العرض من النسخة المحلية": "Offline — showing the local copy",
  "تعذّر التحميل — تُعرض آخر نسخة محفوظة": "Load failed — showing the last saved copy",
  "تعذّر التحديث": "Refresh failed",
  "تم تحديث البيانات": "Data refreshed",
  "تم التحديث": "Updated",
  "تم حفظ التعديلات": "Changes saved",
  "تمت الإضافة": "Added",
  "ج.م": "EGP",
  "قطعة": "pc",
  "الآن": "now",
  "حتى": "until",

  // ---------- رسائل التحقق والأخطاء ----------
  "هذا الحقل مطلوب": "This field is required",
  "الكمية يجب أن تكون رقمًا صحيحًا أكبر من صفر":
    "Quantity must be a whole number greater than zero",
  "أدخل تاريخًا صحيحًا": "Enter a valid date",
  "التاريخ لا يمكن أن يكون في المستقبل": "The date cannot be in the future",
  "القيمة مستخدمة بالفعل": "This value is already in use",
  "اسم المستخدم: حروف إنجليزية وأرقام و_ فقط":
    "Username: English letters, digits and _ only",
  "لم يتم ضبط الاتصال بقاعدة البيانات بعد": "Database connection is not configured yet",
  "خطأ غير معروف": "Unknown error",
  "تعذّر الوصول إلى الخادم. تأكد من اتصال الإنترنت ثم أعد المحاولة.":
    "Could not reach the server. Check your internet connection and try again.",
  "اسم المستخدم أو كلمة المرور غير صحيحة.": "Incorrect username or password.",
  "الحساب لم يُفعَّل بعد. راجع مدير النظام.":
    "This account is not activated yet. Contact your administrator.",
  "القيمة مستخدمة من قبل (تكرار غير مسموح).":
    "This value already exists (duplicates are not allowed).",
  "لا يمكن الحذف: توجد حركات مرتبطة بهذا السجل.":
    "Cannot delete: there are transactions linked to this record.",
  "ليس لديك صلاحية لتنفيذ هذه العملية.": "You do not have permission to do this.",
  "حدث خطأ أثناء تنفيذ العملية.": "Something went wrong while processing.",
  "ليس لديك صلاحية لفتح هذه الشاشة": "You do not have permission to open this screen",
  "لم يستجب الخادم خلال ٩ ثوانٍ": "The server did not respond within 9 seconds",
  "صدرت نسخة جديدة من التطبيق.": "A new version of the app is available.",
  "صدرت نسخة جديدة — اضغط هنا لتحديث التطبيق":
    "New version available — tap to update",
  "تحديث الآن": "Update now",
  "لاحقًا": "Later",

  // ---------- الأصناف ----------
  "قائمة الأصناف": "Item list",
  "إضافة صنف": "Add item",
  "إضافة صنف جديد": "Add a new item",
  "بحث بالكود، الاسم، الماركة، المواصفة": "Search by code, name, brand or spec",
  "بحث بالكود أو الاسم": "Search by code or name",
  "كل الفئات": "All categories",
  "كل الأرصدة": "All stock levels",
  "الكود": "Code",
  "الصنف": "Item",
  "الفئة": "Category",
  "الماركة": "Brand",
  "اسم الصنف / الموديل": "Item name / model",
  "اسم الصنف": "Item name",
  "المواصفة": "Specification",
  "الوحدة": "Unit",
  "الرصيد": "Balance",
  "الرصيد الحالي": "Current balance",
  "الرصيد الافتتاحي": "Opening balance",
  "الرصيد يتغيّر عبر الأذون فقط": "Balance changes through vouchers only",
  "الحد الأدنى": "Minimum",
  "تحت الحد الأدنى": "Below minimum",
  "تحت الحد": "Below min",
  "نفد من المخزن": "Out of stock",
  "نفد": "Out",
  "متاح": "In stock",
  "سعر الوحدة": "Unit price",
  "سعر الشراء": "Purchase price",
  "سعر الشراء للوحدة": "Purchase price per unit",
  "مصاريف إضافية": "Extra costs",
  "مصاريف إضافية للوحدة": "Extra costs per unit",
  "قيمة الرصيد": "Stock value",
  "حفظ الصنف": "Save item",
  "حفظ التعديلات": "Save changes",
  "اختر الفئة": "Choose a category",
  "اختر أو اكتب فئة جديدة": "Choose or type a new category",
  "أدخل اسم الصنف": "Enter the item name",
  "أرشفة": "Archive",
  "أرشفة صنف": "Archive item",
  "تمت أرشفة الصنف": "Item archived",
  "لا توجد أصناف مطابقة للبحث": "No items match your search",
  "لا توجد أصناف": "No items",
  "لا توجد أصناف بعد": "No items yet",
  "لا توجد أصناف للطباعة": "No items to print",
  "قائمة أصناف المخزن": "Store item list",
  "إجراء": "Action",
  "الأصناف النشطة": "Active items",
  "عدد الأصناف": "Item count",

  // ---------- الأذون ----------
  "إذن وارد — استلام مخزون": "Goods In — receiving stock",
  "إذن صرف — تسليم مخزون": "Goods Out — issuing stock",
  "رقم الإذن": "Voucher no.",
  "تاريخ الإذن": "Voucher date",
  "المورد": "Supplier",
  "المورد / جهة التوريد": "Supplier / source",
  "الجهة": "Party",
  "الجهة المستلمة": "Receiving party",
  "الجهة / المشروع": "Party / project",
  "المشروع": "Project",
  "ملاحظات": "Notes",
  "الكمية": "Quantity",
  "الكميات": "Quantities",
  "إضافة صنف إلى الإذن": "Add an item to the voucher",
  "إضافة الصنف إلى الإذن": "Add item to voucher",
  "تسجيل إذن الوارد": "Record goods-in voucher",
  "تسجيل إذن الصرف": "Record goods-out voucher",
  "تفريغ الإذن": "Clear voucher",
  "آخر الأذون": "Recent vouchers",
  "الأذون": "Vouchers",
  "عدد الأذون": "Voucher count",
  "سيتم حذف كل الأصناف المضافة للإذن الحالي.":
    "All items added to the current voucher will be removed.",
  "لم تُضف أصناف بعد": "No items added yet",
  "أدخل تاريخ الإذن": "Enter the voucher date",
  "أدخل اسم المورد": "Enter the supplier name",
  "أدخل الجهة المستلمة": "Enter the receiving party",
  "أدخل اسم المشروع": "Enter the project name",
  "أضف صنفًا واحدًا على الأقل": "Add at least one item",
  "تم تسجيل": "Recorded",
  "مُسجَّل": "RECORDED",
  "طباعة الإذن": "Print voucher",
  "إذن جديد": "New voucher",
  "لا توجد أذون بعد": "No vouchers yet",
  "الإذن غير موجود": "Voucher not found",
  "حذف إذن": "Delete voucher",
  "حذف الإذن": "Delete voucher",
  "حذف نهائي": "Delete permanently",
  "رقم إذن، صنف، جهة...": "Voucher no., item, party...",
  "كل المشاريع": "All projects",
  "لا توجد حركات مطابقة": "No matching transactions",
  "الحركات": "Transactions",
  "سجل حركات المخزن": "Store transaction log",
  "لم تُسجَّل أي حركة بعد": "No transactions recorded yet",
  "آخر الحركات": "Recent transactions",
  "عرض السجل كاملًا": "View the full log",
  "أمين المخزن": "Storekeeper",
  "المستلم": "Recipient",
  "المدير": "Manager",
  "إذن": "Voucher",

  // ---------- لوحة القيادة ----------
  "ما الذي يحتاج تدخّلي اليوم؟": "What needs my attention today?",
  "حركة المخزن": "Stock movement",
  "توزيع المخزن": "Stock distribution",
  "أصناف على وشك النفاد": "Items about to run out",
  "التقدير من متوسط الصرف خلال ٩٠ يومًا":
    "Estimated from the average issue rate over 90 days",
  "معدل الصرف اليومي": "Daily issue rate",
  "يكفي": "Covers",
  "يكفي (يوم)": "Covers (days)",
  "اقتراح طلب شراء": "Purchase suggestion",
  "كميات تكفي ٤٥ يومًا من الاستهلاك الحالي للأصناف المهدَّدة.":
    "Quantities covering 45 days of current consumption for at-risk items.",
  "الكمية المقترحة": "Suggested quantity",
  "التكلفة التقديرية": "Estimated cost",
  "الأكثر صرفًا": "Most issued",
  "أنشط المشاريع": "Busiest projects",
  "رأس مال راكد": "Idle capital",
  "أصناف لها رصيد ولم تُصرف منذ أكثر من ٦ أشهر.":
    "Items with stock that have not been issued in over 6 months.",
  "آخر صرف": "Last issued",
  "القيمة المجمّدة": "Tied-up value",
  "الأرصدة حسب الفئة": "Balances by category",
  "قيمة المخزون": "Stock value",
  "حالة الأرصدة": "Stock status",
  "القيمة حسب الفئة": "Value by category",
  "الكميات حسب الفئة": "Quantities by category",
  "فئة": "category",
  "باقي الفئات": "Other categories",
  "اكتمال التسعير": "Pricing completeness",
  "مسعّر": "priced",
  "كل الأصناف مسعّرة": "All items are priced",
  "لا يمكن الصرف منها": "Cannot be issued",
  "لا يمكن الصرف منها حتى يتم التوريد.": "Cannot be issued until restocked.",
  "يكفي ١٤ يومًا أو أقل": "14 days of cover or less",
  "حسب معدل الصرف الفعلي": "Based on the actual issue rate",
  "عرض الأصناف": "View items",
  "عرض القائمة": "View list",
  "عرض التفاصيل": "View details",
  "بمعدل الصرف الحالي ستنفد قبل نهاية الأسبوعين.":
    "At the current rate these will run out within two weeks.",
  "راجع اقتراح طلب الشراء أسفل الصفحة.": "See the purchase suggestion below.",
  "فحص السجل": "Review log",
  "قيمة المخزون المعروضة أقل من الحقيقة.": "The displayed stock value is understated.",
  "تسعير الأصناف": "Price items",
  "كل الأرصدة في وضع آمن": "All stock levels are safe",
  "لا يوجد صنف نفد أو مهدَّد بالنفاد خلال الفترة القادمة.":
    "No item is out of stock or at risk in the coming period.",
  "حركة الوارد والصرف": "In and out movement",
  "بلا تغيير": "no change",
  "حركته": "movement",
  "لا يوجد صنف مهدَّد بالنفاد": "No item is at risk of running out",
  "لا توجد أصناف تحتاج توريدًا": "No items need restocking",
  "لا توجد حركات صرف في هذه الفترة": "No issues in this period",
  "لا توجد مشاريع بها صرف": "No projects with issues",
  "لم يُصرف مطلقًا": "Never issued",
  "لا يوجد رصيد راكد": "No idle stock",
  "أعلى": "highest",
  "أقل": "lowest",
  "لوحة القيادة الذكية غير مفعّلة": "The smart dashboard is not enabled",
  "تعذّر تحميل اللوحة": "Could not load the dashboard",
  "طلب شراء": "Purchase request",
  "تم تنزيل طلب الشراء": "Purchase request downloaded",

  // ---------- التسعير ----------
  "عدّل السعر في الجدول مباشرة ثم اضغط خارج الحقل للحفظ.":
    "Edit the price directly in the table, then click outside the field to save.",
  "العرض فقط — لا تملك صلاحية تعديل الأسعار.":
    "View only — you do not have permission to edit prices.",
  "تقرير تسعير المخزون": "Stock pricing report",
  "السعر لا يمكن أن يكون سالبًا": "Price cannot be negative",
  "تم حفظ السعر": "Price saved",
  "قيمة المخزون المعروض": "Displayed stock value",
  "أصناف بلا سعر": "Unpriced items",
  "بلا سعر": "No price",
  "آخر سعر": "Last price",

  // ---------- المحاسبة ----------
  "تقييم المخزون": "Stock valuation",
  "تكلفة المشاريع": "Project costs",
  "مطابقة الفواتير": "Invoice matching",
  "مراجعة الأسعار": "Price review",
  "أدوات المحاسبة": "Accounting tools",
  "إعادة بناء التكاليف": "Rebuild costs",
  "التكلفة محسوبة بالمتوسط المرجّح المتحرك.":
    "Cost is calculated using the moving weighted average.",
  "التكلفة محسوبة بسعر الوحدة وقت الصرف.":
    "Cost is based on the unit cost at the time of issue.",
  "تاريخ البداية بعد تاريخ النهاية": "Start date is after the end date",
  "أول المدة": "Opening",
  "قيمة أول المدة": "Opening value",
  "قيمة الوارد": "Received value",
  "منصرف": "Issued",
  "تكلفة المنصرف": "Cost of issues",
  "آخر المدة": "Closing",
  "قيمة آخر المدة": "Closing value",
  "قيمة المشتريات": "Purchases value",
  "إجمالي الوارد بالتكلفة": "Total received at cost",
  "يُحمَّل على المشاريع": "Charged to projects",
  "رصيد المخزون في نهاية الفترة": "Stock balance at period end",
  "المعادلة: قيمة أول المدة + المشتريات − تكلفة المنصرف = قيمة آخر المدة":
    "Formula: opening + purchases − cost of issues = closing",
  "كمية أول المدة": "Opening qty",
  "كمية الوارد": "Received qty",
  "كمية المنصرف": "Issued qty",
  "كمية آخر المدة": "Closing qty",
  "متوسط التكلفة": "Average cost",
  "تكلفة الصرف لكل مشروع": "Issue cost per project",
  "التكلفة": "Cost",
  "إجمالي التكلفة المحمّلة": "Total charged cost",
  "عدد المشاريع": "Project count",
  "أعلى مشروع": "Top project",
  "مطابقة فواتير الموردين": "Supplier invoice matching",
  "قيمة الإذن": "Voucher value",
  "رقم الفاتورة": "Invoice no.",
  "قيمة الفاتورة": "Invoice value",
  "رقم فاتورة المورد": "Supplier invoice no.",
  "الفرق": "Difference",
  "الفرق %": "Difference %",
  "فرق سعر": "Price gap",
  "إجمالي المشتريات": "Total purchases",
  "أذون بانتظار المراجعة": "Vouchers awaiting review",
  "أذون بها فروقات": "Vouchers with differences",
  "مراجعة": "Review",
  "روجع بواسطة": "Reviewed by",
  "بانتظار المراجعة": "Pending review",
  "مطابق": "Matched",
  "به فرق": "Has difference",
  "حفظ المراجعة": "Save review",
  "تم حفظ المراجعة": "Review saved",
  "الفاتورة مطابقة لقيمة الإذن تمامًا.": "The invoice matches the voucher exactly.",
  "قيمة المخزون بالتكلفة": "Stock value at cost",
  "المتوسط المرجّح": "Weighted average",
  "قيمته بآخر سعر شراء": "Valued at the last purchase price",
  "للمقارنة فقط": "For comparison only",
  "أذون وارد بلا تكلفة": "Goods-in vouchers with no cost",
  "استُلمت بدون سعر": "Received without a price",
  "إعادة البناء": "Rebuild",

  // ---------- سجل التدقيق ----------
  "التعديلات": "Changes",
  "الحسابات المقفولة": "Locked accounts",
  "الحسابات المقفولة حاليًا": "Currently locked accounts",
  "رقم إذن، اسم مستخدم...": "Voucher no., username...",
  "كل الإجراءات": "All actions",
  "كل الأنواع": "All types",
  "كل المستخدمين": "All users",
  "كل الأحداث": "All events",
  "اسم المستخدم...": "Username...",
  "المستخدم": "User",
  "الإجراء": "Action",
  "المرجع": "Reference",
  "المرجع:": "Reference:",
  "الحدث": "Event",
  "غير معروف": "Unknown",
  "دخول ناجح": "Successful sign-in",
  "محاولة فاشلة": "Failed attempt",
  "خروج": "Sign-out",
  "ترحيل": "Post",
  "جرد": "Stocktake",
  "مراجعة محاسبية": "Accounting review",
  "صنف": "Item",
  "مستخدم": "User",
  "لا توجد أحداث دخول في هذه الفترة": "No sign-in events in this period",
  "لا توجد تعديلات مطابقة": "No matching changes",
  "محاولات": "Attempts",
  "فكّ القفل": "Unlock",
  "تم فكّ القفل": "Unlocked",
  "القفل ينتهي وحده بعد ٥ دقائق من آخر محاولة فاشلة.":
    "The lock clears itself 5 minutes after the last failed attempt.",
  "السجل": "Log",

  // ---------- الأدوار ----------
  "مدير النظام": "System administrator",
  "نائب مدير المخزن": "Deputy store manager",
  "محاسب": "Accountant",
  "أمين مخزن": "Storekeeper",
  "مُطّلع": "Viewer",
  "دور جديد": "New role",
  "الصلاحية": "Permission",
  "تعيين الأدوار للمستخدمين": "Assign roles to users",
  "الدور": "Role",
  "تم تحديث الدور": "Role updated",
  "تغيّرت صلاحياتك — حدّث الصفحة لتطبيق التغيير على القائمة":
    "Your permissions changed — refresh the page to update the menu",
  "تغيير الاسم": "Rename",
  "الاسم مطلوب": "Name is required",
  "تم تغيير الاسم": "Name changed",
  "حذف الدور": "Delete role",
  "حذف دور": "Delete a role",
  "تم حذف الدور": "Role deleted",
  "الاسم المعروض": "Display name",
  "هذا أحد أدوار النظام الأساسية: تُعدَّل صلاحياته ولا يُحذف.":
    "This is a built-in role: its permissions can change, but it cannot be deleted.",
  "مثال: مشرف وردية": "Example: shift supervisor",
  "الرمز: حروف إنجليزية صغيرة وأرقام وشرطة سفلية، ٣ أحرف على الأقل":
    "Code: lowercase letters, digits and underscore, at least 3 characters",
  "تم إنشاء الدور": "Role created",
  "متصل الآن": "Online now",
  "لم يدخل بعد": "Never signed in",
  "الحضور": "Presence",
  "لا أحد متصل": "Nobody online",

  // ---------- الإعدادات ----------
  "حسابي": "My account",
  "تغيير كلمة المرور": "Change password",
  "المستخدمون": "Users",
  "إضافة مستخدم": "Add user",
  "إضافة مستخدم جديد": "Add a new user",
  "الاسم بالكامل": "Full name",
  "إنشاء الحساب": "Create account",
  "أدخل الاسم": "Enter the name",
  "أدخل اسم المستخدم": "Enter the username",
  "أدخل كلمة المرور": "Enter the password",
  "أدخل الاسم أولًا": "Enter the name first",
  "كلمة المرور ٦ أحرف على الأقل": "Password must be at least 6 characters",
  "٦ أحرف على الأقل": "At least 6 characters",
  "تم إنشاء الحساب": "Account created",
  "كلمة المرور الجديدة": "New password",
  "تأكيد كلمة المرور": "Confirm password",
  "كلمتا المرور غير متطابقتين": "Passwords do not match",
  "تم تغيير كلمة المرور": "Password changed",
  "إيقاف المستخدم": "Disable user",
  "تفعيل المستخدم": "Enable user",
  "لن يستطيع هذا المستخدم الدخول للنظام.": "This user will not be able to sign in.",
  "سيستطيع المستخدم الدخول مرة أخرى.": "This user will be able to sign in again.",
  "إيقاف": "Disable",
  "تفعيل": "Enable",
  "لا يوجد مستخدمون": "No users",
  "الموردون والمشاريع والفئات": "Suppliers, projects and categories",
  "الموردون": "Suppliers",
  "المشاريع": "Projects",
  "الفئات": "Categories",
  "إضافة مورد": "Add supplier",
  "إضافة مشروع": "Add project",
  "إضافة فئة": "Add category",
  "اسم الفئة": "Category name",
  "اسم المورد": "Supplier name",
  "اسم المشروع": "Project name",
  "إعدادات النظام": "System settings",
  "الوضع الافتراضي: ممنوع — النظام يرفض أي إذن صرف يتجاوز الرصيد.":
    "Default: blocked — the system rejects any issue that exceeds the balance.",
  "الحد الأدنى الافتراضي للأصناف الجديدة": "Default minimum for new items",
  "حفظ الإعدادات": "Save settings",
  "تم حفظ الإعدادات": "Settings saved",
  "النسخ الاحتياطي والصيانة": "Backup and maintenance",
  "تنزيل نسخة كاملة (Excel)": "Download a full copy (Excel)",
  "إعادة حساب كل الأرصدة": "Recalculate all balances",
  "إعادة حساب الأرصدة": "Recalculate balances",
  "إعادة الحساب": "Recalculate",
  "نسخة_احتياطية_المخزن": "store_backup",
  "تم تنزيل النسخة الاحتياطية": "Backup downloaded",
  "المعرف": "ID",
  "معرف الصنف": "Item ID",
  "النظام": "System",
  "الإصدار": "Version",
  "التطوير": "Development",
  "تحت التطوير المستمر": "Under continuous development",
  "عن النظام": "About",

  // ---------- الجرد ----------
  "جلسة جرد جديدة": "New stocktake session",
  "عنوان الجرد": "Stocktake title",
  "جرد نهاية الشهر": "Month-end stocktake",
  "تاريخ الجرد": "Stocktake date",
  "كشف الجرد": "Count sheet",
  "تنزيل كشف فارغ": "Download a blank sheet",
  "طباعة الكشف": "Print sheet",
  "رصيد النظام": "System balance",
  "الكمية الفعلية": "Counted quantity",
  "الفعلي": "Counted",
  "حفظ الجرد": "Save stocktake",
  "تفريغ المُدخَل": "Clear entries",
  "سجل الجرد السابق": "Previous stocktakes",
  "العنوان": "Title",
  "مُرحَّل": "Posted",
  "سيتم مسح كل الكميات التي أدخلتها في هذه الجلسة.":
    "All quantities you entered in this session will be cleared.",
  "أصناف تم عدّها": "Items counted",
  "مطابق للنظام": "Matches the system",
  "إجمالي الزيادة": "Total surplus",
  "إجمالي العجز": "Total shortage",
  "العجز": "Shortage",
  "ليس لديك صلاحية تنفيذ الجرد": "You do not have permission to run a stocktake",
  "أدخل الكمية الفعلية لصنف واحد على الأقل":
    "Enter the counted quantity for at least one item",
  "لا يمكن إدخال كمية سالبة": "A negative quantity is not allowed",
  "تاريخ الجرد في المستقبل": "The stocktake date is in the future",
  "ترحيل فروقات الجرد": "Post stocktake differences",
  "وترحيل الفروقات": "and post the differences",
  "لا توجد جلسات جرد سابقة": "No previous stocktakes",
  "كشف جرد المخزن": "Store count sheet",

  // ---------- التقارير ----------
  "اختر التقرير": "Choose a report",
  "نوع التقرير": "Report type",
  "حركة صنف خلال فترة": "Item movement over a period",
  "مصروفات مشروع": "Project consumption",
  "الأصناف الأكثر صرفًا": "Most issued items",
  "أصناف تحت الحد الأدنى": "Items below minimum",
  "أصناف نفدت": "Out-of-stock items",
  "أصناف تحت الحد": "Items below minimum",
  "اكتب الكود أو الاسم": "Type the code or name",
  "تشغيل التقرير": "Run report",
  "شغّل التقرير أولًا": "Run the report first",
  "اختر صنفًا من القائمة": "Choose an item from the list",
  "اختر مشروعًا": "Choose a project",
  "الرصيد بعد الحركة": "Balance after",
  "رصيد أول المدة": "Opening balance",
  "إجمالي الوارد": "Total received",
  "إجمالي المنصرف": "Total issued",
  "إجمالي الكميات": "Total quantity",
  "إجمالي القيمة": "Total value",
  "عدد الأصناف المتحركة": "Items with movement",
};

// أنماط للنصوص المركّبة مع أرقام — لا يمكن وضعها في القاموس كما هي
const PATTERNS = [
  [/^عرض (.+?)–(.+?) من (.+?) سجل$/, (m) => `Showing ${m[1]}–${m[2]} of ${m[3]} records`],
  [/^صفحة (.+)$/, (m) => `Page ${m[1]}`],
  [/^(.+?) صنف \/ (.+?) وحدة$/, (m) => `${m[1]} items / ${m[2]} units`],
  [/^(.+?) صنف$/, (m) => `${m[1]} items`],
  [/^(.+?) مستخدم$/, (m) => `${m[1]} users`],
  [/^(.+?) متصل الآن$/, (m) => `${m[1]} online now`],
  [/^(.+?) نوافذ$/, (m) => `${m[1]} windows`],
  [/^منذ (.+?) دقيقة$/, (m) => `${m[1]} min ago`],
  [/^منذ (.+?) ساعة$/, (m) => `${m[1]} h ago`],
  [/^منذ (.+?) يوم$/, (m) => `${m[1]} d ago`],
  [/^الإصدار (.+)$/, (m) => `Version ${m[1]}`],
  [/^تم تسجيل الإذن (.+)$/, (m) => `Voucher ${m[1]} recorded`],
  [/^تم حذف الإذن (.+)$/, (m) => `Voucher ${m[1]} deleted`],
];

// ============================================================
//  الحالة
// ============================================================
let lang = "ar";
const missing = new Set();

export function currentLang() { return lang; }

export function t(text) {
  if (lang === "ar") return text;
  const key = String(text).trim();
  if (!key) return text;
  if (EN[key]) return EN[key];

  for (const [re, fn] of PATTERNS) {
    const m = key.match(re);
    if (m) return fn(m);
  }

  if (/[\u0600-\u06FF]/.test(key)) missing.add(key);
  return text;
}

// الأرقام العربية-الهندية تُقرأ خطأً في سياق إنجليزي
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
function westernize(text) {
  return text.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

// ============================================================
//  الترجمة على الصفحة
//
//  ثلاثة قيود تحكم هذا الجزء، وتجاهل أيّها يُجمّد الواجهة:
//
//  1) الترجمة تعدّل الصفحة، والمراقب يرصد التعديلات. بلا حاجز
//     تُغذّي الترجمةُ المراقبَ فيعيد استدعاءها بلا نهاية.
//     لذلك نوقف المراقب أثناء الترجمة ونعيده بعدها.
//
//  2) الشاشات تُعيد رسم جداول كاملة دفعة واحدة، فتصل مئات الإشعارات
//     في أجزاء من الثانية. نجمعها في طابور ونعالجها مرة واحدة عند
//     الإطار التالي بدل مرة لكل عقدة.
//
//  3) لا نراقب characterData إطلاقًا: الشاشات تستبدل innerHTML، فرصد
//     childList يكفي، ورصد النص يضاعف العمل بلا فائدة.
// ============================================================
const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, SVG: 1, CODE: 0 };

const AR_RE = /[\u0600-\u06FF]/;

let observer = null;
let queue = [];
let scheduled = false;

function translateText(node) {
  const original = node.__ar !== undefined ? node.__ar : node.nodeValue;
  if (!AR_RE.test(original)) return;
  node.__ar = original;

  if (lang === "ar") {
    if (node.nodeValue !== original) node.nodeValue = original;
    return;
  }

  // المسافات حول النص جزء من التخطيط: نترجم اللبّ ونعيده بين مسافاته
  const core = original.trim();
  const lead = original.slice(0, original.indexOf(core));
  const tail = original.slice(original.indexOf(core) + core.length);
  const next = lead + westernize(t(core)) + tail;
  if (node.nodeValue !== next) node.nodeValue = next;
}

function translateAttrs(el) {
  for (let i = 0; i < ATTRS.length; i++) {
    const attr = ATTRS[i];
    if (!el.hasAttribute(attr)) continue;
    const store = "__ar_" + attr;
    const original = el[store] !== undefined ? el[store] : el.getAttribute(attr);
    if (!AR_RE.test(original)) continue;
    el[store] = original;
    const next = lang === "ar" ? original : westernize(t(original));
    if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
  }
}

export function translateTree(root) {
  if (!root) return;

  if (root.nodeType === 3) { translateText(root); return; }
  if (root.nodeType !== 1) return;
  if (SKIP_TAGS[root.tagName]) return;

  translateAttrs(root);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === 1 && SKIP_TAGS[node.tagName]) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === 3) translateText(node);
    else translateAttrs(node);
  }
}

/** ترجمة محمية: يُوقف المراقب حتى لا ترصد الترجمةُ نفسَها. */
function translateGuarded(nodes) {
  if (observer) observer.disconnect();
  try {
    for (let i = 0; i < nodes.length; i++) translateTree(nodes[i]);
  } finally {
    if (observer) observe();
  }
}

function observe() {
  observer.observe(document.body, { childList: true, subtree: true });
}

function flush() {
  scheduled = false;
  const batch = queue;
  queue = [];
  if (!batch.length || lang === "ar") return;
  translateGuarded(batch);
}

// ============================================================
//  التبديل
// ============================================================
export function setLang(next) {
  lang = next === "en" ? "en" : "ar";
  try { localStorage.setItem(LS_LANG, lang); } catch (e) {}

  const html = document.documentElement;
  html.setAttribute("lang", lang);
  html.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  html.classList.toggle("lang-en", lang === "en");

  queue = [];
  translateGuarded([document.body]);
  paintButton();
}

export function startI18n() {
  let saved = "ar";
  try { saved = localStorage.getItem(LS_LANG) || "ar"; } catch (e) {}

  mountButton();

  observer = new MutationObserver((records) => {
    if (lang === "ar") return;
    for (let i = 0; i < records.length; i++) {
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j++) queue.push(added[j]);
    }
    if (queue.length && !scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  });

  setLang(saved);
  observe();

  // ما لم يُترجَم بعد — للاستكمال التدريجي
  window.mpMissing = () => {
    const list = [...missing].sort();
    console.log("نصوص بلا ترجمة (" + list.length + "):");
    list.forEach((s) => console.log('  "' + s + '": "",'));
    return list;
  };
}

function mountButton() {
  if (document.getElementById("btnLang")) return;
  const refresh = document.getElementById("btnRefresh");
  if (!refresh) return;

  const btn = document.createElement("button");
  btn.id = "btnLang";
  btn.type = "button";
  btn.className = "icon-btn lang-btn";
  btn.addEventListener("click", () => setLang(lang === "ar" ? "en" : "ar"));
  refresh.parentNode.insertBefore(btn, refresh);
}

function paintButton() {
  const btn = document.getElementById("btnLang");
  if (!btn) return;
  // الزر يعرض اللغة التي سينتقل إليها، لا التي نحن فيها
  btn.textContent = lang === "ar" ? "EN" : "ع";
  btn.title = lang === "ar" ? "Switch to English" : "التحويل إلى العربية";
  btn.setAttribute("aria-label", btn.title);
}
