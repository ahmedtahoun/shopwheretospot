// Arabic / English for the shop pages.
//
// Load it first in <head> (not deferred): it picks the language before the page draws, sets
// <html lang dir>, and then translates the English text of the page as it appears, including
// text the shop scripts add later (cart, checkout, messages). Product and category names come
// in Arabic from the dashboard (shop-data.js picks them); everything else is in the lists below.
//
// Language: ?lang=ar|en in the link, else the visitor's last choice, else the phone's language.
(function () {
  var KEY = 'wts_lang';
  var lang = null;
  try {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'ar' || q === 'en') { lang = q; localStorage.setItem(KEY, q); }
    else lang = localStorage.getItem(KEY);
  } catch (e) {}
  if (lang !== 'ar' && lang !== 'en') {
    var langs = navigator.languages || [navigator.language || ''];
    lang = String(langs[0] || '').toLowerCase().indexOf('ar') === 0 ? 'ar' : 'en';
  }
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

  // Exact strings (whitespace is collapsed before lookup).
  var D = {
    // header, menu, footer
    'Shop': 'تسوّق', 'Marketing plans': 'خطط التسويق', 'Services': 'الخدمات', 'About us': 'من نحن', 'Free Google review link & QR': 'رابط تقييم جوجل وكود QR مجانًا', 'Free review link': 'رابط تقييم مجاني', 'Contact': 'تواصل معنا',
    'Sell with us': 'بيع معانا', 'Please enter your name and your brand or shop name.': 'من فضلك اكتب اسمك واسم البراند أو المحل.',
    'Please enter a WhatsApp number we can reach you on.': 'من فضلك اكتب رقم واتساب نقدر نكلمك عليه.', 'Please check the email address.': 'من فضلك راجع الإيميل.',
    'Please add at least one product with its name.': 'من فضلك ضيف منتج واحد على الأقل باسمه.', 'Too many requests. Please message us on WhatsApp instead.': 'طلبات كتير. من فضلك كلمنا على واتساب.',
    'Only JPG, PNG or WebP photos are allowed.': 'مسموح بصور JPG أو PNG أو WebP بس.', 'Photo is too large (max 5 MB).': 'الصورة كبيرة (الحد الأقصى 5 ميجا).',
    'Contact us': 'تواصل معنا', 'Wishlist': 'المفضلة', 'Cart': 'السلة', 'Home': 'الرئيسية', 'Categories': 'الفئات', 'Search': 'بحث',
    'Menu': 'القائمة', 'Close': 'إغلاق', '→': '←', '←': '→', ',': '،',
    'All prices in Egyptian Pounds (EGP) · Delivery across Egypt · Cash on delivery': 'كل الأسعار بالجنيه المصري · توصيل لكل مصر · الدفع عند الاستلام',
    'Marketing, products and production for businesses in Egypt. All prices in Egyptian Pounds (EGP).': 'تسويق ومنتجات وإنتاج للشركات في مصر. كل الأسعار بالجنيه المصري.',
    'Chat with us': 'تحدث معنا', 'WhatsApp': 'واتساب', 'Company': 'الشركة', 'Policies': 'السياسات', 'Track your order': 'تتبّع طلبك',
    'Privacy policy': 'سياسة الخصوصية', 'Privacy': 'الخصوصية', 'Refund & cancellation': 'الاسترجاع والإلغاء', 'Refunds & cancellation': 'الاسترجاع والإلغاء',
    'Refund & Cancellation': 'الاسترجاع والإلغاء', 'Delivery & shipping': 'التوصيل والشحن', 'Terms & conditions': 'الشروط والأحكام', 'Terms': 'الشروط',
    'MQR, El Wahat Road, 6th of October City, Giza, Egypt': 'MQR، طريق الواحات، مدينة 6 أكتوبر، الجيزة، مصر',
    '© 2026 Where To Spot · MQR, El Wahat Road, 6th of October City, Giza, Egypt ·': '© 2026 Where To Spot · MQR، طريق الواحات، مدينة 6 أكتوبر، الجيزة، مصر ·',
    '© 2026 Where To Spot. All rights reserved.': '© 2026 Where To Spot. جميع الحقوق محفوظة.',
    'Cash on delivery · Delivery across Egypt · 14-day returns': 'الدفع عند الاستلام · توصيل لكل مصر · استرجاع خلال 14 يوم',
    'We accept': 'طرق الدفع', 'Secure online payments by Paymob': 'مدفوعات إلكترونية آمنة عبر Paymob',
    'Online payments are processed securely by Paymob. We never see or store your card details.': 'المدفوعات الإلكترونية تتم بأمان عبر Paymob. لا نرى بيانات بطاقتك ولا نحتفظ بها.',

    // partner brands
    'Partner brands': 'علامات شريكة', '✓ Official partner · original products supplied by the brand': '✓ شريك رسمي · منتجات أصلية من العلامة مباشرة',
    '✓ Official partner': '✓ شريك رسمي', 'What are you': 'بتدور', 'looking for?': 'على إيه؟', 'For your business': 'لنشاطك التجاري', 'Google reviews, payments & printed stands': 'تقييمات جوجل والدفع والستاندات المطبوعة', 'For cafés & restaurants': 'للكافيهات والمطاعم', 'Review stands, QR menus & coffee supply': 'ستاندات تقييم ومنيو QR وتوريد قهوة', 'Specialty coffee': 'قهوة مختصة', 'Fresh beans from our roasting partners': 'حبوب طازة من محامص شريكة', 'Beauty & skincare': 'الجمال والعناية بالبشرة', 'Korean skincare, original products': 'عناية كورية بالبشرة، منتجات أصلية', 'For businesses': 'للأنشطة التجارية', 'Get more reviews, followers and payments': 'تقييمات ومتابعين ومدفوعات أكتر', 'NFC & QR stands and cards for Google reviews, social media and InstaPay, printed with your design — plus custom acrylic stands, coasters and monthly marketing plans.': 'ستاندات وكروت NFC وQR لتقييمات جوجل والسوشيال ميديا وإنستاباي مطبوعة بتصميمك — بالإضافة لستاندات وكوسترات أكريليك حسب الطلب وخطط تسويق شهرية.', 'Everything your café needs to grow': 'كل اللي الكافيه محتاجه عشان يكبر', 'Google review stands, QR menu coasters and table numbers printed with your logo — and specialty coffee from Bonds Coffee Roasters, wholesale or under your own label.': 'ستاندات تقييم جوجل، كوسترات منيو QR وأرقام طاولات مطبوعة بلوجو الكافيه — وقهوة مختصة من بوندز لتحميص القهوة بالجملة أو باسمك التجاري.', 'Freshly roasted coffee beans': 'حبوب قهوة محمصة طازة', 'Blends and single origins from Bonds Coffee Roasters, in 250 g and 1 kg, delivered across Egypt. Buying for a café or office? Ask for wholesale prices.': 'بلندات وقهوة أحادية المصدر من بوندز لتحميص القهوة، 250 جم و1 كجم، توصيل لكل مصر. بتشتري لكافيه أو مكتب؟ اطلب أسعار الجملة.', 'Korean skincare': 'عناية كورية بالبشرة', 'Original products from The Face Shop and Round Lab, delivered across Egypt with cash on delivery.': 'منتجات أصلية من ذا فيس شوب وراوند لاب، توصيل لكل مصر والدفع عند الاستلام.', '← See the whole shop': '→ شوف المتجر كله', 'Wholesale & private-label coffee': 'قهوة بالجملة أو باسمك التجاري', 'Coffee for your café, restaurant or office from Bonds Coffee Roasters: wholesale prices, tailored roasting, or coffee under your own brand name. Tell us what you need and we’ll reply with a quote, usually the same day.': 'قهوة لكافيهك أو مطعمك أو مكتبك من بوندز لتحميص القهوة: أسعار جملة، تحميص حسب ذوقك، أو قهوة باسم علامتك التجارية. قولنا محتاج إيه وهنرد عليك بعرض سعر، غالبًا في نفس اليوم.', 'NFC Google-review cards and stands, printed acrylic stands and coasters, and monthly lead-generation plans for Egyptian businesses — plus specialty coffee and skincare from our partner brands. Clear prices in EGP, delivered across Egypt.': 'كروت وستاندات NFC لتقييمات جوجل، ستاندات وكوسترات أكريليك مطبوعة، وخطط شهرية لجلب العملاء للأنشطة التجارية في مصر — بالإضافة لقهوة مختصة ومنتجات عناية من علاماتنا الشريكة. أسعار واضحة بالجنيه وتوصيل لكل مصر.',
    '1 kg': '1 كجم', '250 g': '250 جم', 'Without NFC': 'بدون NFC', 'With NFC': 'مع NFC', '5 × 5 cm': '5 × 5 سم', '10 × 15 cm': '10 × 15 سم', '12 × 18 cm': '12 × 18 سم', '15 × 21 cm': '15 × 21 سم', '21 × 29 cm': '21 × 29 سم', 'Buy 3 & save': 'اشترِ 3 ووفّر', 'Special offer': 'عرض خاص', '8 × 8 cm': '8 × 8 سم', '10 × 10 cm': '10 × 10 سم', '12 × 12 cm': '12 × 12 سم',
    'For businesses: private label, tailored roasting or bulk orders. Tell us what you need and we’ll reply with a quote, usually the same day.': 'للشركات: علامة خاصة، تحميص مخصص أو طلبات بالجملة. أخبرنا بما تحتاجه وسنرسل لك عرض سعر، غالبًا في نفس اليوم.',
    'Phone or email': 'الهاتف أو الإيميل', 'Your name': 'اسمك', 'Send request': 'إرسال الطلب',
    'Business name, what you need and roughly how much (e.g. 20 kg a month for our café)': 'اسم النشاط، وما تحتاجه والكمية تقريبًا (مثال: 20 كجم شهريًا لمقهانا)',
    'Thank you — we’ve got your request and will contact you shortly.': 'شكرًا — وصلنا طلبك وسنتواصل معك قريبًا.', 'Official partner': 'شريك رسمي', 'Sold in partnership with': 'يُباع بالشراكة مع', 'More from': 'المزيد من', 'Visit': 'زيارة', 'Visit the brand ↗': 'زيارة العلامة ↗',
    'Original products, supplied directly by the brand. Delivered across Egypt by Where To Spot, with cash on delivery.': 'منتجات أصلية من العلامة مباشرة. توصّلها Where To Spot لكل مصر، مع الدفع عند الاستلام.',

    // shop
    'Where To Spot · Shop': 'Where To Spot · المتجر', 'by category': 'حسب الفئة', 'Search products': 'ابحث عن منتج', 'All': 'الكل',
    'Shop by category': 'تسوّق حسب الفئة', 'In stock': 'المتوفر فقط', 'Min EGP': 'من (ج.م)', 'Max EGP': 'إلى (ج.م)', 'Minimum price': 'أقل سعر', 'Maximum price': 'أعلى سعر',
    'Sort products': 'ترتيب المنتجات', 'Sort: Popular': 'الترتيب: الأكثر طلبًا', 'Sort: Newest': 'الترتيب: الأحدث', 'Price: low to high': 'السعر: من الأقل للأعلى',
    'Price: high to low': 'السعر: من الأعلى للأقل', 'Popular': 'الأكثر طلبًا', 'Newest': 'الأحدث',
    'No products match': 'لا توجد منتجات مطابقة', 'Try clearing your search, category or price filters.': 'جرّب مسح البحث أو الفئة أو فلتر السعر.',
    'No photo yet': 'لا توجد صورة بعد', 'Save to wishlist': 'أضف للمفضلة', 'Add to cart': 'أضف للسلة', 'Add': 'أضف', 'Choose options': 'اختر المواصفات', 'Choose': 'اختر',
    'Show more products': 'عرض منتجات أكثر', 'Filter & sort': 'فلترة وترتيب', 'Filters': 'الفلاتر', 'Sort by': 'ترتيب حسب', 'Category': 'الفئة', 'Price': 'السعر',
    'Availability': 'التوفر', 'Only show items in stock': 'عرض المنتجات المتوفرة فقط', 'Clear all': 'مسح الكل', 'Any price': 'أي سعر', 'Clear': 'مسح',
    'Clear search': 'مسح البحث', 'Remove filter': 'إزالة الفلتر',

    // hero, services, about, clients, quote
    'Where To Spot · Giza, Egypt': 'Where To Spot · الجيزة، مصر', 'Get found.': 'اظهر لعملائك.', 'Get reviewed.': 'اجمع تقييمات أكثر.', 'Get customers.': 'واكسب عملاء جدد.',
    'NFC Google-review cards and stands, Korean skincare, and monthly lead-generation plans for Egyptian businesses. Clear prices in EGP, delivered across Egypt.':
      'كروت وستاندات NFC لتقييمات جوجل، ومستحضرات عناية كورية، وخطط شهرية لجلب العملاء للشركات المصرية. أسعار واضحة بالجنيه المصري، وتوصيل لكل مصر.',
    'Shop products': 'تسوّق المنتجات', 'See marketing plans': 'شاهد خطط التسويق', 'Delivery across Egypt in 2–5 days': 'توصيل لكل مصر خلال 2–5 أيام',
    'Cash on delivery': 'الدفع عند الاستلام', '14-day returns': 'استرجاع خلال 14 يوم', '20+ brands': '+20 علامة تجارية',
    'Samsung, Vodafone, Pandora and more work with us': 'سامسونج وفودافون وباندورا وغيرهم يعملون معنا',
    'Custom work': 'أعمال حسب الطلب', 'Creative & production': 'خدمات التصميم', 'services': 'والإنتاج',
    'From a single shop sign to a full exhibition booth. Every project is quoted in EGP and handled by one team, from design to installation.':
      'من لافتة محل واحدة إلى جناح معرض كامل. كل مشروع له عرض سعر بالجنيه المصري، وفريق واحد يتولاه من التصميم حتى التركيب.',
    'Printing & signage': 'الطباعة واللافتات', 'Banners, stickers, menus, business cards, shop signs and vehicle wraps.': 'بانرات، ستيكرات، منيوهات، كروت شخصية، لافتات محلات وتغليف سيارات.',
    'Acrylic & fabrication': 'الأكريليك والتصنيع', 'Display stands, product cases, kiosks and branded fixtures.': 'ستاندات عرض، علب منتجات، أكشاك وتجهيزات تحمل علامتك.',
    'Events & activations': 'الفعاليات والتنشيط', 'Exhibition booths, launch events and on-site branding.': 'أجنحة معارض، حفلات إطلاق، وبراندنج في الموقع.',
    'Video & photo production': 'إنتاج الفيديو والتصوير', 'Promo videos, reels, event coverage and product photography.': 'فيديوهات دعائية، ريلز، تغطية فعاليات وتصوير منتجات.',
    'Social media & ads': 'السوشيال ميديا والإعلانات', 'Content, community management and paid campaigns.': 'محتوى، إدارة صفحات، وحملات ممولة.',
    'Websites & AI tools': 'المواقع وأدوات الذكاء الاصطناعي', 'Websites, online stores, chat assistants and automation.': 'مواقع، متاجر إلكترونية، مساعدات محادثة وأتمتة.',
    'Request a quote': 'اطلب عرض سعر', 'We reply within one business day.': 'نرد خلال يوم عمل واحد.',
    'One team for print, products,': 'فريق واحد للطباعة والمنتجات،', 'digital and AI.': 'والديجيتال والذكاء الاصطناعي.',
    'Where To Spot is a marketing and creative studio in 6th of October City, Giza. We help businesses get found and win customers, with lead-generation campaigns, NFC review tools, printing and acrylic fabrication, events, video and websites.':
      'Where To Spot استوديو تسويق وإبداع في مدينة 6 أكتوبر بالجيزة. نساعد الشركات على الظهور وكسب العملاء من خلال حملات جلب العملاء، وأدوات تقييم NFC، والطباعة وتصنيع الأكريليك، والفعاليات، والفيديو، والمواقع.',
    'Lead generation': 'جلب العملاء', 'NFC review tools': 'أدوات تقييم NFC', 'Printing': 'الطباعة', 'Acrylic': 'الأكريليك', 'Events': 'الفعاليات',
    'Video': 'الفيديو', 'Websites': 'المواقع', 'Read more about us': 'اعرف المزيد عنا',
    'Trusted by brands across Egypt and the region': 'علامات تجارية في مصر والمنطقة تثق بنا', 'From neighbourhood cafés to global names': 'من كافيهات الحي إلى أسماء عالمية',
    'Corporate & bulk orders': 'طلبات الشركات والكميات', 'Ordering for a team, a chain or an event?': 'تطلب لفريق أو سلسلة فروع أو فعالية؟',
    'Tell us what you need and our team will send you a quote, usually the same day.': 'أخبرنا بما تحتاجه وسيرسل لك فريقنا عرض سعر، غالبًا في نفس اليوم.',
    'Lower prices as quantities go up': 'أسعار أقل كلما زادت الكمية', 'Your logo and brand colours on every piece': 'شعارك وألوان علامتك على كل قطعة',
    'One contact from design to delivery': 'شخص واحد يتابع معك من التصميم حتى التسليم', 'Thank you.': 'شكرًا لك.',
    'We’ve got your details and will be in touch shortly.': 'وصلتنا بياناتك وسنتواصل معك قريبًا.', 'Your name': 'اسمك', 'Full name': 'الاسم بالكامل',
    'Phone or email': 'الهاتف أو البريد الإلكتروني', 'Interested in': 'مهتم بـ', 'Marketing plans / other': 'خطط التسويق / أخرى',

    // track order, wishlist
    'Order ID (leave blank to see all orders)': 'رقم الطلب (اتركه فارغًا لعرض كل طلباتك)', 'e.g. WTS-1001': 'مثال: WTS-1001',
    'Email used at checkout': 'البريد الإلكتروني المستخدم في الطلب', 'Look up': 'بحث', 'No matching order found — check the ID and email.': 'لم نجد طلبًا مطابقًا — تأكد من الرقم والبريد الإلكتروني.',
    'Total': 'الإجمالي', 'Nothing saved yet — tap the heart on a product to add it here.': 'لا يوجد شيء محفوظ بعد — اضغط على القلب في أي منتج لإضافته هنا.',
    'Awaiting payment': 'في انتظار الدفع', 'Pending': 'قيد المراجعة', 'Confirmed': 'مؤكد', 'Designing': 'جاري التصميم', 'Awaiting approval': 'في انتظار موافقتك',
    'In production': 'قيد التنفيذ', 'Ready': 'جاهز', 'Shipped': 'تم الشحن', 'Delivered': 'تم التوصيل', 'Cancelled': 'ملغي', 'Returned': 'مرتجع',

    // cart
    'Your cart': 'سلة المشتريات', 'Checkout': 'إتمام الطلب', 'Order placed': 'تم الطلب', '← Continue shopping': '→ متابعة التسوق', 'Continue shopping': 'متابعة التسوق',
    'Your cart is empty': 'سلتك فارغة', 'Browse the shop and add something you like.': 'تصفح المتجر وأضف ما يعجبك.', 'remove': 'حذف', 'Promo code': 'كود الخصم',
    'Apply': 'تطبيق', 'Subtotal': 'المجموع الفرعي', 'Delivery': 'التوصيل', 'Free': 'مجاني', 'Free delivery': 'توصيل مجاني', 'Total (EGP)': 'الإجمالي (ج.م)',
    'Continue to checkout': 'متابعة لإتمام الطلب', 'Promo applied': 'تم تطبيق كود الخصم', 'Saved to wishlist': 'تمت الإضافة للمفضلة', 'Removed from wishlist': 'تم الحذف من المفضلة',
    'Added to cart ✓': 'تمت الإضافة للسلة ✓', 'Logo is larger than 5 MB': 'حجم الشعار أكبر من 5 ميجا',

    // checkout
    'Order total': 'إجمالي الطلب', 'Edit cart': 'تعديل السلة', 'Your details': 'بياناتك', 'Mobile number': 'رقم الموبايل',
    'we call or WhatsApp to confirm': 'نتصل بك أو نراسلك واتساب للتأكيد', 'Email': 'البريد الإلكتروني', 'for your receipt': 'لإرسال الإيصال',
    'anywhere in Egypt': 'لأي مكان في مصر', 'Delivery area': 'منطقة التوصيل', '— so the courier finds you': '— ليصل إليك المندوب بسهولة', 'Change': 'تغيير',
    '🔍 Type your area — e.g. Nasr City or مدينة نصر': '🔍 اكتب منطقتك — مثلًا مدينة نصر', 'Search your delivery area': 'ابحث عن منطقة التوصيل',
    '✨ Suggested from your address': '✨ مقترح من عنوانك', 'No match — try another spelling, or choose from the list.': 'لا توجد نتائج — جرّب كتابة أخرى أو اختر من القائمة.',
    'Or choose from the list of governorates →': 'أو اختر من قائمة المحافظات ←', '← Search your area instead': '→ ابحث عن منطقتك بدلًا من ذلك',
    'Governorate': 'المحافظة', 'Area': 'المنطقة', 'Neighbourhood': 'الحي', '(optional)': '(اختياري)', 'Choose your governorate': 'اختر محافظتك',
    'Choose a governorate first': 'اختر المحافظة أولًا', 'Choose your area': 'اختر منطقتك', 'Loading areas…': 'جاري تحميل المناطق…',
    'Street address': 'العنوان بالتفصيل', 'street, building, floor, flat': 'الشارع، رقم العمارة، الدور، الشقة',
    'e.g. 12 Abbas El Akkad St, building 4, floor 2': 'مثال: 12 شارع عباس العقاد، عمارة 4، الدور 2',
    '3 · Personalise your items': '3 · تخصيص منتجاتك',
    'We print these on your stands and cards. We’ll send you the design to approve before production.': 'نطبع هذه البيانات على الستاندات والكروت، وسنرسل لك التصميم لتوافق عليه قبل التنفيذ.',
    'Business / brand name': 'اسم النشاط / العلامة التجارية', 'As it should appear on the design': 'كما تريده أن يظهر في التصميم', 'Google review link': 'رابط تقييم جوجل',
    '(optional — we can find it for you)': '(اختياري — يمكننا إيجاده لك)', 'https://g.page/r/… or your Google Maps link': 'https://g.page/r/… أو رابط خرائط جوجل',
    'Instagram / Facebook / TikTok / website': 'إنستجرام / فيسبوك / تيك توك / موقع', 'One link per line': 'رابط في كل سطر', 'Logo': 'الشعار',
    '(optional — JPG, PNG or PDF up to 5 MB, or send it on WhatsApp later)': '(اختياري — JPG أو PNG أو PDF حتى 5 ميجا، أو أرسله على واتساب لاحقًا)',
    'Uploading…': 'جاري الرفع…', 'Design notes': 'ملاحظات التصميم', 'Colours, text, anything we should know': 'الألوان، النصوص، أي شيء يجب أن نعرفه',
    'Payment': 'الدفع', 'Pay now by card': 'ادفع الآن بالبطاقة', 'Visa, Mastercard or Meeza · secure Paymob page': 'فيزا أو ماستركارد أو ميزة · صفحة Paymob الآمنة',
    'Mobile wallet': 'محفظة إلكترونية', 'Vodafone Cash, Etisalat Cash, Orange Cash and others': 'فودافون كاش، اتصالات كاش، أورنج كاش وغيرها',
    'Pay the courier when your order arrives': 'ادفع للمندوب عند استلام طلبك',
    'Test mode: online payments use Paymob test cards. No real money is charged.': 'وضع التجربة: الدفع الإلكتروني يستخدم بطاقات Paymob التجريبية. لن يتم خصم أي أموال حقيقية.',
    'Have a referral code?': 'معك كود إحالة؟', 'Referral code': 'كود الإحالة', 'Got a code from a rep?': 'معك كود من مندوب؟',
    'Code not recognized — check it and try again, or leave it blank.': 'الكود غير معروف — راجعه وحاول مرة أخرى، أو اتركه فارغًا.',
    'Remember my details on this device': 'تذكّر بياناتي على هذا الجهاز', 'I agree to the': 'أوافق على سياسات:', 'and': 'و', 'policies.': '.',
    'Please choose your delivery area — type it in the “Delivery area” box.': 'من فضلك اختر منطقة التوصيل — اكتبها في خانة "منطقة التوصيل".',
    'Place order': 'تأكيد الطلب', 'Placing order…': 'جاري إرسال الطلب…', 'Opening secure payment…': 'جاري فتح صفحة الدفع الآمنة…',
    'Payment received': 'تم استلام الدفع', 'Payment didn’t go through': 'لم تتم عملية الدفع', 'Checking your payment': 'جاري التحقق من الدفع',
    'Payment not started': 'لم يبدأ الدفع', 'Order confirmed': 'تم تأكيد الطلب', 'Order received': 'تم استلام طلبك',
    'We’re confirming your payment with Paymob. You’ll get a call or WhatsApp from us shortly.': 'نتحقق من دفعتك مع Paymob. سنتصل بك أو نراسلك واتساب قريبًا.',
    'Online payment could not be started.': 'تعذر بدء الدفع الإلكتروني.',
    'Online payment could not be started. Your order isn’t confirmed yet — try again, or choose cash on delivery.': 'تعذر بدء الدفع الإلكتروني. طلبك لم يتأكد بعد — حاول مرة أخرى أو اختر الدفع عند الاستلام.', 'Try paying online again': 'حاول الدفع أونلاين مرة أخرى',
    'Pay cash on delivery instead': 'ادفع عند الاستلام بدلًا من ذلك', 'Your order number': 'رقم طلبك',
    'Please call us on +20 127 766 0666 to complete the payment.': 'من فضلك اتصل بنا على ‎+20 127 766 0666 لإتمام الدفع.',
    'Please call us on +20 127 766 0666 to confirm your order.': 'من فضلك اتصل بنا على ‎+20 127 766 0666 لتأكيد طلبك.',

    // messages from the server
    'This promo code is not valid.': 'كود الخصم غير صالح.', 'This promo code is not active yet.': 'كود الخصم لم يبدأ بعد.',
    'This promo code has expired.': 'انتهت صلاحية كود الخصم.', 'This promo code has been fully used.': 'تم استخدام كود الخصم بالكامل.',
    'Please enter your name.': 'من فضلك أدخل اسمك.', 'Please enter a valid email.': 'من فضلك أدخل بريدًا إلكترونيًا صحيحًا.',
    'Please enter a phone number so we can confirm your order.': 'من فضلك أدخل رقم هاتف لنؤكد طلبك.', 'Please enter your delivery address.': 'من فضلك أدخل عنوان التوصيل.',
    'Please enter the business or brand name to print on your items.': 'من فضلك أدخل اسم النشاط أو العلامة لطباعته على منتجاتك.',
    'Referral code not recognised — check it or leave it blank.': 'كود الإحالة غير معروف — راجعه أو اتركه فارغًا.',
    'Something went wrong. Please try again or contact us.': 'حدث خطأ. حاول مرة أخرى أو تواصل معنا.',
    'Could not reach the shop. Check your connection and try again.': 'تعذر الاتصال بالمتجر. تحقق من الإنترنت وحاول مرة أخرى.',
    'A product in your cart is no longer available. Please refresh.': 'أحد المنتجات في سلتك لم يعد متاحًا. من فضلك حدّث الصفحة.',
    'A product in the order is no longer available. Please refresh.': 'أحد المنتجات في الطلب لم يعد متاحًا. من فضلك حدّث الصفحة.',
    'Online payment is not available right now. Please choose cash on delivery.': 'الدفع الإلكتروني غير متاح حاليًا. من فضلك اختر الدفع عند الاستلام.',
    'Online payment is not available right now.': 'الدفع الإلكتروني غير متاح حاليًا.',
    'Online payment could not be started. Please try again or choose cash on delivery.': 'تعذر بدء الدفع الإلكتروني. حاول مرة أخرى أو اختر الدفع عند الاستلام.',
    'Paymob did not start the payment. Please try again or choose cash on delivery.': 'لم يبدأ Paymob عملية الدفع. حاول مرة أخرى أو اختر الدفع عند الاستلام.',
    'This order already has a payment. Please contact us.': 'هذا الطلب عليه دفعة بالفعل. من فضلك تواصل معنا.',
    'This order can’t be paid online. Please contact us.': 'لا يمكن دفع هذا الطلب أونلاين. من فضلك تواصل معنا.',
    'This order expired because it wasn’t paid. Please place it again from the shop.': 'انتهت صلاحية الطلب لأنه لم يُدفع. من فضلك اطلبه مرة أخرى من المتجر.',
    'This order expired. Please place it again from the shop.': 'انتهت صلاحية الطلب. من فضلك اطلبه مرة أخرى من المتجر.',
    'This order is already confirmed.': 'هذا الطلب مؤكد بالفعل.',
    'We couldn’t find that order. Check the number and the email or phone you used.': 'لم نجد هذا الطلب. تأكد من رقم الطلب والبريد أو الهاتف المستخدم.',
    'Too many orders from this connection. Please call us.': 'طلبات كثيرة من هذا الاتصال. من فضلك اتصل بنا.', 'Too many attempts. Please call us.': 'محاولات كثيرة. من فضلك اتصل بنا.',
    'Too many tries. Please wait a while.': 'محاولات كثيرة. انتظر قليلًا.', 'Too many lookups. Try again later.': 'عمليات بحث كثيرة. حاول لاحقًا.',
    'Only JPG, PNG, WebP or PDF files are allowed.': 'مسموح فقط بملفات JPG أو PNG أو WebP أو PDF.', 'Upload failed': 'فشل الرفع',

    // product page
    '← Shop': '→ المتجر', 'Product not found': 'المنتج غير موجود', 'This product may have been removed or the link is incorrect.': 'ربما تم حذف هذا المنتج أو الرابط غير صحيح.',
    'Back to shop': 'العودة للمتجر', 'Size': 'المقاس', 'Buy more, pay less per piece': 'اشترِ أكثر وادفع أقل للقطعة', 'Added ✓': 'تمت الإضافة ✓',
    'Out of stock': 'نفد المخزون', 'Buy now': 'اشترِ الآن', 'View cart →': 'عرض السلة ←', 'Quantity': 'الكمية',
    'Price in Egyptian Pounds (EGP) · pay online by card or wallet, or cash on delivery': 'السعر بالجنيه المصري · ادفع أونلاين بالبطاقة أو المحفظة، أو عند الاستلام',
    'Delivery across Egypt: 1–3 business days in Cairo & Giza, 3–7 elsewhere —': 'التوصيل لكل مصر: 1–3 أيام عمل في القاهرة والجيزة، و3–7 لباقي المحافظات —',
    'delivery policy': 'سياسة التوصيل', '14-day returns on unused items —': 'استرجاع خلال 14 يوم للمنتجات غير المستخدمة —', 'refund policy': 'سياسة الاسترجاع',
    'Questions?': 'أسئلة؟', 'You may also like': 'قد يعجبك أيضًا', 'No reviews yet — be the first to share your experience.': 'لا توجد تقييمات بعد — كن أول من يشارك تجربته.',
    'Write a review': 'اكتب تقييمًا', 'Only customers who received this product can review it, so every review here is from a real buyer.': 'التقييم متاح بس للعملاء اللي استلموا المنتج ده، عشان كل التقييمات هنا من مشترين حقيقيين.', 'Sign in with the email you ordered with. We’ll email you a code, no password needed.': 'سجّل دخول بالإيميل اللي طلبت بيه. هنبعتلك كود على الإيميل، من غير باسورد.', 'Your email': 'بريدك الإلكتروني', 'Send me a code': 'ابعتلي كود', '6-digit code': 'الكود (6 أرقام)', 'Signed in as': 'داخل بحساب', 'We couldn’t find a delivered order with this product for this email. Once your order arrives, you can review it here.': 'مش لاقيين طلب اتسلّم فيه المنتج ده على الإيميل ده. أول ما طلبك يوصل، تقدر تقيّمه من هنا.', 'You’ve reviewed this product. You can update your review below.': 'أنت قيّمت المنتج ده قبل كده. تقدر تعدّل تقييمك تحت.', 'Update review': 'تحديث التقييم', 'Thanks for your review ✓': 'شكرًا على تقييمك ✓', '✓ Verified purchase': '✓ مشتري مؤكد', 'No reviews yet. Reviews here come only from customers who received this product.': 'لا توجد تقييمات بعد. التقييمات هنا من العملاء اللي استلموا المنتج بس.', 'Only customers who received this product can review it.': 'التقييم متاح بس للعملاء اللي استلموا المنتج ده.', 'Please sign in with the email you ordered with.': 'سجّل دخول بالإيميل اللي طلبت بيه.', 'Please write a few words about the product.': 'اكتب كلمتين عن المنتج.', 'Please write your name.': 'اكتب اسمك.', 'Share what you liked or didn\'t': 'شاركنا ما أعجبك وما لم يعجبك', 'Submit review': 'إرسال التقييم',
    'Thanks for your review ✓': 'شكرًا على تقييمك ✓', 'Recently viewed': 'شاهدتها مؤخرًا', 'Previous image': 'الصورة السابقة', 'Next image': 'الصورة التالية',

    // customer account
    'Sign in': 'تسجيل الدخول', 'My account': 'حسابي', 'Account': 'حسابي', 'Signed in': 'تم تسجيل الدخول', 'Signed out': 'تم تسجيل الخروج',
    'Details saved': 'تم حفظ البيانات', 'Preferences saved': 'تم حفظ التفضيلات', 'These products are no longer available': 'هذه المنتجات لم تعد متاحة',
    'Paid': 'مدفوع', 'Pay on delivery': 'الدفع عند الاستلام', 'Placed': 'تم الطلب', 'Not chosen yet': 'لم يتم الاختيار بعد', 'Your order': 'طلبك',
    'Sign in with your email. We’ll send you a 6-digit code — no password to remember.': 'سجّل الدخول ببريدك الإلكتروني. سنرسل لك كودًا من 6 أرقام — بدون كلمة مرور.',
    'Checkout in seconds — your details are saved': 'إتمام الطلب في ثوانٍ — بياناتك محفوظة', 'Track every order and its delivery': 'تابع كل طلب وتوصيله',
    'See what you bought and buy again in one tap': 'شاهد مشترياتك واطلبها مرة أخرى بضغطة واحدة', 'Email me a code': 'أرسل لي الكود', 'Sending…': 'جاري الإرسال…',
    'Checking…': 'جاري التحقق…', 'Enter the 6-digit code we sent to': 'أدخل الكود المكون من 6 أرقام الذي أرسلناه إلى', 'Sign-in code': 'كود الدخول',
    'Send a new code': 'أرسل كودًا جديدًا', 'Use a different email': 'استخدم بريدًا آخر',
    'Didn’t get it? Check your spam folder. The code works for 15 minutes.': 'لم يصلك؟ راجع مجلد الرسائل غير المرغوب فيها (Spam). الكود صالح لمدة 15 دقيقة.',
    'My orders': 'طلباتي', 'My details': 'بياناتي', 'Preferences': 'التفضيلات', 'Tracking number': 'رقم التتبع', 'Buy again': 'اطلب مرة أخرى', 'Save details': 'حفظ البيانات',
    'No orders yet. When you order while signed in (or with this email), they appear here with their tracking.': 'لا توجد طلبات بعد. الطلبات التي تتم وأنت مسجّل (أو بهذا البريد) تظهر هنا مع تتبعها.',
    'Change it at checkout — we save the area you choose.': 'يمكنك تغييرها عند إتمام الطلب — نحفظ المنطقة التي تختارها.', 'Language': 'اللغة',
    'How should we contact you about orders?': 'كيف نتواصل معك بخصوص الطلبات؟', 'Phone call': 'مكالمة هاتفية',
    'Send me offers and new products (a few times a month)': 'أرسلوا لي العروض والمنتجات الجديدة (بضع مرات في الشهر)', 'Sign out': 'تسجيل الخروج',
    'Signed in as': 'مسجّل الدخول باسم', '— your details are filled in and saved for next time.': '— بياناتك مكتوبة ومحفوظة للمرة القادمة.',
    'Have an account? Sign in and we’ll fill this in for you': 'عندك حساب؟ سجّل الدخول وسنملأ البيانات لك',
    'Track this order and check out faster next time': 'تابع هذا الطلب واطلب أسرع المرة القادمة', 'Create a free account with': 'أنشئ حسابًا مجانيًا بـ',
    '— we’ll send you a code, no password.': '— سنرسل لك كودًا، بدون كلمة مرور.', 'Create my account': 'أنشئ حسابي', 'See this order in my account →': 'شاهد الطلب في حسابي ←',
    'We just sent a code — please check your email (and spam), or wait a minute to get a new one.': 'أرسلنا الكود للتو — راجع بريدك (وSpam)، أو انتظر دقيقة لطلب كود جديد.',
    'This code has expired. Please ask for a new one.': 'انتهت صلاحية الكود. اطلب كودًا جديدًا.', 'Too many wrong codes. Please ask for a new one.': 'أكواد خاطئة كثيرة. اطلب كودًا جديدًا.',
    'That code isn’t right. Check the latest email we sent.': 'الكود غير صحيح. راجع آخر رسالة أرسلناها.', 'Please sign in again.': 'من فضلك سجّل الدخول مرة أخرى.',
    'One last step': 'خطوة أخيرة', 'Add your name and mobile number so we can confirm your orders and the courier can reach you.': 'أضف اسمك ورقم موبايلك لنؤكد طلباتك ويستطيع المندوب الوصول إليك.',
    'Save and continue': 'حفظ ومتابعة', 'Complete your profile': 'أكمل بياناتك', 'Delivery address': 'عنوان التوصيل', 'Saved automatically with your first order.': 'يُحفظ تلقائيًا مع أول طلب.',
    'Addresses you used before': 'عناوين استخدمتها من قبل', 'Use this': 'استخدم هذا', '✓ Default': '✓ الافتراضي', 'Address saved': 'تم حفظ العنوان', 'Country code': 'كود الدولة',
    'Phone number': 'رقم الهاتف', 'Please enter your name and a valid mobile number.': 'من فضلك أدخل اسمك ورقم موبايل صحيح.',
    'In transit between hubs': 'في الطريق بين المخازن', 'Out for delivery': 'خرج للتوصيل', 'Pickup requested': 'في انتظار الاستلام من المخزن', 'Received at warehouse': 'وصل المخزن',

    // pieces of sentences that have a price, code or count in the middle
    'Free delivery across Egypt on orders over': 'توصيل مجاني لكل مصر للطلبات فوق', '· All prices in Egyptian Pounds (EGP)': '· كل الأسعار بالجنيه المصري',
    '· qty': '· الكمية', 'Adjusted for available stock:': 'تم تعديل الكمية حسب المتوفر:', 'Promo': 'كود', 'applied (': 'مُطبّق (',
    'incl. delivery': 'شامل التوصيل', 'Order': 'طلب', 'reviews)': 'تقييم)', 'review)': 'تقييم)', 'Reviews': 'التقييمات',

    // page titles
    'Where To Spot — Shop & Marketing Services (EGP)': 'Where To Spot — متجر وخدمات تسويق (ج.م)', 'Google Review NFC Cards, Stands & More in Egypt | Where To Spot': 'كروت وستاندات NFC لتقييمات جوجل والمزيد في مصر | Where To Spot', 'Where To Spot — Shop': 'Where To Spot — المتجر',
    'Privacy': 'الخصوصية', 'Refund & cancellation policy': 'سياسة الاسترجاع والإلغاء', 'Delivery & shipping policy': 'سياسة التوصيل والشحن',
    'Privacy policy — Where To Spot': 'سياسة الخصوصية — Where To Spot',
  };

  // Text that contains numbers, prices or names.
  var P = [
    [/^Free delivery across Egypt on orders over (.+) · All prices in Egyptian Pounds \(EGP\)$/, 'توصيل مجاني لكل مصر للطلبات فوق $1 · كل الأسعار بالجنيه المصري'],
    [/^Wishlist \((\d+)\)$/, 'المفضلة ($1)'],
    [/^From (.+)$/, 'يبدأ من $1'],
    [/^(\d+) products?$/, function (m, n) { return arCount(+n); }],
    [/^Show (\d+) products?$/, function (m, n) { return 'عرض ' + arCount(+n); }],
    [/^Under (.+)$/, 'أقل من $1'], [/^Over (.+)$/, 'أكثر من $1'],
    [/^Order (WTS-\d+)$/, 'طلب $1'],
    [/^(.+) · qty$/, '$1 · الكمية'],
    [/^(.+ \(only \d+ left\)(, )?)+$/, function (m) { return m.replace(/\(only (\d+) left\)/g, '(متبقي $1 فقط)').replace(/, /g, '، '); }],
    [/^Adjusted for available stock: (.+)$/, function (m, a) { return 'تم تعديل الكمية حسب المتوفر: ' + a.replace(/\(only (\d+) left\)/g, '(متبقي $1 فقط)'); }],
    [/^(EGP [\d,.]+|[\d,.]+ ج\.م) off$/, function (m, a) { return 'خصم ' + a; }],
    [/^([\d.]+%) off$/, 'خصم $1'],
    [/^Promo (\S+) \((.+)\)$/, function (m, c, l) { return 'كود ' + c + ' (' + tr(l) + ')'; }],
    [/^Promo (\S+) applied \((.+)\)$/, function (m, c, l) { return 'تم تطبيق كود ' + c + ' (' + tr(l) + ')'; }],
    [/^Add (.+) more to use (\S+)\.$/, 'أضف $1 أخرى لاستخدام كود $2.'],
    [/^This code needs an order of EGP ([\d,]+) or more\.$/, 'هذا الكود يتطلب طلبًا بقيمة $1 ج.م أو أكثر.'],
    [/^incl\. delivery (.+)$/, function (m, a) { return 'شامل التوصيل ' + tr(a); }],
    [/^Not sure \/ anywhere in (.+)$/, 'غير متأكد / أي مكان في $1'],
    [/^(.+) · any neighbourhood$/, '$1 · أي حي'],
    [/^Pay (.+)$/, function (m, a) { return /^(EGP|[\d])/.test(a) || /ج\.م/.test(a) ? 'ادفع ' + a : null; }],
    [/^Thank you(?:, (.+?))?! Your order is paid and we’ll start preparing it\. We’ll call or WhatsApp you to confirm delivery\.$/,
      function (m, n) { return 'شكرًا' + (n ? ' يا ' + n : '') + '! تم دفع طلبك وسنبدأ في تجهيزه. سنتصل بك أو نراسلك واتساب لتأكيد التوصيل.'; }],
    [/^Thank you(?:, (.+?))?! Your order is confirmed — pay (.+) in cash when it arrives\. We’ll call or WhatsApp you to confirm delivery\.$/,
      function (m, n, a) { return 'شكرًا' + (n ? ' يا ' + n : '') + '! تم تأكيد طلبك — ادفع ' + a + ' نقدًا عند الاستلام. سنتصل بك أو نراسلك واتساب لتأكيد التوصيل.'; }],
    [/^Your order isn’t confirmed yet(?: \((.*)\))?\. Try paying again, or choose cash on delivery\. Unpaid orders are released after 3 hours\.$/,
      function (m, r) { return 'طلبك لم يتأكد بعد' + (r ? ' (' + r + ')' : '') + '. حاول الدفع مرة أخرى، أو اختر الدفع عند الاستلام. الطلبات غير المدفوعة تُلغى بعد 3 ساعات.'; }],
    [/^(.*) Your order isn’t confirmed yet — try again, or choose cash on delivery\.$/,
      function (m, a) { return tr(a) + ' طلبك لم يتأكد بعد — حاول مرة أخرى أو اختر الدفع عند الاستلام.'; }],
    [/^Thanks (.*) — we'll call or WhatsApp you on (.+) to confirm\. Pay (.+) in cash on delivery\. Questions\? (.+)$/,
      'شكرًا $1 — سنتصل بك أو نراسلك واتساب على $2 للتأكيد. ادفع $3 نقدًا عند الاستلام. أسئلة؟ $4'],
    [/^(.+): only (\d+) left in stock\.$/, '$1: متبقي $2 فقط في المخزون.'],
    [/^Only (\d+) left$/, 'متبقي $1 فقط'],
    [/^([\d.]+) \((\d+) reviews?\)$/, '$1 ($2 تقييم)'],
    [/^Reviews \((\d+)\)$/, 'التقييمات ($1)'],
    [/^(.+) · Official partner$/, '$1 · شريك رسمي'],
    [/^· (.+) ↗$/, function (m, a) { var t = tr(a); return t ? '· ' + t + ' ↗' : null; }], [/^Reviews$/, 'التقييمات'],
    [/^You save (.+)$/, 'وفّرت $1'],
    [/^Add 1 more to pay (.+) each$/, 'أضف قطعة واحدة لتدفع $1 للقطعة'],
    [/^Add (\d+) more to pay (.+) each$/, 'أضف $1 قطع لتدفع $2 للقطعة'],
    [/^(.+) for (\d+)$/, '$1 لـ $2 قطع'],
    [/^(.+) each$/, '$1 للقطعة'],
    [/^(.+) \(sold out\)$/, '$1 (نفد)'],
    [/^(.+) \(\+(.+) (each|once)\)$/, function (m, l, p, k) { return l + ' (+' + p + (k === 'once' ? ' مرة واحدة' : ' للقطعة') + ')'; }],
    [/^1 pcs$/, 'قطعة واحدة'], [/^(\d+(?:–\d+)?) pcs$/, '$1 قطعة'], [/^(\d+)\+ pcs$/, '$1+ قطعة'],
    [/^Total for (\d+) pieces?: (.+)$/, 'الإجمالي لـ $1 قطعة: $2'],
    [/^(.+) — Where To Spot$/, function (m, a) { var x = D[a]; return x ? x + ' — Where To Spot' : null; }],
  ];

  // Arabic counts: 1 منتج واحد, 2 منتجان, 3–10 منتجات, 11+ منتجًا.
  function arCount(n) { return n === 1 ? 'منتج واحد' : n === 2 ? 'منتجان' : n >= 3 && n <= 10 ? n + ' منتجات' : n + ' منتجًا'; }

  function tr(s) {
    var key = String(s).replace(/\s+/g, ' ').trim();
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(D, key)) return D[key];
    for (var i = 0; i < P.length; i++) {
      var m = key.match(P[i][0]);
      if (!m) continue;
      var out = typeof P[i][1] === 'function' ? P[i][1].apply(null, m) : key.replace(P[i][0], P[i][1]);
      if (out != null) return out;
    }
    return null;
  }
  // For scripts: WTS_T('Only {n} left', {n: 3}) — English in, current language out.
  window.WTS_T = function (s, vars) {
    var out = AR ? (tr(s) || s) : s;
    if (vars) Object.keys(vars).forEach(function (k) { out = out.split('{' + k + '}').join(vars[k]); });
    return out;
  };
  window.WTS_I18N = { lang: lang, ar: AR, set: setLang, t: function (s) { return AR ? (tr(s) || s) : s; } };

  // The switch: any element with data-lang-toggle (shop pages), else one added to the page menu.
  function wireToggles() {
    var els = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__wtsLang) continue;
      el.__wtsLang = true;
      el.setAttribute('aria-label', AR ? 'Switch to English' : 'التحويل للعربية');
      el.setAttribute('translate', 'no');
      el.addEventListener('click', function (e) { e.preventDefault(); setLang(AR ? 'en' : 'ar'); });
    }
    var links = document.querySelector('nav .links');
    if (links && !links.querySelector('[data-lang-toggle]')) {
      var a = document.createElement('a');
      a.href = '#'; a.className = 'langlink'; a.setAttribute('data-lang-toggle', '');
      a.textContent = AR ? 'English' : 'العربية';
      links.appendChild(a);
      wireToggles();
    }
  }

  // Styles: the language button everywhere, and Arabic type + right-to-left fixes when Arabic.
  var css = '[data-lang-toggle]{cursor:pointer}' +
    'nav .links a.langlink{font-weight:700;color:#A8552F}';
  if (AR) {
    css += 'html[lang=ar] body,html[lang=ar] button,html[lang=ar] input,html[lang=ar] select,html[lang=ar] textarea{font-family:"IBM Plex Sans Arabic","Work Sans",system-ui,sans-serif}' +
      // Arabic letters must join: no letter spacing, no italics, no Latin display serif.
      'html[lang=ar] *{letter-spacing:0!important}' +
      'html[lang=ar] [style*="Instrument Serif"],html[lang=ar] .h2,html[lang=ar] h1,html[lang=ar] h2,html[lang=ar] .pname,html[lang=ar] .ctitle,html[lang=ar] .foot-mark,html[lang=ar] .brand,html[lang=ar] .hero-badge b,html[lang=ar] .bulk-done b,html[lang=ar] .plan .price{font-family:"IBM Plex Sans Arabic",sans-serif!important;font-style:normal!important}' +
      'html[lang=ar] .h2,html[lang=ar] h1,html[lang=ar] .hero h1{font-weight:700!important;line-height:1.25!important}' +
      'html[lang=ar] .h2 em,html[lang=ar] .hero h1 em{font-style:normal}' +
      'html[lang=ar] .pname{font-weight:600;line-height:1.35}' +
      // mirror things placed with left/right
      '[dir=rtl] [style*="text-align:left"]{text-align:right!important}' +
      '[dir=rtl] [style*="margin-left:auto"]{margin-left:0!important;margin-right:auto!important}' +
      '[dir=rtl] .co-sum button{margin-left:0;margin-right:auto}' +
      '[dir=rtl] .pbadge{left:auto;right:16px}[dir=rtl] .pwish{right:auto;left:12px}' +
      '[dir=rtl] .hero-main{margin-left:0;margin-right:14%}[dir=rtl] .hero-inset{left:auto;right:0}[dir=rtl] .hero-badge{left:auto;right:2%}' +
      '[dir=rtl] .foot-col a,[dir=rtl] .foot-col button{text-align:right}[dir=rtl] .pay-note{text-align:left}' +
      '[dir=rtl] .marquee{direction:ltr}' +
      '[dir=rtl] [style*="border-left:1px solid #DDD6CC"]{border-left:none!important;border-right:1px solid #DDD6CC;padding-left:0!important;padding-right:4px}' +
      '[dir=rtl] th,[dir=rtl] td{text-align:right}[dir=rtl] footer .pay-row .pay-note{margin-left:0;margin-right:auto}' +
      '[dir=rtl] footer .pay-row > span:first-child{margin-right:0;margin-left:6px}[dir=rtl] .plan .badge{left:auto;right:24px}' +
      '[dir=rtl] .ccard:hover .carrow{transform:translateX(-3px)}' +
      // phone numbers, emails and links stay left-to-right
      '[dir=rtl] input[type=tel],[dir=rtl] input[type=email],[dir=rtl] input[type=url],[dir=rtl] input[type=number]{direction:ltr;text-align:right}' +
      '[dir=rtl] a[href^="tel:"],[dir=rtl] a[href^="mailto:"]{unicode-bidi:plaintext;direction:ltr;display:inline-block}';
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

  // ---- translate the page as it appears ----
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, NOSCRIPT: 1 };
  var ATTRS = ['placeholder', 'aria-label', 'title'];

  function doText(n) {
    var p = n.parentNode;
    if (!p || SKIP[p.nodeName] || (p.closest && p.closest('[translate=no],[data-no-i18n]'))) return;
    var v = n.nodeValue;
    // Text we already translated stays as it is (otherwise "→" ⇄ "←" would flip forever).
    if (!v || v === n.__wts || !/[A-Za-z→←,]/.test(v)) return;
    var out = tr(v);
    if (out == null || out === v.trim()) return;
    var lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
    n.__wts = lead + out + tail;
    n.nodeValue = n.__wts;
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
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else if (!SKIP[n.nodeName]) doAttrs(n);
    }
  }
  var title = document.title;
  function doTitle() { if (document.title !== title) title = document.title; var t = tr(title); if (t) { title = t; document.title = t; } }

  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
    wireToggles();
    doTitle();
  }).observe(html, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  document.addEventListener('DOMContentLoaded', function () { walk(document.body); doTitle(); wireToggles(); });
})();
