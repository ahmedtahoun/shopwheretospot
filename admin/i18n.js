// Arabic / English for the team dashboard.
//
// Loaded before admin.js. It picks the language (the person's last choice on this device, else
// English), sets <html lang dir>, and translates the dashboard's English text as it appears —
// pages, drawers, messages and confirmations. Customer names, products and notes are left as typed.
// The switch: any element with data-lang-toggle (sign-in screen, side menu, phone top bar).
(function () {
  var KEY = 'wts_admin_lang';
  var lang = null;
  try {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'ar' || q === 'en') { lang = q; localStorage.setItem(KEY, q); }
    else lang = localStorage.getItem(KEY);
  } catch (e) {}
  if (lang !== 'ar') lang = 'en';
  var AR = lang === 'ar';
  var html = document.documentElement;
  html.lang = lang;
  html.dir = AR ? 'rtl' : 'ltr';
  window.WTS_LANG = lang;

  function setLang(next) {
    try { localStorage.setItem(KEY, next); } catch (e) {}
    var u = new URL(location.href);
    u.searchParams.delete('lang');
    location.replace(u.pathname + u.search + u.hash);
  }

  // Arabic counts: forms = [one, two, 3–10, 11+], e.g. ['طلب واحد', 'طلبان', 'طلبات', 'طلبًا'].
  function n(c, f) { c = +c; return c === 1 ? f[0] : c === 2 ? f[1] : c >= 3 && c <= 10 ? c + ' ' + f[2] : c + ' ' + f[3]; }
  var ORD = ['طلب واحد', 'طلبان', 'طلبات', 'طلبًا'];
  var SHIP = ['شحنة واحدة', 'شحنتان', 'شحنات', 'شحنة'];
  var DAYS = ['يوم واحد', 'يومان', 'أيام', 'يومًا'];

  // Exact strings (whitespace is collapsed before lookup).
  var D = {
    // shell
    'Loading…': 'جارٍ التحميل…', 'Menu': 'القائمة', 'Team workspace': 'مساحة عمل الفريق', 'Search': 'بحث', 'Workspace': 'العمل', 'Shop': 'المتجر',
    'View shop': 'عرض المتجر', 'Install the app': 'تثبيت التطبيق', 'Password': 'كلمة المرور', 'Sign out': 'تسجيل الخروج', 'Close': 'إغلاق',
    'Dashboard': 'الرئيسية', 'Orders': 'الطلبات', 'Quotes': 'عروض الأسعار', 'Customers': 'العملاء', 'Products': 'المنتجات', 'Promo codes': 'أكواد الخصم',
    'Leads': 'العملاء المحتملون', 'Team': 'الفريق', 'Activity': 'سجل النشاط', 'Backups': 'النسخ الاحتياطية', 'Settings': 'الإعدادات',
    'owner': 'المالك', 'manager': 'مدير', 'sales': 'مبيعات', 'staff': 'موظف', 'telesales': 'مبيعات تليفونية',
    'Everything, including team, settings and revenue': 'كل شيء، بما فيه الفريق والإعدادات والإيرادات',
    'Products, orders, leads, activity and revenue': 'المنتجات والطلبات والعملاء المحتملون والنشاط والإيرادات',
    'Enters orders and leads · sees only their own orders · no revenue': 'يسجّل الطلبات والعملاء المحتملين · يرى طلباته فقط · بدون إيرادات',
    'Orders only · sees only the orders they entered · order counts, no revenue': 'الطلبات فقط · يرى الطلبات التي سجّلها فقط · عدد الطلبات بدون إيرادات',
    '→': '←', '←': '→', ',': '،', 'or': 'أو',

    // sign in
    'Can’t reach the server': 'تعذّر الوصول للخادم', 'Orders, leads and production,': 'الطلبات والعملاء والإنتاج،', 'in one place.': 'في مكان واحد.',
    'The Where To Spot team workspace.': 'مساحة عمل فريق Where To Spot.', 'Welcome back': 'أهلًا بعودتك',
    'Sign in to the Where To Spot team workspace.': 'سجّل الدخول لمساحة عمل فريق Where To Spot.', 'Email': 'البريد الإلكتروني', 'Sign in': 'تسجيل الدخول',
    'Create the owner account': 'إنشاء حساب المالك', 'Setup key': 'مفتاح الإعداد', 'Your name': 'اسمك', 'At least 8 characters': '8 أحرف على الأقل',
    'Create account': 'إنشاء الحساب', 'Change password': 'تغيير كلمة المرور', 'Current password': 'كلمة المرور الحالية', 'New password': 'كلمة المرور الجديدة',
    'Cancel': 'إلغاء', 'Save password': 'حفظ كلمة المرور', 'Password changed': 'تم تغيير كلمة المرور',
    'First-time setup. Enter the setup key from': 'إعداد لأول مرة. أدخل مفتاح الإعداد من',
    'on the server (open it in cPanel → File Manager). The key stops working once this account exists.': 'على الخادم (افتحه من cPanel ← File Manager). يتوقف المفتاح عن العمل بعد إنشاء هذا الحساب.',

    // dashboard
    '+ New order': '+ طلب جديد', 'Revenue': 'الإيرادات', 'excl. cancelled & returned': 'بدون الملغي والمرتجع', 'Waiting to confirm': 'في انتظار التأكيد',
    'Call them now →': 'اتصل بهم الآن ←', 'Shipped': 'تم الشحن', 'on the way now': 'في الطريق الآن', 'Delivered': 'تم التسليم', 'all time': 'منذ البداية',
    'Cancelled / returned': 'ملغي / مرتجع', 'To collect': 'المطلوب تحصيله', 'everything is paid': 'كل شيء مدفوع', 'Open quotes': 'عروض أسعار مفتوحة',
    'View →': 'عرض ←', 'Make a quote →': 'اعمل عرض سعر ←', 'View pending →': 'عرض المعلّقة ←', 'orders': 'طلبات', 'New leads': 'عملاء محتملون جدد',
    'Open leads →': 'فتح العملاء المحتملين ←', 'Live products': 'منتجات معروضة', 'Manage →': 'إدارة ←', 'Daily revenue (EGP)': 'الإيرادات اليومية (ج.م)',
    'Orders per day': 'الطلبات في اليوم', 'Recent orders': 'أحدث الطلبات', 'All orders': 'كل الطلبات', 'No orders yet.': 'لا توجد طلبات بعد.', 'Manage': 'إدارة',
    'The first backup will be saved in a moment.': 'سيتم حفظ أول نسخة احتياطية بعد قليل.', 'Estimated profit': 'الربح التقديري',
    'Add a cost price to your products (Products → edit → Cost) and profit for this period appears here.': 'أضف سعر التكلفة لمنتجاتك (المنتجات ← تعديل ← التكلفة) وسيظهر ربح هذه الفترة هنا.',
    'Where leads come from': 'مصادر العملاء المحتملين', 'Orders by status': 'الطلبات حسب الحالة', 'Top products': 'المنتجات الأكثر مبيعًا',
    'No sales in this period.': 'لا توجد مبيعات في هذه الفترة.', 'Low stock': 'مخزون منخفض', '⚠ 5 or fewer': '⚠ 5 أو أقل', 'All products are well stocked.': 'كل المنتجات متوفرة بكمية كافية.',
    'Orders by source': 'الطلبات حسب المصدر', 'Follow up today': 'متابعة اليوم', 'View all': 'عرض الكل',
    'Nothing due. Set a follow-up date on a lead and it shows here on that day.': 'لا يوجد شيء مستحق. حدّد تاريخ متابعة للعميل المحتمل وسيظهر هنا في ذلك اليوم.',
    '✓ Target reached': '✓ تم تحقيق الهدف', 'No target set for this month': 'لا يوجد هدف لهذا الشهر', '🎯 Set targets': '🎯 تحديد الأهداف',
    'Team member': 'عضو الفريق', 'Sales (EGP)': 'المبيعات (ج.م)', 'Last order': 'آخر طلب',
    'No team orders yet this month. Add sales people in Team, set their targets, and orders they enter will show here.': 'لا توجد طلبات للفريق هذا الشهر بعد. أضف موظفي المبيعات في الفريق وحدد أهدافهم، وستظهر طلباتهم هنا.',
    'Orders count toward whoever they’re credited to: the person who entered them, or the referral code used on the website.': 'يُحسب الطلب لمن نُسب إليه: الشخص الذي سجّله، أو صاحب كود الإحالة المستخدم في الموقع.',
    'Monthly targets': 'الأهداف الشهرية', 'Month': 'الشهر', 'Orders target': 'هدف الطلبات', 'Sales target (EGP)': 'هدف المبيعات (ج.م)', 'So far': 'حتى الآن',
    'Leave a target empty or 0 for people who don’t sell.': 'اترك الهدف فارغًا أو 0 لمن لا يبيع.', 'Save targets': 'حفظ الأهداف', 'Targets saved': 'تم حفظ الأهداف',
    'Daily revenue bar chart': 'رسم الإيرادات اليومية',

    // order statuses, sources, payment
    'Awaiting payment': 'في انتظار الدفع', 'Pending': 'في انتظار التأكيد', 'Confirmed': 'مؤكد', 'Designing': 'قيد التصميم', 'Awaiting approval': 'في انتظار الموافقة',
    'In production': 'قيد التنفيذ', 'Ready': 'جاهز', 'Cancelled': 'ملغي', 'Returned': 'مرتجع',
    'Website': 'الموقع', 'Phone': 'الهاتف', 'WhatsApp': 'واتساب', 'Instagram': 'إنستجرام', 'Facebook': 'فيسبوك', 'TikTok': 'تيك توك', 'Walk-in': 'زيارة للمقر', 'Referral': 'إحالة', 'Other': 'أخرى',
    'Website chat': 'شات الموقع', 'Quote form': 'نموذج عرض السعر', 'Orders (customers)': 'الطلبات (عملاء)', 'Added by team': 'أضافه الفريق',
    'Unfinished online payment': 'دفع إلكتروني لم يكتمل', 'Home — bulk inquiry': 'الرئيسية — استفسار كميات', 'Shop — bulk inquiry': 'المتجر — استفسار كميات', 'chat': 'الشات',
    'Cash on delivery': 'الدفع عند الاستلام', 'Paid — bank transfer': 'مدفوع — تحويل بنكي', 'Paid — InstaPay / wallet': 'مدفوع — إنستاباي / محفظة',
    'Paid — cash in hand': 'مدفوع — نقدًا باليد', 'Online — card (Paymob)': 'أونلاين — بطاقة (Paymob)', 'Online — mobile wallet (Paymob)': 'أونلاين — محفظة موبايل (Paymob)',
    'Cash': 'نقدًا', 'Bank transfer': 'تحويل بنكي', 'InstaPay / wallet': 'إنستاباي / محفظة', 'Collected on delivery': 'تم التحصيل عند التسليم', 'Paid online (Paymob)': 'مدفوع أونلاين (Paymob)',
    '✓ Paid': '✓ مدفوع',

    // orders list
    'List': 'قائمة', 'Production board': 'لوحة الإنتاج', '↻ Sync Bosta': '↻ تحديث بوسطة', 'Syncing…': 'جارٍ التحديث…', 'Export CSV': 'تصدير CSV', 'All': 'الكل',
    'Ask Bosta for the latest state of every open shipment': 'اسأل بوسطة عن آخر حالة لكل شحنة مفتوحة',
    'Search name, phone, email or WTS-…': 'ابحث بالاسم أو الهاتف أو الإيميل أو WTS-…', '🚚 Create Bosta shipments': '🚚 إنشاء شحنات بوسطة', '🖨 Print waybills': '🖨 طباعة البوالص',
    'Delete': 'حذف', 'Delete test or mistaken orders for good': 'حذف الطلبات التجريبية أو الخاطئة نهائيًا', 'Select all': 'تحديد الكل',
    'Order': 'الطلب', 'Customer': 'العميل', 'Items': 'المنتجات', 'Status': 'الحالة', 'Bosta': 'بوسطة', 'Date': 'التاريخ', 'Total': 'الإجمالي',
    'No orders match.': 'لا توجد طلبات مطابقة.', 'No orders': 'لا توجد طلبات', 'Move back': 'رجوع خطوة', 'Created': 'تم الإنشاء',
    'Delivered, cancelled and returned orders are in the List view. Bosta moves shipped orders forward automatically.': 'الطلبات المسلّمة والملغاة والمرتجعة موجودة في عرض القائمة. بوسطة تنقل الطلبات المشحونة تلقائيًا.',

    // Bosta
    'Package size': 'حجم الطرد', 'Pick up from': 'الاستلام من', 'SMALL': 'صغير', 'MEDIUM': 'متوسط', 'LARGE': 'كبير', 'no area': 'بدون منطقة',
    'Create shipments': 'إنشاء الشحنات', 'Creating…': 'جارٍ الإنشاء…', 'Done': 'تم',
    '🚚 Bosta shipping isn’t connected yet — add your Bosta API key in': '🚚 شحن بوسطة غير مربوط بعد — أضف مفتاح Bosta API في',
    '🚚 Bosta shipment': '🚚 شحنة بوسطة', 'Tracking number': 'رقم التتبع', '🖨 Print waybill': '🖨 طباعة البوليصة', '↻ Refresh status': '↻ تحديث الحالة',
    'Track on Bosta ↗': 'تتبّع على بوسطة ↗', 'Cancel shipment': 'إلغاء الشحنة', '🚚 Nothing to ship — this order only has marketing plans.': '🚚 لا يوجد ما يُشحن — هذا الطلب فيه خطط تسويق فقط.',
    '🚚 Cancelled orders can’t be shipped.': '🚚 لا يمكن شحن الطلبات الملغاة.', '🚚 Ship with Bosta': '🚚 الشحن مع بوسطة', 'Deliver to': 'التوصيل إلى',
    'Area not chosen yet': 'لم يتم اختيار المنطقة بعد', 'Courier collects': 'المندوب يحصّل', 'Nothing (paid)': 'لا شيء (مدفوع)', 'Create Bosta shipment': 'إنشاء شحنة بوسطة',
    'Change area, address or package': 'تغيير المنطقة أو العنوان أو الطرد', 'Choose the delivery area first': 'اختر منطقة التوصيل أولًا', 'Find area': 'ابحث عن المنطقة',
    'Type in English or Arabic, e.g. Nasr City / مدينة نصر': 'اكتب بالعربي أو الإنجليزي، مثل: مدينة نصر / Nasr City', '🔍 Search Bosta areas': '🔍 ابحث في مناطق بوسطة',
    'Governorate': 'المحافظة', 'Area': 'المنطقة', 'Choose governorate first': 'اختر المحافظة أولًا', 'Neighbourhood': 'الحي', 'Street address': 'عنوان الشارع',
    'More than 5 characters': 'أكثر من 5 أحرف', 'Building': 'العمارة', 'Floor': 'الدور', 'Apartment': 'الشقة', 'Nearby landmark': 'علامة مميزة قريبة',
    'Cash to collect (EGP)': 'المبلغ المطلوب تحصيله (ج.م)', 'Notes for the courier': 'ملاحظات للمندوب', 'e.g. Call before arriving': 'مثال: اتصل قبل الوصول',
    'Choose area': 'اختر المنطقة', 'Choose governorate': 'اختر المحافظة', 'Couldn’t load Bosta areas': 'تعذّر تحميل مناطق بوسطة', 'No match': 'لا توجد نتائج',
    '✨ From the address:': '✨ من العنوان:', 'Add the street address (at least 6 characters)': 'أضف عنوان الشارع (6 أحرف على الأقل)', 'Shipment cancelled': 'تم إلغاء الشحنة',
    'Pickup requested': 'طلب استلام', 'Waiting for route': 'في انتظار خط السير', 'Route assigned': 'تم تحديد خط السير', 'Picked up from business': 'تم الاستلام من المتجر',
    'Picking up from consignee': 'جارٍ الاستلام من العميل', 'Picked up from consignee': 'تم الاستلام من العميل', 'Received at warehouse': 'وصلت المخزن', 'Fulfilled': 'تم التجهيز',
    'In transit between hubs': 'في الطريق بين الفروع', 'Picking up': 'جارٍ الاستلام', 'Out for delivery': 'خرجت للتوصيل', 'Returned to business': 'رجعت للمتجر',
    'Exception': 'مشكلة في التوصيل', 'Terminated': 'تم الإنهاء', 'Canceled': 'ملغاة', 'Returned to stock': 'رجعت للمخزون', 'Lost': 'مفقودة', 'Damaged': 'تالفة',
    'Investigation': 'قيد التحقيق', 'Awaiting your action': 'في انتظار إجراء منك', 'Archived': 'مؤرشف', 'On hold': 'معلّقة', 'Deleted on Bosta': 'تم حذفها على بوسطة',

    // payments card
    'Payments': 'المدفوعات', '✓ Paid in full': '✓ مدفوع بالكامل', 'No payments recorded yet.': 'لم يتم تسجيل مدفوعات بعد.', 'Amount': 'المبلغ',
    'Amount received': 'المبلغ المستلم', 'Note (optional)': 'ملاحظة (اختياري)', 'Record payment': 'تسجيل دفعة', 'Delete payment': 'حذف الدفعة',
    'Deposit, transfer or cash received. Use a minus amount for a refund. When the order is marked Delivered, any balance is recorded as collected.': 'عربون أو تحويل أو نقدية مستلمة. اكتب المبلغ بالسالب للاسترداد. عند تحويل الطلب إلى "تم التسليم" يُسجَّل الباقي كمحصَّل.',
    'Delete this payment?': 'حذف هذه الدفعة؟', 'Payment recorded': 'تم تسجيل الدفعة',

    // order drawer
    'Subtotal': 'المجموع الفرعي', 'Free delivery': 'توصيل مجاني', 'Delivery': 'التوصيل', 'Free': 'مجاني', 'Loading payments…': 'جارٍ تحميل المدفوعات…',
    'Print details from the customer': 'بيانات الطباعة من العميل', 'logo, design proof…': 'اللوجو، بروفة التصميم…', 'Logo': 'اللوجو', 'Design proof': 'بروفة التصميم',
    'Final design': 'التصميم النهائي', '⬆ Upload file': '⬆ رفع ملف', 'JPG, PNG, WebP or PDF up to 5 MB': 'JPG أو PNG أو WebP أو PDF حتى 5 ميجا',
    'Cancelling or returning puts the items back in stock.': 'الإلغاء أو الإرجاع يعيد المنتجات للمخزون.',
    'Cancelling or returning puts the items back in stock. Bosta updates move this to Shipped, Delivered or Returned automatically.': 'الإلغاء أو الإرجاع يعيد المنتجات للمخزون. تحديثات بوسطة تنقل الطلب إلى تم الشحن أو تم التسليم أو مرتجع تلقائيًا.',
    'Internal notes': 'ملاحظات داخلية', 'e.g. Confirmed by phone': 'مثال: تم التأكيد بالتليفون', 'Invoice': 'الفاتورة', 'Save': 'حفظ', 'Order updated': 'تم تحديث الطلب',
    'No files yet.': 'لا توجد ملفات بعد.', 'Remove file': 'حذف الملف', 'File uploaded': 'تم رفع الملف', 'Files': 'الملفات',

    // new order
    'Order from quote': 'طلب من عرض السعر', '. Check the delivery area, then create it — the quote will be marked Accepted.': '. راجع منطقة التوصيل ثم أنشئ الطلب — سيتم اعتبار عرض السعر مقبولًا.',
    'Order for lead': 'طلب للعميل المحتمل', 'Quote for lead': 'عرض سعر للعميل المحتمل', '. The lead will move to Quoted.': '. سينتقل العميل المحتمل إلى "تم إرسال عرض".',
    '. The lead will be marked Won.': '. سيتم اعتبار العميل المحتمل "تم البيع".',
    'Type a phone or name — returning customers fill in automatically': 'اكتب رقم الهاتف أو الاسم — بيانات العملاء السابقين تُكمَّل تلقائيًا',
    'Phone / WhatsApp': 'الهاتف / واتساب', 'Name': 'الاسم', 'Search products…': 'ابحث عن منتج…', 'Browse all ▾': 'عرض الكل ▾', 'Close ▴': 'إغلاق ▴', 'Quantity': 'الكمية',
    'Add': 'إضافة', '＋ Custom item (anything not in the catalog)': '＋ منتج خاص (أي شيء غير موجود في الكتالوج)', 'Description, e.g. 30 mixed stands with logo': 'الوصف، مثال: 30 ستاند متنوع باللوجو',
    'Custom quantity': 'كمية المنتج الخاص', '× EGP': '× ج.م', 'each': 'للقطعة', 'Price each': 'سعر القطعة', 'needs delivery': 'يحتاج توصيل',
    'Tip: for "30 for EGP 7,000" enter 30 × 233.33 — totals round to whole pounds.': 'نصيحة: لـ "30 قطعة بـ 7,000 ج.م" اكتب 30 × 233.33 — الإجمالي يُقرَّب لأقرب جنيه.',
    'optional on a quote': 'اختياري في عرض السعر', 'Street, building, floor, apartment': 'الشارع، العمارة، الدور، الشقة', 'Search in English or Arabic, e.g. Nasr City / مدينة نصر': 'ابحث بالعربي أو الإنجليزي، مثل: مدينة نصر / Nasr City',
    'Payment': 'الدفع', 'More options': 'خيارات أكثر', 'email, source, status, deposit, discount, delivery fee, notes': 'الإيميل، المصدر، الحالة، العربون، الخصم، رسوم التوصيل، ملاحظات',
    'Optional — for the invoice': 'اختياري — للفاتورة', 'Source': 'المصدر', 'Paid now (EGP)': 'المدفوع الآن (ج.م)', 'Deposit, or leave empty': 'العربون، أو اتركه فارغًا',
    'Deposit paid by': 'طريقة دفع العربون', 'Discount (EGP)': 'الخصم (ج.م)', 'Delivery fee (EGP)': 'رسوم التوصيل (ج.م)', 'auto': 'تلقائي', 'Credit this sale to': 'تُحسب هذه البيعة لـ',
    'Notes': 'ملاحظات', 'e.g. Customer wants delivery after 5pm': 'مثال: العميل يريد التوصيل بعد 5 مساءً', 'Quote details': 'تفاصيل عرض السعر', 'Customer email': 'إيميل العميل',
    'Optional': 'اختياري', 'Valid until': 'صالح حتى', 'Terms': 'الشروط', 'Printed on the quote': 'تُطبع على عرض السعر', 'Not printed': 'لا تُطبع',
    'Save quote': 'حفظ عرض السعر', 'Create quote': 'إنشاء عرض سعر', 'Create order': 'إنشاء الطلب', 'New quote': 'عرض سعر جديد', 'New order': 'طلب جديد',
    'Auto: free': 'تلقائي: مجاني', 'Discount': 'الخصم', 'Customer pays on delivery': 'العميل يدفع عند الاستلام', 'Already paid — courier collects nothing': 'مدفوع بالفعل — المندوب لا يحصّل شيئًا',
    'custom': 'خاص', 'Remove': 'حذف', 'No products yet.': 'لم تتم إضافة منتجات بعد.', 'No product matches.': 'لا يوجد منتج مطابق.', 'Size': 'المقاس',
    'Choose a product first': 'اختر منتجًا أولًا', 'Enter a description and a price for the custom item': 'اكتب وصفًا وسعرًا للمنتج الخاص', 'Change': 'تغيير',
    '🔍 Type the area': '🔍 اكتب المنطقة', 'No match — try another spelling': 'لا توجد نتائج — جرّب كتابة أخرى', 'Existing customers — tap to fill in': 'عملاء سابقون — اضغط لإكمال البيانات',
    'account': 'حساب', 'lead': 'عميل محتمل', 'website account': 'حساب على الموقع', 'from leads': 'من العملاء المحتملين', 'address filled in': 'تم إكمال العنوان',
    'Add at least one product': 'أضف منتجًا واحدًا على الأقل', 'Choose the delivery area': 'اختر منطقة التوصيل', 'Saving…': 'جارٍ الحفظ…',
    'customer added to Leads': 'تمت إضافة العميل للعملاء المحتملين', 'existing lead updated': 'تم تحديث العميل المحتمل', 'Saved area': 'منطقة محفوظة', '/ month': '/ شهريًا',

    // products
    'Categories': 'الفئات', '+ Add product': '+ إضافة منتج', 'All categories': 'كل الفئات', 'Search name, SKU, brand': 'ابحث بالاسم أو SKU أو الماركة', 'Product': 'المنتج',
    'Category': 'الفئة', 'Price': 'السعر', 'Stock': 'المخزون', 'Active': 'نشط', 'Draft': 'مسودة', 'No products here yet.': 'لا توجد منتجات هنا بعد.', 'Add one': 'أضف منتجًا',
    'Product name': 'اسم المنتج', 'Name in Arabic': 'الاسم بالعربي', 'Shown on the Arabic shop': 'يظهر في المتجر العربي', 'Only Active products show in the shop.': 'المنتجات النشطة فقط تظهر في المتجر.',
    'Price (EGP)': 'السعر (ج.م)', 'Price for one piece': 'سعر القطعة الواحدة', 'Discount %': 'الخصم %', 'Ignored for plans': 'لا يُستخدم للخطط', 'Needs personalisation': 'يحتاج تخصيص',
    'Checkout asks for business name, review link, logo and design notes': 'صفحة الدفع تطلب اسم النشاط ورابط التقييم واللوجو وملاحظات التصميم', 'Cost (EGP)': 'التكلفة (ج.م)',
    'Private — not shown in shop': 'خاص — لا يظهر في المتجر', 'Brand / vendor': 'الماركة / المورد', 'Short line': 'سطر قصير', 'e.g. 150ml, hydrating cleanser': 'مثال: 150 مل، غسول مرطب',
    'Badge': 'شارة', 'e.g. 3+1 Free, New': 'مثال: 3+1 مجانًا، جديد', 'Short line in Arabic': 'السطر القصير بالعربي', 'Description': 'الوصف', 'Description in Arabic': 'الوصف بالعربي',
    'Features / bullet points': 'المميزات / النقاط', 'One per line (shown on plan cards)': 'واحدة في كل سطر (تظهر في كروت الخطط)', 'Photos': 'الصور',
    'First photo is the cover. JPG, PNG or WebP up to 5 MB — big photos are resized automatically.': 'أول صورة هي الغلاف. JPG أو PNG أو WebP حتى 5 ميجا — الصور الكبيرة يتم تصغيرها تلقائيًا.',
    'Save the product first, then add photos.': 'احفظ المنتج أولًا، ثم أضف الصور.', 'Create product': 'إنشاء المنتج', 'Save changes': 'حفظ التغييرات', 'Add product': 'إضافة منتج',
    'Product created — now add photos': 'تم إنشاء المنتج — أضف الصور الآن', 'Saved': 'تم الحفظ', 'Product deleted': 'تم حذف المنتج',
    'Quantity prices': 'أسعار الكميات', 'price per piece from that quantity — e.g. 3 for EGP 1,000 → 333.33': 'سعر القطعة من هذه الكمية — مثال: 3 بـ 1,000 ج.م ← 333.33', 'From': 'من',
    'pcs → EGP': 'قطعة ← ج.م', 'Remove price': 'حذف السعر', '+ Price break': '+ سعر كمية', 'Sizes & prices': 'المقاسات والأسعار', 'Comes in sizes': 'له مقاسات',
    'Size, e.g. 15×10 cm': 'المقاس، مثال: 15×10 سم', 'Remove size': 'حذف المقاس', '+ Add size': '+ إضافة مقاس', 'Extras': 'الإضافات',
    'Choices like Standard / Custom design. The first option is the default.': 'اختيارات مثل تصميم عادي / تصميم خاص. الاختيار الأول هو الافتراضي.', 'Group name, e.g. Design': 'اسم المجموعة، مثال: التصميم',
    'Remove group': 'حذف المجموعة', 'Option, e.g. Custom design': 'الاختيار، مثال: تصميم خاص', '+ EGP': '+ ج.م', 'per piece': 'للقطعة', 'once per order': 'مرة واحدة للطلب',
    'Remove option': 'حذف الاختيار', '+ Option': '+ اختيار', '+ Extras group': '+ مجموعة إضافات', '+ Standard / Custom design': '+ تصميم عادي / خاص',
    'Remove all sizes and their prices and stock?': 'حذف كل المقاسات وأسعارها ومخزونها؟', 'Optional — the lowest size / quantity price is used': 'اختياري — يُستخدم أقل سعر مقاس / كمية',
    'Cover': 'الغلاف', 'Move left': 'تحريك لليسار', 'Remove photo': 'حذف الصورة', 'Move right': 'تحريك لليمين', '＋ Add photos': '＋ إضافة صور', 'or drop them here': 'أو اسحبها هنا',
    'Photos saved': 'تم حفظ الصور', 'Remove this photo?': 'حذف هذه الصورة؟',
    'Categories with at least one Active product appear in the shop. Order sets their position.': 'الفئات التي بها منتج نشط واحد على الأقل تظهر في المتجر. الترتيب يحدد مكانها.',
    'New category': 'فئة جديدة', 'Short description': 'وصف قصير', 'Add category': 'إضافة فئة', 'Category saved': 'تم حفظ الفئة', 'Delete this category?': 'حذف هذه الفئة؟',
    'Category deleted': 'تم حذف الفئة', 'Category added': 'تمت إضافة الفئة', 'Design': 'التصميم', 'Standard design': 'تصميم عادي', 'Custom design': 'تصميم خاص',

    // leads
'Enquiries from the website chat and quote form, customers from orders, and leads your team adds.': 'استفسارات من شات الموقع ونموذج عرض السعر، وعملاء من الطلبات، وعملاء يضيفهم فريقك.',
    'Board': 'لوحة', '+ Add lead': '+ إضافة عميل محتمل', 'New': 'جديد', 'Contacted': 'تم التواصل', 'Quoted': 'تم إرسال عرض', 'Won': 'تم البيع', 'Follow up due': 'متابعة مستحقة',
    'Search name, phone, interest…': 'ابحث بالاسم أو الهاتف أو الاهتمام…', 'Contact': 'التواصل', 'Interest': 'الاهتمام', 'Follow up': 'المتابعة', 'Assigned': 'المسؤول',
    'Received': 'تاريخ الوصول', 'No follow-ups due. Nice work.': 'لا توجد متابعات مستحقة. عمل رائع.', 'No leads here.': 'لا يوجد عملاء محتملون هنا.', 'No leads': 'لا يوجد',
    '◷ Today': '◷ اليوم', '— Nobody —': '— لا أحد —', 'Call': 'اتصال', 'Convert to order': 'تحويل إلى طلب', 'Email or phone': 'الإيميل أو الهاتف', 'Interested in': 'مهتم بـ',
    'e.g. NFC cards for 3 branches': 'مثال: كروت NFC لـ 3 فروع', 'Assigned to': 'مسؤول المتابعة', 'Follow up on': 'تاريخ المتابعة',
    'It shows on the dashboard from that day until the lead is moved on or the date is cleared': 'يظهر في الرئيسية من ذلك اليوم حتى يتم تحريك العميل المحتمل أو مسح التاريخ',
    'Tomorrow': 'غدًا', 'In 3 days': 'بعد 3 أيام', 'Next week': 'الأسبوع القادم', 'Clear': 'مسح', 'Add lead': 'إضافة عميل محتمل', 'Lead': 'عميل محتمل',
    'Lead saved': 'تم حفظ العميل المحتمل', 'Delete this lead?': 'حذف هذا العميل المحتمل؟', 'Lead deleted': 'تم حذف العميل المحتمل',
    'NFC review cards & stands': 'كروت وستاندات تقييم NFC', 'skincare & cosmetics': 'العناية بالبشرة ومستحضرات التجميل', 'exhibition stands': 'ستاندات المعارض', 'marketing services': 'خدمات التسويق',

    // quotes
    'Prices you offer before an order. Nothing is taken from stock or counted as a sale until the customer accepts.': 'أسعار تعرضها قبل الطلب. لا يُخصم شيء من المخزون ولا يُحسب كبيع حتى يوافق العميل.',
    '+ New quote': '+ عرض سعر جديد', 'Accepted': 'مقبول', 'no answers yet': 'لا توجد ردود بعد', 'Sent': 'تم الإرسال', 'Declined': 'مرفوض', 'Expired': 'منتهي',
    'Quote': 'عرض السعر', 'No quotes yet. Create one here, or from a lead with “Create quote”.': 'لا توجد عروض أسعار بعد. أنشئ واحدًا هنا، أو من عميل محتمل بزر "إنشاء عرض سعر".',
    'Accepted — became order': 'مقبول — أصبح الطلب', 'Open order': 'فتح الطلب', 'Next step': 'الخطوة التالية', 'Open PDF': 'فتح PDF', 'Send on WhatsApp': 'إرسال على واتساب',
    '➜ Mark as sent': '➜ تم الإرسال', 'Customer accepted — create order': 'العميل وافق — إنشاء الطلب', '✕ Declined': '✕ مرفوض',
    'Send the PDF with WhatsApp: open the PDF, save it, then attach it in the chat that opens. Sending marks the quote as Sent.': 'أرسل الـ PDF على واتساب: افتح الـ PDF واحفظه، ثم أرفقه في المحادثة التي تفتح. الإرسال يجعل حالة العرض "تم الإرسال".',
    'Reopen as draft': 'إعادة فتح كمسودة', 'Duplicate': 'نسخ', 'Edit': 'تعديل', 'Quote sent': 'تم إرسال عرض السعر', 'Quote declined': 'تم رفض عرض السعر', 'Quote draft': 'عرض السعر أصبح مسودة',
    'Quote deleted': 'تم حذف عرض السعر',

    // customers
    'With shop account': 'لديهم حساب', 'No account': 'بدون حساب', 'Want offers': 'يريدون العروض', 'Repeat': 'متكرر', 'Search name, phone, business, area…': 'ابحث بالاسم أو الهاتف أو النشاط أو المنطقة…',
    'Spent': 'المصروف', 'Balance due': 'المتبقي', '● Account': '● حساب', '↻ Repeat': '↻ متكرر', 'Signed up on the website': 'سجّل على الموقع', 'No customers match.': 'لا يوجد عملاء مطابقون.',
    'Customers appear here once orders come in.': 'يظهر العملاء هنا عند وصول الطلبات.', 'Total spent': 'إجمالي المصروف', 'still to collect': 'لم يُحصَّل بعد', 'nothing owed': 'لا يوجد مستحق',
    'Shop account': 'حساب المتجر', '● Signed up': '● مسجّل', 'Since': 'منذ', 'Last signed in': 'آخر دخول', 'Contact about orders by': 'التواصل بخصوص الطلبات عن طريق',
    'Phone call': 'مكالمة', 'Offers': 'العروض', '✓ Wants offers': '✓ يريد العروض', 'No': 'لا', 'Language': 'اللغة',
    'No shop account yet — they check out as a guest. After their next order the shop offers to create one.': 'لا يوجد حساب بعد — يطلب كزائر. بعد طلبه القادم سيعرض عليه المتجر إنشاء حساب.',
    'No notes.': 'لا توجد ملاحظات.',

    // install, search
    'Install the team app': 'تثبيت تطبيق الفريق', 'On iPhone or iPad (Safari)': 'على آيفون أو آيباد (Safari)', 'Tap the': 'اضغط على زر', 'Share': 'مشاركة',
    'button (the square with an arrow).': '(المربع الذي به سهم).', 'Choose': 'اختر', 'Add to Home Screen': 'إضافة إلى الشاشة الرئيسية', 'Tap': 'اضغط',
    '. “WTS Team” appears on your home screen.': '. سيظهر "WTS Team" على الشاشة الرئيسية.', 'On Android (Chrome)': 'على أندرويد (Chrome)', 'menu.': '.', 'Install app': 'تثبيت التطبيق',
    'Add to Home screen': 'إضافة إلى الشاشة الرئيسية', 'The app opens full-screen, signs you in like the website, and always shows live data.': 'التطبيق يفتح بملء الشاشة، ويسجّل دخولك مثل الموقع، ويعرض البيانات المباشرة دائمًا.',
    'App installed — find “WTS Team” on your home screen': 'تم تثبيت التطبيق — ستجد "WTS Team" على الشاشة الرئيسية',
    'Search orders, customers, phone numbers, leads, products…': 'ابحث في الطلبات والعملاء وأرقام الهواتف والمنتجات…', 'Esc': 'Esc',
    'Type a name, phone number, order number (e.g. 1001) or product.': 'اكتب اسمًا أو رقم هاتف أو رقم طلب (مثل 1001) أو منتجًا.', 'Type at least 2 characters.': 'اكتب حرفين على الأقل.',
    'Nothing found.': 'لا توجد نتائج.',

    // settings
    'Checks for the parts of the shop that are configured on the server.': 'فحص أجزاء المتجر المضبوطة على الخادم.', 'Checking…': 'جارٍ الفحص…', 'Online payments (Paymob)': 'الدفع الإلكتروني (Paymob)',
    '✓ Active at checkout': '✓ مفعّل في صفحة الدفع', '✕ Not active': '✕ غير مفعّل', 'Settings file (api/config.local.php)': 'ملف الإعدادات (api/config.local.php)', '“paymob” block': 'قسم "paymob"',
    'Secret key': 'المفتاح السري', 'Public key': 'المفتاح العام', 'Card integration ID': 'رقم ربط البطاقات', 'Wallet integration ID': 'رقم ربط المحافظ', 'Shown at checkout': 'يظهر في صفحة الدفع',
    'Card': 'بطاقة', 'Mobile wallet': 'محفظة موبايل', 'not set (wallets hidden)': 'غير مضبوط (المحافظ مخفية)', 'Connection to Paymob': 'الاتصال بـ Paymob', '✓ Keys accepted by Paymob': '✓ Paymob قبل المفاتيح',
    'To fix': 'المطلوب إصلاحه', 'Check again': 'افحص مرة أخرى', 'Test connection with Paymob': 'اختبار الاتصال بـ Paymob', '✓ Test key': '✓ مفتاح تجريبي', '✓ Live key': '✓ مفتاح حقيقي',
    '✓ Set': '✓ مضبوط', '✕ Doesn’t look like a Paymob key': '✕ لا يبدو كمفتاح Paymob', '✕ Missing': '✕ غير موجود',
    'Secret values are never shown here. The connection test asks Paymob to prepare a EGP 1 payment that nobody pays — nothing is charged.': 'القيم السرية لا تظهر هنا أبدًا. اختبار الاتصال يطلب من Paymob تجهيز دفعة بـ 1 ج.م لا يدفعها أحد — لا يتم خصم أي مبلغ.',

    // promos
    'Codes customers type at checkout. Changes work on the shop straight away.': 'أكواد يكتبها العملاء في صفحة الدفع. التغييرات تعمل في المتجر فورًا.', '+ New promo code': '+ كود خصم جديد',
    'Live codes': 'أكواد مفعّلة', 'Orders with a code': 'طلبات بكود', 'Discounts given': 'إجمالي الخصومات', 'Code': 'الكود', 'Rules': 'الشروط', 'Used': 'الاستخدام', 'Sales': 'المبيعات',
    'No limits': 'بدون حدود', 'Off': 'متوقف', 'Used up': 'انتهى الاستخدام', 'Live': 'مفعّل', 'No promo codes yet. Press “New promo code”.': 'لا توجد أكواد خصم بعد. اضغط "كود خصم جديد".',
    'New promo code': 'كود خصم جديد', 'Case-sensitive: customers must type it exactly, e.g. Ramadan15': 'حساس لحالة الأحرف: يجب أن يكتبه العميل كما هو تمامًا، مثل Ramadan15', 'Type': 'النوع',
    'Percentage off (%)': 'خصم بالنسبة (%)', 'Fixed amount off (EGP)': 'خصم مبلغ ثابت (ج.م)', 'Minimum order (EGP)': 'الحد الأدنى للطلب (ج.م)', 'No minimum': 'بدون حد أدنى', 'Max uses': 'أقصى عدد استخدامات',
    'Optional, all customers together': 'اختياري، لكل العملاء معًا', 'Unlimited': 'غير محدود', 'Starts': 'يبدأ', 'Ends (last day)': 'ينتهي (آخر يوم)', 'Note for the team': 'ملاحظة للفريق',
    'Optional, e.g. Instagram campaign': 'اختياري، مثال: حملة إنستجرام', 'Active (customers can use it)': 'مفعّل (يمكن للعملاء استخدامه)', 'Amount off (EGP)': 'مبلغ الخصم (ج.م)', 'Percent off (%)': 'نسبة الخصم (%)',
    'Promo code saved': 'تم حفظ كود الخصم', 'Deleted': 'تم الحذف', 'The customer pays no delivery fee.': 'العميل لا يدفع رسوم توصيل.',

    // backups
    'Back up now': 'نسخ احتياطي الآن', 'Last backup': 'آخر نسخة', 'None yet': 'لا يوجد بعد', 'Copies kept': 'النسخ المحفوظة', 'Keep a copy off the server': 'احتفظ بنسخة خارج الخادم',
    'These copies live on the hosting server, outside the website folder. Once a week, download the latest one and keep it somewhere safe (Google Drive or your computer). If the server is ever lost, that file restores the whole shop.': 'هذه النسخ محفوظة على خادم الاستضافة خارج مجلد الموقع. مرة كل أسبوع، نزّل أحدث نسخة واحفظها في مكان آمن (Google Drive أو جهازك). لو فُقد الخادم، هذا الملف يعيد المتجر بالكامل.',
    'Download': 'تنزيل', 'No backups yet. Press “Back up now”.': 'لا توجد نسخ بعد. اضغط "نسخ احتياطي الآن".', 'How to restore a backup': 'طريقة استرجاع نسخة احتياطية',
    'Reload the dashboard.': 'أعد تحميل لوحة التحكم.', 'In cPanel → File Manager, open the': 'من cPanel ← File Manager افتح مجلد', 'folder.': '.', 'Rename': 'غيّر اسم',
    'to': 'إلى', '(keep it until you’re sure).': '(احتفظ به حتى تتأكد).', 'Upload the backup file and rename it to': 'ارفع ملف النسخة الاحتياطية وغيّر اسمه إلى', '. Delete any': '. واحذف أي ملفات',
    'and': 'و', 'files.': '.',
    'The file api/config.local.php was not found on the server.': 'الملف api/config.local.php غير موجود على الخادم.',
    'api/config.local.php has a typing error (a missing comma, quote or bracket), so none of its settings load. Check the last lines you added.': 'في الملف api/config.local.php خطأ كتابة (فاصلة أو علامة تنصيص أو قوس ناقص)، لذلك لا يتم تحميل أي إعداد. راجع آخر سطور أضفتها.',
    'secret_key: copy the Secret Key (starts with egy_sk_) from Paymob → Settings → Account Info.': 'secret_key: انسخ الـ Secret Key (يبدأ بـ egy_sk_) من Paymob ← Settings ← Account Info.',
    'public_key: copy the Public Key (starts with egy_pk_).': 'public_key: انسخ الـ Public Key (يبدأ بـ egy_pk_).',
    'hmac_secret: copy the HMAC from Paymob → Settings → Account Info.': 'hmac_secret: انسخ الـ HMAC من Paymob ← Settings ← Account Info.',
    'One key is a test key and the other a live key — both must be test, or both live.': 'مفتاح تجريبي والآخر حقيقي — يجب أن يكونا تجريبيين معًا أو حقيقيين معًا.',
    'card_integration_id is 0. Put the Online Card integration ID number (Paymob → Developers → Payment Integrations) — without quotes.': 'card_integration_id قيمته 0. ضع رقم ربط Online Card (Paymob ← Developers ← Payment Integrations) — بدون علامات تنصيص.',
    'The file is correct but the server still uses the old copy. Reload this page in a minute.': 'الملف صحيح لكن الخادم ما زال يستخدم النسخة القديمة. أعد تحميل الصفحة بعد دقيقة.', 'Backup saved': 'تم حفظ النسخة الاحتياطية',

    // team
    'Who can sign in to this dashboard, and what they can do.': 'من يمكنه الدخول إلى لوحة التحكم، وماذا يمكنه أن يفعل.', '🎯 Monthly targets': '🎯 الأهداف الشهرية',
    'Send test alert to me': 'أرسل لي تنبيهًا تجريبيًا', '+ Add team member': '+ إضافة عضو', 'Role': 'الدور', 'Referral code': 'كود الإحالة', 'Order alerts': 'تنبيهات الطلبات',
    'Last sign-in': 'آخر دخول', 'You': 'أنت', '✉ Email': '✉ إيميل', '✓ Active': '✓ نشط', '✕ Disabled': '✕ موقوف',
    'Referral codes: when a customer enters a team member’s code at checkout, the order is credited to them. Orders a team member enters in the dashboard are credited to them too, and count toward their monthly target.': 'أكواد الإحالة: عندما يكتب العميل كود أحد أعضاء الفريق في صفحة الدفع، يُحسب الطلب له. والطلبات التي يسجّلها العضو في لوحة التحكم تُحسب له أيضًا وتدخل في هدفه الشهري.',
    'Used to sign in': 'يُستخدم لتسجيل الدخول', 'Optional, for sales reps (e.g. AHMED10)': 'اختياري، لموظفي المبيعات (مثل AHMED10)', 'At least 8 characters — share it with them privately': '8 أحرف على الأقل — أرسلها له بشكل خاص',
    'Leave blank to keep the current one': 'اتركها فارغة للإبقاء على الحالية', 'Email me new orders and enquiries': 'أرسل لي الطلبات والاستفسارات الجديدة بالإيميل', 'Can sign in': 'يمكنه الدخول',
    'Add team member': 'إضافة عضو للفريق', 'Team member saved': 'تم حفظ عضو الفريق',

    // activity
    'The latest 300 changes by your team and the website.': 'آخر 300 تغيير من فريقك والموقع.', 'When': 'الوقت', 'Who': 'مَن', 'What': 'ماذا', 'Details': 'التفاصيل', 'Nothing yet.': 'لا يوجد شيء بعد.',
    'Added lead': 'أضاف عميلًا محتملًا', 'Added photo': 'أضاف صورة', 'Backed up the database': 'نسخ قاعدة البيانات', 'Bosta shipment cancelled': 'ألغى شحنة بوسطة', 'Bosta shipment created': 'أنشأ شحنة بوسطة',
    'Changed password': 'غيّر كلمة المرور', 'Created order': 'أنشأ طلبًا', 'Created owner account': 'أنشأ حساب المالك', 'Created promo code': 'أنشأ كود خصم', 'Created quote': 'أنشأ عرض سعر',
    'Deleted a payment': 'حذف دفعة', 'Deleted category': 'حذف فئة', 'Deleted lead': 'حذف عميلًا محتملًا', 'Deleted order': 'حذف طلبًا', 'Deleted product': 'حذف منتجًا', 'Deleted promo code': 'حذف كود خصم',
    'Deleted quote': 'حذف عرض سعر', 'Downloaded a backup': 'نزّل نسخة احتياطية', 'New lead': 'عميل محتمل جديد', 'Online payment could not start': 'تعذّر بدء الدفع الإلكتروني',
    'Online payment failed': 'فشل الدفع الإلكتروني', 'Online payment not matched': 'دفعة إلكترونية غير مطابقة', 'Online payment received': 'تم استلام دفعة إلكترونية', 'Removed photo': 'حذف صورة',
    'Saved category': 'حفظ فئة', 'Signed in': 'سجّل الدخول', 'Updated lead': 'حدّث عميلًا محتملًا', 'Updated promo code': 'حدّث كود خصم', 'Updated quote': 'حدّث عرض سعر', 'Updated targets': 'حدّث الأهداف',
    'Updated order': 'حدّث طلبًا', 'Saved product': 'حفظ منتجًا', 'Recorded payment': 'سجّل دفعة', 'Updated team member': 'حدّث عضوًا بالفريق', 'Added team member': 'أضاف عضوًا للفريق',

    // partner brands
    'Partner brands': 'العلامات الشريكة', 'Brands whose products you sell under their logo. Each sale earns your commission; the rest is theirs.': 'علامات تبيع منتجاتها بشعارها. كل بيعة لك فيها عمولتك، والباقي لصاحب العلامة.',
    '+ Add brand': '+ إضافة علامة', 'commission not set': 'العمولة غير محددة', '✓ On': '✓ ظاهرة', 'Your commission': 'عمولتك', 'Owed to the brand now': 'المستحق للعلامة الآن',
    'delivered orders only': 'الطلبات المسلّمة فقط', 'Edit brand': 'تعديل العلامة', 'Statement & payments': 'كشف الحساب والمدفوعات', '+ Add product': '+ إضافة منتج',
    'No partner brands yet. Press “Add brand”.': 'لا توجد علامات شريكة بعد. اضغط "إضافة علامة".',
    'Brand name': 'اسم العلامة', 'Commission (%)': 'العمولة (%)', 'Your share of each item’s price': 'نسبتك من سعر كل منتج', 'Instagram or website': 'إنستجرام أو الموقع',
    'Under the name, e.g. Specialty coffee roasters': 'تحت الاسم، مثال: محمصة قهوة مختصة', 'About the brand': 'عن العلامة', 'Shown on its products': 'يظهر على منتجاتها', 'About, in Arabic': 'نبذة بالعربي',
    'Show the brand in the shop': 'إظهار العلامة في المتجر', 'Logo': 'الشعار', 'Save the brand first, then add its logo.': 'احفظ العلامة أولًا، ثم أضف شعارها.', '⬆ Upload logo': '⬆ رفع الشعار',
    'PNG with a plain or clear background works best': 'الأفضل PNG بخلفية سادة أو شفافة', 'Add brand': 'إضافة علامة', 'Brand saved': 'تم حفظ العلامة', 'Logo saved': 'تم حفظ الشعار', 'Brand deleted': 'تم حذف العلامة',
    'Statement to share': 'كشف حساب للمشاركة', 'Sold': 'المبيعات', 'Brand’s share': 'نصيب العلامة', 'Nothing sold this month.': 'لا توجد مبيعات هذا الشهر.', 'Payments to the brand': 'المدفوع للعلامة',
    '✓ Nothing owed': '✓ لا يوجد مستحق', 'No payments yet.': 'لا توجد مدفوعات بعد.', 'Amount paid': 'المبلغ المدفوع', 'Paid on': 'تاريخ الدفع', 'Note, e.g. InstaPay': 'ملاحظة، مثال: إنستاباي',
    'Partner brand': 'العلامة الشريكة',
    'Order notes': 'ملاحظات الطلب', 'Deposit paid now (EGP)': 'العربون المدفوع الآن (ج.م)', 'Optional. The deposit is taken off what the courier collects.': 'اختياري. العربون يُخصم من المبلغ الذي يحصّله المندوب.', 'Deposit paid': 'العربون المدفوع', 'Order notes:': 'ملاحظات الطلب:', 'For whoever packs the order — shown on the Bosta shipment and the waybill': 'لمن يجهّز الطلب — تظهر على شحنة بوسطة والبوليصة',
    'e.g. Gift wrap it, add 2 extra stickers, the logo must be gold': 'مثال: تغليف هدية، أضف 2 ستيكر زيادة، اللوجو لازم يكون ذهبي',
    'Sent to Bosta with the shipment (on the order page and the waybill) for whoever packs it': 'تُرسل لبوسطة مع الشحنة (في صفحة الطلب والبوليصة) لمن يجهّزها',
    'e.g. Gift wrap it, check the colour is black': 'مثال: تغليف هدية، تأكد أن اللون أسود',
    'Price from the brand': 'السعر من العلامة', 'Brand’s price (EGP)': 'سعر العلامة (ج.م)', 'What the brand charges for the main size, before your commission': 'سعر العلامة للحجم الأساسي، قبل عمولتك',
    'Your margin (%)': 'هامش ربحك (%)', 'Enter the brand’s price to work out the shop price automatically.': 'اكتب سعر العلامة ليُحسب سعر المتجر تلقائيًا.',
    'Worked out from the brand’s price + your margin': 'محسوب من سعر العلامة + هامش ربحك', 'The main price — sizes can follow it (e.g. 250 g = ¼)': 'السعر الأساسي — المقاسات يمكن أن تتبعه (مثال: 250 جم = ¼)',
    'Same as the main price': 'نفس السعر الأساسي', '½ of the main price': '½ السعر الأساسي', '⅓ of the main price': '⅓ السعر الأساسي', '¼ of the main price': '¼ السعر الأساسي',
    '2× the main price': 'ضعف السعر الأساسي', 'Its own price': 'سعر خاص به', 'Price of this size': 'سعر هذا المقاس', 'You keep': 'تحتفظ بـ',
    'Added on top of the brand’s price for all its products (a product can have its own)': 'يُضاف فوق سعر العلامة لكل منتجاتها (ويمكن تحديد هامش خاص لمنتج)', 'Where To Spot (our own product)': 'Where To Spot (منتجنا)',
    'Shows the brand’s logo on this product in the shop. Its sales go on the brand’s statement, with your commission.': 'يظهر شعار العلامة على المنتج في المتجر. مبيعاته تُسجَّل في كشف حساب العلامة مع عمولتك.',
    'Enter the brand name.': 'اكتب اسم العلامة.', 'Brand not found.': 'العلامة غير موجودة.', 'Enter the amount you paid the brand.': 'اكتب المبلغ الذي دفعته للعلامة.',
    'Move this brand’s products to another brand (or delete them) first. To hide the brand, switch it off instead.': 'انقل منتجات هذه العلامة أو احذفها أولًا. لإخفاء العلامة، أوقفها بدلًا من الحذف.',
    'This brand has sales on record, so it is kept for its statements. Switch it off instead.': 'هذه العلامة لها مبيعات مسجّلة، لذلك تُحفظ لكشوف الحساب. أوقفها بدلًا من الحذف.',
    'Added brand': 'أضاف علامة', 'Updated brand': 'حدّث علامة', 'Deleted brand': 'حذف علامة', 'Paid brand': 'دفع لعلامة', 'Deleted a brand payment': 'حذف دفعة لعلامة',

    // messages from the server
    'Could not reach the server — check your internet connection and try again.': 'تعذّر الوصول للخادم — تأكد من الإنترنت وحاول مرة أخرى.',
    'Not signed in': 'لم يتم تسجيل الدخول', 'You do not have access to this': 'ليس لديك صلاحية لهذا', 'Session expired, please reload': 'انتهت الجلسة، أعد تحميل الصفحة',
    'This isn’t available for your role.': 'هذا غير متاح لدورك.', 'Not found': 'غير موجود', 'Too many sign-in attempts. Wait 15 minutes.': 'محاولات دخول كثيرة. انتظر 15 دقيقة.',
    'Too many attempts. Wait 15 minutes.': 'محاولات كثيرة. انتظر 15 دقيقة.', 'Wrong email or password.': 'الإيميل أو كلمة المرور غير صحيحة.', 'Setup key is wrong.': 'مفتاح الإعداد غير صحيح.',
    'Current password is wrong.': 'كلمة المرور الحالية غير صحيحة.', 'New password must be at least 8 characters.': 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.',
    'Password must be at least 8 characters.': 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.', 'Product name is required.': 'اسم المنتج مطلوب.', 'Pick a category.': 'اختر فئة.',
    'Enter a price, or add sizes / quantity prices.': 'اكتب السعر، أو أضف مقاسات / أسعار كميات.', 'Product not found.': 'المنتج غير موجود.', 'Photo not found.': 'الصورة غير موجودة.',
    'Category name is required.': 'اسم الفئة مطلوب.', 'Move or delete the products in this category first.': 'انقل أو احذف منتجات هذه الفئة أولًا.', 'Order not found.': 'الطلب غير موجود.',
    'This order has no Bosta shipment.': 'هذا الطلب ليس له شحنة بوسطة.', 'Choose up to 50 orders to delete.': 'اختر حتى 50 طلبًا للحذف.', 'None of these orders has a Bosta shipment yet.': 'لا يوجد لأي من هذه الطلبات شحنة بوسطة بعد.',
    'Print up to 50 waybills at a time.': 'اطبع حتى 50 بوليصة في المرة.', 'Name and contact are required.': 'الاسم ووسيلة التواصل مطلوبان.', 'Unknown status': 'حالة غير معروفة', 'Nothing to change': 'لا يوجد ما يتغير',
    'Enter the amount received (use a minus amount for a refund).': 'اكتب المبلغ المستلم (بالسالب للاسترداد).', 'Payment not found.': 'الدفعة غير موجودة.', 'Customer not found.': 'العميل غير موجود.',
    'This quote was accepted and turned into an order, so it can’t be changed.': 'هذا العرض تم قبوله وتحويله لطلب، لذلك لا يمكن تعديله.', 'Enter the customer’s name.': 'اكتب اسم العميل.',
    'That email doesn’t look right — fix it or leave it empty.': 'الإيميل غير صحيح — صححه أو اتركه فارغًا.', 'This quote is already accepted.': 'هذا العرض مقبول بالفعل.', 'Accepted quotes are kept with their order.': 'العروض المقبولة تبقى مع طلبها.',
    'Use 3 to 30 letters or numbers for the code (no spaces).': 'استخدم من 3 إلى 30 حرفًا أو رقمًا للكود (بدون مسافات).', 'Enter the discount amount.': 'اكتب قيمة الخصم.', 'A percentage can be at most 100.': 'النسبة لا تزيد عن 100.',
    'Promo code not found.': 'كود الخصم غير موجود.', 'Quote not found.': 'عرض السعر غير موجود.', 'At least one active owner is required.': 'يجب وجود مالك نشط واحد على الأقل.',
    'You cannot remove your own owner access.': 'لا يمكنك إزالة صلاحية المالك عن نفسك.', 'That email or referral code is already used by another team member.': 'هذا الإيميل أو كود الإحالة مستخدم بالفعل لعضو آخر.',
    'Enter a name and a valid email.': 'اكتب الاسم وإيميل صحيح.', 'Only JPG, PNG or WebP photos are allowed.': 'مسموح بصور JPG أو PNG أو WebP فقط.', 'Only JPG, PNG, WebP or PDF files are allowed.': 'مسموح بملفات JPG أو PNG أو WebP أو PDF فقط.',
    'That image file looks damaged.': 'ملف الصورة يبدو تالفًا.', 'Could not save the file on the server.': 'تعذّر حفظ الملف على الخادم.', 'Could not save the photo on the server.': 'تعذّر حفظ الصورة على الخادم.',
    'This code was used on orders, so it is kept for the records. Switch it off instead.': 'هذا الكود استُخدم في طلبات، لذلك يُحفظ للسجلات. أوقفه بدلًا من حذفه.',
    'Add at least one product.': 'أضف منتجًا واحدًا على الأقل.', 'Custom items need a description and a price.': 'المنتج الخاص يحتاج وصفًا وسعرًا.',
    'Choose the customer’s city and area (Bosta needs an exact district).': 'اختر محافظة العميل ومنطقته (بوسطة تحتاج حيًا محددًا).', 'The street address must be longer than 5 characters for Bosta.': 'عنوان الشارع يجب أن يكون أطول من 5 أحرف لبوسطة.',
    'Cash to collect must be between 0 and 30,000 EGP (Bosta limit).': 'مبلغ التحصيل يجب أن يكون بين 0 و 30,000 ج.م (حد بوسطة).', 'This order has no physical products to ship.': 'هذا الطلب ليس فيه منتجات للشحن.',
    'Bosta did not return a tracking number.': 'بوسطة لم ترسل رقم تتبع.', 'Bosta is not set up yet. Add the API key to api/config.local.php.': 'بوسطة غير مضبوطة بعد. أضف مفتاح API في api/config.local.php.',
    'A product in the order is no longer available. Please refresh.': 'منتج في الطلب لم يعد متاحًا. أعد تحميل الصفحة.', 'A product in the quote is no longer available.': 'منتج في عرض السعر لم يعد متاحًا.',
    'Referral code not recognised — check it or leave it blank.': 'كود الإحالة غير معروف — راجعه أو اتركه فارغًا.', 'Please enter a valid email.': 'اكتب إيميل صحيح.',
    'Something went wrong. Please try again.': 'حدث خطأ. حاول مرة أخرى.', 'Error': 'خطأ', 'Too many tries. Please wait a while.': 'محاولات كثيرة. انتظر قليلًا.',
  };

  var PAT = [
    // dashboard
    [/^Hello (.+?) — here’s (your work in )?the last (\d+) days\.$/, function (m, a, y, d) { return 'أهلًا ' + a + ' — ' + (y ? 'هذا عملك في' : 'هذه نظرة على') + ' آخر ' + n(d, DAYS) + '.'; }],
    [/^(\d+) days$/, function (m, d) { return n(d, DAYS); }],
    [/^My orders · (.+)$/, function (m, a) { return 'طلباتي · ' + a; }], [/^My sales · (.+)$/, function (m, a) { return 'مبيعاتي · ' + a; }],
    [/^My delivered · (.+)$/, function (m, a) { return 'ما تم تسليمه · ' + a; }], [/^Team this month · (.+)$/, function (m, a) { return 'الفريق هذا الشهر · ' + a; }],
    [/^(\d+) cancelled or returned$/, '$1 ملغي أو مرتجع'], [/^avg (.+)$/, 'المتوسط $1'], [/^last (\d+) days, excl\. cancelled$/, function (m, d) { return 'آخر ' + n(d, DAYS) + '، بدون الملغي'; }],
    [/^(\d+) orders? with a balance$/, function (m, c) { return n(c, ORD) + ' عليها مبالغ متبقية'; }], [/^(.+) waiting ·$/, '$1 في الانتظار ·'],
    [/^Last copy saved (.+)$/, function (m, a) { return 'آخر نسخة حُفظت ' + (split(a) || a); }], [/^(\d+)% margin$/, 'هامش $1%'],
    [/^from (.+) sales − (.+) cost$/, 'من مبيعات $1 − تكلفة $2'],
    [/^Covers (\d+)% of sales\. Add cost prices to the remaining products for a full picture\.$/, 'يغطي $1% من المبيعات. أضف أسعار التكلفة لباقي المنتجات لصورة كاملة.'],
    [/^(\d+) leads?$/, function (m, c) { return n(c, ['عميل واحد', 'عميلان', 'عملاء', 'عميلًا']); }], [/^won · (\d+)%$/, 'تم البيع · $1%'],
    [/^(\d+) pcs$/, '$1 قطعة'], [/^(-?\d+) left$/, 'متبقي $1'], [/^(\d+) orders?$/, function (m, c) { return n(c, ORD); }],
    [/^(\d+)% of target · (.+) to go$/, '$1% من الهدف · متبقي $2'],
    // orders
    [/^(\d+) shown$/, 'عدد الطلبات: $1'], [/^(\d+) open orders$/, function (m, c) { return n(c, ORD) + ' مفتوحة'; }], [/^only orders credited to you$/, 'طلباتك فقط'],
    [/^(\d+) selected$/, 'تم تحديد $1'], [/^Select (.+)$/, 'تحديد $1'], [/^(\d+) of (\d+) shipments updated$/, 'تم تحديث $1 من $2 شحنة'],
    [/^All (\d+) open shipments are up to date$/, 'كل الشحنات المفتوحة ($1) محدّثة'], [/^Deleted (.+)$/, 'تم حذف $1'],
    [/^(.+) paid · refund\?$/, 'مدفوع $1 · استرداد؟'], [/^Deposit · (.+) due$/, 'عربون · متبقي $1'], [/^(.+) due$/, 'متبقي $1'], [/^◐ (.+) due$/, '◐ متبقي $1'],
    [/^(.+) to collect$/, '$1 للتحصيل'], [/^Paid (.+)$/, 'المدفوع $1'], [/^Total (.+)$/, 'الإجمالي $1'],
    [/^📎 (\d+) files?$/, function (m, c) { return '📎 ' + n(c, ['ملف واحد', 'ملفان', 'ملفات', 'ملفًا']); }], [/^Moved to (.+)$/, function (m, a) { return 'تم النقل إلى ' + (tr(a) || a); }],
    [/^Move back to (.+)$/, function (m, a) { return 'رجوع إلى ' + (tr(a) || a); }],
    [/^Delete (\d+) orders? for good\?\n\n([\s\S]*)\n\nUse this only for test or mistaken orders\. Stock goes back, their payments are removed, and any Bosta shipment still open is cancelled\. This can’t be undone\.$/,
      function (m, c, l) { return 'حذف ' + n(c, ORD) + ' نهائيًا؟\n\n' + l + '\n\nاستخدم هذا للطلبات التجريبية أو الخاطئة فقط. المخزون يرجع، والمدفوعات تُحذف، وأي شحنة بوسطة مفتوحة تُلغى. لا يمكن التراجع.'; }],
    [/^Create (\d+) Bosta shipments?$/, function (m, c) { return 'إنشاء ' + n(c, SHIP) + ' بوسطة'; }],
    [/^Each order uses the customer’s saved area and address, and collects its full order total in cash\. Orders without an area will be skipped — open them to choose one\.(?: (\d+) already shipped order\(s\) are left out\.)?$/,
      function (m, c) { return 'كل طلب يستخدم منطقة وعنوان العميل المحفوظين، ويحصّل المبلغ المتبقي نقدًا. الطلبات بدون منطقة سيتم تخطيها — افتحها لاختيار المنطقة.' + (c ? ' تم استبعاد ' + n(c, ORD) + ' مشحونة بالفعل.' : ''); }],
    [/^🖨 Print (\d+) waybills?$/, '🖨 طباعة $1 بوليصة'], [/^(\d+) shipments? created$/, function (m, c) { return 'تم إنشاء ' + n(c, SHIP); }],
    [/^· collect (.+)$/, '· تحصيل $1'], [/^Updated (.+) · status changes arrive automatically$/, 'آخر تحديث $1 · تغييرات الحالة تصل تلقائيًا'],
    [/^General \/ not sure \((.*)\)$/, 'عام / غير متأكد ($1)'], [/^Shipment created · #(.+)$/, 'تم إنشاء الشحنة · #$1'], [/^Bosta: (.+)$/, function (m, a) { return 'بوسطة: ' + (tr(a) || a); }],
    [/^Cancel Bosta shipment (.+)\? The courier won’t pick it up\.$/, 'إلغاء شحنة بوسطة $1؟ المندوب لن يستلمها.'], [/^🚚 (.+)$/, function (m, a) { var t = tr(a); return t ? '🚚 ' + t : null; }],
    [/^Order (WTS-\d+)$/, 'الطلب $1'], [/^Placed (.+)$/, 'تاريخ الطلب $1'], [/^Source: (.+)$/, function (m, a) { return 'المصدر: ' + (tr(a) || a); }],
    [/^credited to (.+)$/, 'محسوب لـ $1'], [/^entered by (.+)$/, 'سجّله $1'], [/^Promo (\S+)$/, 'كود الخصم $1'], [/^Files(?: \((\d+)\))?$/, function (m, c) { return 'الملفات' + (c ? ' (' + c + ')' : ''); }],
    [/^Remove (.+)\?$/, 'حذف $1؟'],
    // new order
    [/^Auto: (.+)$/, 'تلقائي: $1'], [/^(.+) each$/, '$1 للقطعة'], [/^(\d+) × (.+) = (.+) \((.+) each\)$/, '$1 × $2 = $3 ($4 للقطعة)'],
    [/^(-?\d+) in stock$/, 'متوفر $1'], [/^(.+) \/ month$/, function (m, a) { return (tr(a, true) || a) + ' / شهريًا'; }], [/^from (.+)$/, function (m, a) { return 'من ' + (tr(a, true) || a); }], [/^(.+) \(\+(.+) (each|once)\)$/, function (m, l, p, k) { return l + ' (+' + p + (k === 'once' ? ' مرة واحدة' : ' للقطعة') + ')'; }],
    [/^(\d+) earlier orders?$/, function (m, c) { return n(c, ['طلب واحد سابق', 'طلبان سابقان', 'طلبات سابقة', 'طلبًا سابقًا']); }], [/^(.+) \((owner|manager|sales|staff|telesales)\)$/, function (m, a, r) { return a + ' (' + D[r] + ')'; }],
    [/^(\d+) item\(s\) from the quote are no longer in the catalog — add them again$/, '$1 منتج من عرض السعر لم يعد في الكتالوج — أضفه مرة أخرى'],
    [/^Edit quote (.*)$/, 'تعديل عرض السعر $1'], [/^Quote (.+) saved$/, 'تم حفظ عرض السعر $1'], [/^Order (.+) created$/, 'تم إنشاء الطلب $1'],
    // products
    [/^(\d+) products$/, function (m, c) { return n(c, ['منتج واحد', 'منتجان', 'منتجات', 'منتجًا']); }], [/^(\d+) categories$/, function (m, c) { return n(c, ['فئة واحدة', 'فئتان', 'فئات', 'فئة']); }],
    [/^(\d+) photos?$/, function (m, c) { return n(c, ['صورة واحدة', 'صورتان', 'صور', 'صورة']); }], [/^(\d+) sizes$/, function (m, c) { return n(c, ['مقاس واحد', 'مقاسان', 'مقاسات', 'مقاسًا']); }],
    [/^Delete "(.+)" and its photos\? This cannot be undone\. Tip: set status to Archived to hide it instead\.$/, 'حذف "$1" وصوره؟ لا يمكن التراجع. نصيحة: اجعل الحالة "مؤرشف" لإخفائه بدلًا من الحذف.'],
    [/^Upload failed\. (Photos|Files) must be under (.+)\.?$/, function (m, k, s) { return 'فشل الرفع. ' + (k === 'Photos' ? 'الصور' : 'الملفات') + ' يجب أن تكون أقل من ' + s; }],
    // leads, quotes, customers
    [/^! Overdue · (.+)$/, '! متأخر · $1'], [/^WhatsApp (.+)$/, 'واتساب $1'], [/^\+ (\d+) more in the List view$/, '+ $1 آخرين في عرض القائمة'],
    [/^This number or email already belongs to “(.+)” \((.+)\)(.*)$/, function (m, a, s, r) { return 'هذا الرقم أو الإيميل مسجّل بالفعل لـ "' + a + '" (' + (tr(s) || s) + ')' + r; }],
    [/^(\d+)% of answered quotes$/, '$1% من العروض التي تم الرد عليها'], [/^(.+) waiting for an answer$/, '$1 في انتظار الرد'],
    [/^No (draft|sent|accepted|declined|expired) quotes\.$/, function (m, s) { return 'لا توجد عروض أسعار (' + D[s[0].toUpperCase() + s.slice(1)] + ').'; }],
    [/^Created (.+?)(?: by (.+))?$/, function (m, a, b) { return 'أُنشئ ' + a + (b ? ' بواسطة ' + b : ''); }], [/^sent (.+)$/, 'أُرسل $1'], [/^valid until (.+)$/, 'صالح حتى $1'],
    [/^Quote (\S+)$/, 'عرض السعر $1'], [/^Delete quote (.+)\?$/, 'حذف عرض السعر $1؟'], [/^since (.+)$/, 'منذ $1'],
    [/^(\d+) customers$/, function (m, c) { return n(c, ['عميل واحد', 'عميلان', 'عملاء', 'عميلًا']); }], [/^(\d+) with a shop account$/, '$1 لديهم حساب'],
    [/^(\d+) ordered more than once$/, '$1 طلبوا أكثر من مرة'], [/^your orders only$/, 'طلباتك فقط'],
    // promos
    [/^Min\. (.+)$/, 'الحد الأدنى $1'], [/^Max (\d+) uses$/, 'أقصى $1 استخدام'], [/^Until (.+)$/, 'حتى $1'], [/^Starts (.+)$/, 'يبدأ $1'], [/^Promo code (\S+)$/, 'كود الخصم $1'],
    [/^EGP ([\d,]+) off$/, 'خصم $1 ج.م'], [/^([\d.]+)% off$/, 'خصم $1%'], [/^Delete promo code (.+)\?$/, 'حذف كود الخصم $1؟'],
    [/^The customer pays no delivery fee on orders of (.+) or more\.$/, 'العميل لا يدفع رسوم توصيل على الطلبات من $1 فأكثر.'],
    [/^On an (.+) order the customer saves (.+)\.$/, 'على طلب بقيمة $1 يوفر العميل $2.'],
    [/^There is already a promo code called (.+)$/, 'يوجد بالفعل كود خصم باسم $1'], [/^This code needs an order of (.+)$/, 'هذا الكود يحتاج طلبًا بقيمة $1'],
    // backups, team
    [/^A full copy of the database \(orders, leads, products, team\) is saved automatically every day\. The last (\d+) days are kept\.$/, 'يتم حفظ نسخة كاملة من قاعدة البيانات (الطلبات والعملاء والمنتجات والفريق) تلقائيًا كل يوم. يتم الاحتفاظ بآخر $1 يومًا.'],
    [/^of (\d+) days$/, 'من $1 يومًا'], [/^Test sent to (.+) via (.+)$/, 'تم إرسال التجربة إلى $1 عبر $2'],
    [/^Test sent to (.+) — but you are NOT subscribed to order alerts\. Edit your row and tick “Email me new orders”\.$/, 'تم إرسال التجربة إلى $1 — لكنك غير مشترك في تنبيهات الطلبات. عدّل بياناتك وفعّل "أرسل لي الطلبات الجديدة".'],
    [/^(owner|manager|sales|staff|telesales) — (.+)$/, function (m, r, i) { return D[r] + ' — ' + (D[i] || i); }, true],
    [/^Request failed \((\d+)\)$/, 'فشل الطلب ($1)'], [/^Bosta did not return a printable waybill\.(.*)$/, 'بوسطة لم ترسل بوليصة قابلة للطباعة.$1'],
    [/^Could not reach Bosta: (.+)$/, 'تعذّر الوصول لبوسطة: $1'], [/^This order already has a Bosta shipment \((.+)\)\.?$/, 'هذا الطلب له شحنة بوسطة بالفعل ($1).'],
    [/^Choose an option for (.+)$/, 'اختر اختيارًا لـ $1'], [/^(.+): only (\d+) left in stock\.?$/, '$1: متبقي $2 فقط في المخزون.'],
    [/^Lead saved · also updated (.+)$/, 'تم حفظ العميل المحتمل · وتم تحديث $1'],
    [/^Orders updated: (.+)\. (.+) already has a Bosta shipment, so tell Bosta the new number\.$/, 'تم تحديث الطلبات: $1. الطلب $2 له شحنة بوسطة بالفعل، لذلك أبلغ بوسطة بالرقم الجديد.', true],
    [/^Leave empty to use (.+)’s margin \((.+)\)$/, 'اتركه فارغًا لاستخدام هامش $1 ($2)'], [/^([\d.]+)% margin$/, 'هامش $1%'],
    [/^(.+) commission \+ (.+) margin$/, '$1 عمولة + $2 هامش'], [/^Sold ([\d,.]+ ج\.م)$/, 'المباع $1'], [/^brand price ([\d,.]+ ج\.م)$/, 'سعر العلامة $1'], [/^You keep (.+)$/, 'تحتفظ بـ $1'], [/^brand ([\d,.]+ ج\.م)$/, 'العلامة $1'],
    [/^Brand saved · (\d+) product prices updated$/, 'تم حفظ العلامة · تم تحديث أسعار $1 منتج'],
    [/^Example: the brand’s price is (.+) → the shop sells it for (.+)\. You keep (.+) and owe the brand (.+)\.$/, 'مثال: سعر العلامة $1 ← المتجر يبيعه بـ $2. تحتفظ بـ $3 وتدفع للعلامة $4.'],
    [/^(\d+) live of (\d+) products$/, '$1 معروض من $2 منتج'], [/^([\d.]+)% commission$/, 'عمولة $1%'], [/^([\d.]+)% now$/, '$1% حاليًا'],
    [/^Sold in (.+)$/, 'المبيعات في $1'], [/^Items sold in (.+)$/, 'المنتجات المباعة في $1'], [/^(.+) more once delivered$/, '$1 إضافية بعد التسليم'],
    [/^(.+) delivered$/, '$1 تم تسليمه'], [/^(.+) owed$/, '$1 مستحق'], [/^Their share of delivered orders (.+)$/, 'نصيبهم من الطلبات المسلّمة $1'],
    [/^(.+) · statement$/, '$1 · كشف الحساب'], [/^Delete the brand (.+)\?$/, 'حذف العلامة $1؟'], [/^(.+) \(off\)$/, '$1 (متوقفة)'],
    [/^On an item sold for (.+), you keep (.+) and owe the brand (.+)\.$/, 'على منتج بيع بـ $1، تحتفظ بـ $2 وتدفع للعلامة $3.'],
    [/^How it works: (.+)$/, 'طريقة العمل: حدّد علامة كل منتج من المنتجات ← تعديل ← العلامة الشريكة. يظهر شعار العلامة في المتجر مع علامة "شريك رسمي". العمولة نسبة من سعر المنتج؛ رسوم التوصيل وخصومات أكواد الخصم عليك. تُحسب البيعة ضمن مستحقات العلامة عندما يصبح الطلب "تم التسليم".'],
    [/^(.+) →$/, function (m, a) { var t = tr(a); return t ? t + ' ←' : null; }], [/^→ (.+)$/, '← $1'],
    // a status badge: "● Pending", "✓ Delivered"
    [/^([^\w\s]{1,2}) (.+)$/, function (m, ic, a) { var t = tr(a); return t ? ic + ' ' + t : null; }],
  ];

  // "A · B · C": translate the parts we know (statuses, sources, short phrases), keep names and dates.
  function split(key) {
    if (key.indexOf(' · ') < 0 && key.indexOf('· ') !== 0) return null;
    var lead = key.indexOf('· ') === 0 ? '· ' : '';
    var parts = (lead ? key.slice(2) : key).split(' · ');
    var hit = false;
    var out = parts.map(function (p) { var t = p ? tr(p, true) : null; if (t != null) { hit = true; return t; } return p; });
    return hit ? lead + out.join(' · ') : null;
  }

  function tr(s, noSplit) {
    var key = String(s).replace(/[ \t]+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!key) return null;
    if (key.indexOf('\n') < 0) key = key.replace(/\s+/g, ' ');
    if (Object.prototype.hasOwnProperty.call(D, key)) return D[key];
    // "A · B" lines go part by part, unless a pattern is written for the whole line (has "·" or is marked true).
    var dotted = key.indexOf('· ') >= 0;
    for (var i = 0; i < PAT.length; i++) {
      if (dotted && PAT[i][0].source.indexOf('·') < 0 && !PAT[i][2]) continue;
      var m = key.match(PAT[i][0]);
      if (!m) continue;
      var out = typeof PAT[i][1] === 'function' ? PAT[i][1].apply(null, m) : key.replace(PAT[i][0], PAT[i][1]);
      if (out != null) return out;
    }
    return noSplit ? null : split(key);
  }
  window.WTS_T = function (s) { return AR ? (tr(s) || s) : s; };
  window.WTS_I18N = { lang: lang, ar: AR, set: setLang, t: window.WTS_T };

  function wireToggles() {
    var els = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__wtsLang) continue;
      el.__wtsLang = true;
      el.setAttribute('translate', 'no');
      el.setAttribute('aria-label', AR ? 'Switch to English' : 'التحويل للعربية');
      el.addEventListener('click', function (e) { e.preventDefault(); setLang(AR ? 'en' : 'ar'); });
    }
  }

  var css = '[data-lang-toggle]{cursor:pointer}' +
    '.langbtn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line,#E4DED5);background:var(--surface,#fff);color:var(--ink,#1C1B19);border-radius:999px;padding:6px 12px;font:inherit;font-weight:650;font-size:13px}' +
    '.auth-card .langbtn{align-self:flex-start}' +
    '.mobilebar .langbtn{margin-inline-start:auto;width:auto!important;height:34px!important;padding:0 12px!important;border-radius:999px!important}';
  if (AR) {
    css += 'html[lang=ar] body,html[lang=ar] button,html[lang=ar] input,html[lang=ar] select,html[lang=ar] textarea{font-family:"IBM Plex Sans Arabic",Inter,system-ui,sans-serif}' +
      'html[lang=ar] *{letter-spacing:0!important}html[lang=ar] th,html[lang=ar] .nav-label{text-transform:none}' +
      'html[lang=ar] .auth-side h2{font-family:"IBM Plex Sans Arabic",sans-serif;font-weight:700;line-height:1.25}html[lang=ar] em{font-style:normal}' +
      'html[lang=ar] body{font-size:14.5px}html[lang=ar] .small{font-size:13px}' +
      // mirror what the stylesheet places with left/right
      '[dir=rtl] .side{border-right:none;border-left:1px solid var(--line)}' +
      '[dir=rtl] .side a.nav.on::before{left:auto;right:-14px;border-radius:3px 0 0 3px}' +
      '[dir=rtl] .side a.nav .count{margin-left:0;margin-right:auto}' +
      '[dir=rtl] th,[dir=rtl] td{text-align:right}[dir=rtl] td.num,[dir=rtl] th.num{text-align:left}' +
      '[dir=rtl] .drawer{right:auto;left:10px;animation-name:slideInR}@keyframes slideInR{from{transform:translateX(-30px);opacity:0}to{transform:none;opacity:1}}' +
      '@media (max-width:820px){[dir=rtl] .drawer{left:0}[dir=rtl] .side{box-shadow:-20px 0 60px rgba(0,0,0,.2)}}' +
      '[dir=rtl] .photo .cover{left:auto;right:6px}' +
      '[dir=rtl] .pick .results button,[dir=rtl] .searchbtn,[dir=rtl] .pal-item,[dir=rtl] .side button.nav,[dir=rtl] .pp,[dir=rtl] .cust-hits button{text-align:right}' +
      '[dir=rtl] .it-q{margin-right:0;margin-left:2px}' +
      '[dir=rtl] .otable .o-tot,[dir=rtl] .otable .o-date{text-align:left}' +
      '[dir=rtl] .ship-sum > div:last-child{text-align:left}@media (max-width:760px){[dir=rtl] .ship-sum > div:last-child{text-align:right}}' +
      '[dir=rtl] [style*="text-align:right"]{text-align:left!important}[dir=rtl] [style*="text-align:left"]{text-align:right!important}' +
      '[dir=rtl] [style*="padding-left:18px"]{padding-left:0!important;padding-right:18px}' +
      '[dir=rtl] .chart{direction:ltr}' +
      // phone numbers, emails, codes and amounts typed in stay left-to-right
      '[dir=rtl] input[type=tel],[dir=rtl] input[type=email],[dir=rtl] input[type=url],[dir=rtl] input[type=number],[dir=rtl] input[name=code],[dir=rtl] input[name=ref_code]{direction:ltr;text-align:right}' +
      '[dir=rtl] a[href^="tel:"],[dir=rtl] code{unicode-bidi:plaintext;direction:ltr;display:inline-block}[dir=rtl] .o-phone{unicode-bidi:plaintext}';
    var fl = document.createElement('link');
    fl.rel = 'stylesheet';
    fl.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap';
    (document.head || html).appendChild(fl);
  }
  var st = document.createElement('style');
  st.textContent = css;
  (document.head || html).appendChild(st);

  if (!AR) {
    document.addEventListener('DOMContentLoaded', wireToggles);
    new MutationObserver(wireToggles).observe(html, { childList: true, subtree: true });
    return;
  }

  // Confirmation boxes say the same in Arabic.
  var nativeConfirm = window.confirm;
  window.confirm = function (msg) { return nativeConfirm.call(window, tr(msg) || msg); };

  // ---- translate the page as it appears ----
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, NOSCRIPT: 1 };
  var ATTRS = ['placeholder', 'aria-label', 'title'];

  function doText(nd) {
    var p = nd.parentNode;
    if (!p || SKIP[p.nodeName] || (p.closest && p.closest('[translate=no],[data-no-i18n]'))) return;
    var v = nd.nodeValue;
    // Text we already translated stays as it is (otherwise "→" ⇄ "←" would flip forever).
    if (!v || v === nd.__wts || !/[A-Za-z→←,]/.test(v)) return;
    var out = tr(v);
    if (out == null || out === v.trim()) return;
    var lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
    nd.__wts = lead + out + tail;
    nd.nodeValue = nd.__wts;
  }
  function doAttrs(el) {
    if (el.closest && el.closest('[translate=no],[data-no-i18n]')) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (!a || !/[A-Za-z]/.test(a) || (el.__wtsA && el.__wtsA[ATTRS[i]] === a)) continue;
      var o = tr(a);
      if (o != null && o !== a) { (el.__wtsA = el.__wtsA || {})[ATTRS[i]] = o; el.setAttribute(ATTRS[i], o); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    doAttrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    var nd;
    while ((nd = w.nextNode())) {
      if (nd.nodeType === 3) doText(nd);
      else doAttrs(nd); // textarea placeholders too
    }
  }
  document.title = 'Where To Spot — لوحة تحكم الفريق';

  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
    wireToggles();
  }).observe(html, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  document.addEventListener('DOMContentLoaded', function () { walk(document.body); wireToggles(); });
})();
