# IIS — فقط طرح، بدون تغییر سرور در C1

IIS تنها ورودی عمومی است: اینترنت → IP ثابت → NAT TCP 80/443 → Windows IIS → `127.0.0.1:18280` → WSL2 Docker → EventOS.
روتر هرگز 18280، 3000، 5432 یا Docker API را forward نمی‌کند. PostgreSQL و worker هیچ host port ندارند.

## پیش‌نیازها / READ-ONLY

- IIS، URL Rewrite و ARR نصب باشند؛ نصب یا تغییر در این بسته اجرا نمی‌شود.
- وضعیت ARR باید proxy enabled و `preserveHostHeader=true` باشد. Host اصلی برای tenant resolver ضروری است؛ `X-Forwarded-Host` مرجع هویت نیست.
- تنظیم ARR ممکن است در سطح سرور بر PricePilot/ServerOps اثر بگذارد. اگر مقادیر فعلی مناسب نیستند، **توقف**؛ تغییر سراسری بدون بررسی و مجوز جداگانه انجام نشود. این template آنها را تغییر نمی‌دهد.
- در سایت اختصاصی EventOS، فقط host binding دقیق `event.mediasanat.ir` و دامنه‌های tenant تاییدشده اضافه شوند؛ SNI و certificate معتبر همان hostname. هیچ binding موجود را ویرایش/حذف نکنید، هیچ binding عمومی خالی یا wildcard جدید نسازید.
- برای tenant جدید، ابتدا DNS TXT مالکیت در EventOS تایید شود؛ سپس DNS A/AAAA به IP صحیح، certificate، binding و allow-list سایت هماهنگ شوند. DNS verification به‌تنهایی TLS یا IIS binding ایجاد نمی‌کند.
- با NAT، HTTPS در IIS terminate می‌شود؛ template مقدار `X-Forwarded-Proto` را بر مبنای TLS واقعی IIS overwrite می‌کند و forwarded host را پاک می‌کند. هرگز scheme ارسالی کاربر را نپذیرید.

## Template / SAFE CHANGE فقط در کار استقرار آینده

`web.config.template` در C1 کپی/فعال نشود. با تنظیم فعلی فقط platform host پذیرفته می‌شود. برای دامنه‌های تاییدشده شرط اول را با regex escaped و anchored، مثلاً `^(event\.mediasanat\.ir|event\.customer-a\.ir)$` گسترش دهید. نام دامنه را بدون escape داخل regex قرار ندهید.

IIS administrator باید مجاز بودن این server variableها را بررسی کند: `HTTP_X_FORWARDED_PROTO`، `HTTP_X_FORWARDED_HOST`، `HTTP_X_FORWARDED_FOR`. عدم مجوز باعث URL Rewrite error می‌شود؛ تنظیم server-level جدید فقط پس از بررسی اثر بر سایت‌های زنده. پاسخ Location نباید توسط ARR به loopback بازنویسی شود؛ `reverseRewriteHostInResponseHeaders` و رفتار redirect را در سایت جدید بررسی کنید. Session cookies host-only باقی می‌مانند؛ هیچ Cookie Domain، rewrite توکن یا انتقال session بین hostnameها اضافه نشود.

## WSL2 روی Server 2022

WSL باید نسخه 2 و متعلق به حساب عملیاتی مشخص باشد؛ ثبت distro به user وابسته است. به قابلیت mirrored networking ویندوز 11 تکیه نکنید. Windows→WSL localhost forwarding و دسترسی IIS به `127.0.0.1:18280` باید پس از شروع مجاز EventOS با `smoke.ps1` از Windows تایید شود. اگر forwarding کار نکرد، **توقف**؛ publish روی 0.0.0.0 یا portproxy عمومی راه‌حل این بسته نیست. طراحی مسیر loopback باید جداگانه تایید شود.

راه‌اندازی WSL/Docker پس از reboot و حساب task/service هنوز باید توسط اپراتور طراحی و آزمایش شود؛ این بسته scheduled task یا service ایجاد نمی‌کند و WSL را shutdown نمی‌کند.

منابع رسمی: [WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking)، [IIS ARR reverse proxy](https://learn.microsoft.com/en-us/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing)، [URL Rewrite server variables](https://github.com/MicrosoftDocs/iis-docs/blob/main/iis/extensions/url-rewrite-module/url-rewrite-module-20-configuration-reference.md).
