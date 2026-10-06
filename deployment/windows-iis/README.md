# EventOS — Windows Server 2022 / WSL2 / IIS

**C1 بسته آماده‌سازی است؛ هیچ فرمان تغییر سرور را اکنون اجرا نکنید.** baseline انتشار: `9a40fd0e407f04cc1cff4ed5b32a846621048fca`. بسته جدید باید در image انتشار بعدی با GitHub gates سبز ساخته شود؛ image baseline قدیمی validator جدید را ندارد.

## مرز ایمنی

Compose project همیشه `eventos-production`، سرویس‌ها فقط `postgres/app/worker`، volume `eventos-production_production-postgres`، networkها با پیشوند همین project. هیچ resource خارجی یا `container_name` دستی نیست. تنها app روی **`127.0.0.1:18280:3000`** publish می‌شود؛ اشغال پورت باعث توقف است، نه انتخاب پورت جایگزین.

**PROTECTED / LIVE:** `127.0.0.1:18080` PricePilot، `127.0.0.1:18180` ServerOps؛ همچنین `pricepilot-production-web-1`, `pricepilot-production-api-1`, `pricepilot-production-worker-1`, `pricepilot-production-postgres-1`, `serverops`. هیچ stop/restart/rename/remove، تغییر network/volume/secrets یا IIS binding آنها مجاز نیست. preflight فقط نام/status/ports کانتینرها را می‌خواند؛ env/inspect سایر سرویس‌ها را dump نمی‌کند.

## 1 — پیش‌نیازها

- Windows Server 2022، IIS + ARR + URL Rewrite، Ubuntu WSL2 و Docker Engine/Compose موجود. حساب Windows ثبت‌کننده Ubuntu باید همان حساب اجرای scripts باشد؛ PowerShell دارای مجوز خواندن IIS و WSL root Docker. Node 22+ روی Windows برای env validator.
- PowerShell scripts باید با policy سازمان سازگار و در صورت نیاز code-signed باشند. این بسته execution policy سرور را تغییر نمی‌دهد. bash backup باید LF باشد؛ `.gitattributes` این profile آن را در Windows checkout حفظ می‌کند.
- حداقل 10 GiB free در C: و filesystem release داخل WSL، 2 GiB free Windows RAM؛ ظرفیت واقعی tenantها و رشد PostgreSQL جداگانه محاسبه شود.
- image معتبر با digest ثابت `registry/path/eventos@sha256:<64 hex>`، ساخته‌شده از release سبز با Dockerfile فعلی؛ image `latest` یا local fallback ممنوع. image باید script جدید `scripts/windows-iis-preflight.mjs` را داشته باشد.
- **SMTP اختیاری است:** تنظیم اولیه `MAIL_TRANSPORT=disabled` با `SMTP_URL=` و `SMTP_FROM=` خالی است. SMS OTP / Kavenegar و username/password به ایمیل وابسته نیستند. روش‌های ایمیلی در tenant غیرقابل‌فعال‌سازی و در login پنهان هستند؛ OTP، ثبت‌نام/ورود ایمیلی، verification، reset و invitation ایمیلی با پیام واضح unavailable رد می‌شوند، نه موفقیت ارسال جعلی. platform admin ورود email/password موجود خود را حفظ می‌کند؛ recovery ایمیلی خاموش است. Google با سه مقدار خالی خاموش و مستقل از SMTP باقی می‌ماند.
- برای فعال‌کردن ایمیل، `MAIL_TRANSPORT=smtp` و SMTPS URL دارای credentials واقعی و sender معتبر لازم است؛ سپس روش‌های ایمیلی را از تنظیم tenant فعال کنید. `MAIL_TRANSPORT=test` در production بدون استثنا ممنوع است. هیچ credentials جعلی یا service محلی SMTP اضافه نشود.
- تا زمانی که SMTP ندارید، بازیابی مدیر موجود نیازمند روند اپراتوری مجاز و ثبت‌شده است؛ bootstrap امن موجود فقط برای **اولین** Super Admin در دیتابیس بدون admin است و ابزار reset حساب موجود نیست. دعوت initial tenant owner / staff / participant که به email نیاز دارد نیز unavailable است؛ این کار مسیر دعوت SMS یا provisioning جایگزین اضافه نمی‌کند. پیش از rollout tenantهای جدید، این محدودیت workflow را با اپراتور هماهنگ کنید؛ هیچ دعوت یا تحویل جعلی نسازید.
- **رسانه محلی پایدار:** پیش‌فرض این profile برابر `MEDIA_STORAGE_DRIVER=local` و `MEDIA_LOCAL_ROOT=/app/data/media` است. فقط app به volume مستقل `eventos-production_media` دسترسی دارد؛ worker mount ندارد. مسیر فایل مستقیماً در IIS یا public منتشر نمی‌شود و همه خواندن‌ها از مسیر مجاز `/api/media/[id]` (و مسیر مجاز گواهی‌ها) انجام می‌شوند. S3 اختیاری است؛ انتخاب `s3` به endpoint خارجی HTTPS، bucket، region و credentials واقعی نیاز دارد. Kavenegar credentials همچنان از تنظیم امن tenant خوانده می‌شوند.
- DNS/TLS/NAT و Windows→WSL loopback، reboot persistence و recovery را مطابق [راهنمای IIS](iis/README-IIS.md) در مرحله اجرای جداگانه تایید کنید.

## 2 — فایل release و secrets / SAFE CHANGE، اجرای آینده

release را در مسیر مستقل و immutable مانند `C:\EventOS\releases\<commit>` stage کنید (WSL: `/mnt/c/EventOS/releases/<commit>`)، نه داخل workload موجود. `.env.production.example` را به `.env.production` در همین پوشه profile کپی کنید. فایل واقعی ignored است. ACL Windows را فقط به operator/service account محدود کنید؛ `/mnt/c` الزاماً با chmod محافظت نمی‌شود. secrets را با password manager تولید کنید؛ هرکدام مستقل و حداقل 32 کاراکتر. برای DB passwords از hex تصادفی استفاده کنید تا URL encoding مبهم نشود؛ role passwords و URLها دقیقاً تطبیق داشته باشند.

`NODE_ENV=production`, `MAIL_TRANSPORT=disabled` (یا `smtp` با تنظیم واقعی), `SMS_TRANSPORT=provider`؛ هیچ `EVENTOS_E2E_*` یا `EVENTOS_TEST_*` در محیط مجاز نیست. `TRUSTED_PROXY_CIDRS` خالی؛ hostname از Host معتبر حل می‌شود. `PLATFORM_BASE_DOMAIN=mediasanat.ir` namespace ساب‌دامنه‌ها است، به معنای مجاز بودن platform host به‌عنوان tenant نیست. custom domains مستقل می‌مانند.

## 3 — READ-ONLY قبل از شروع

در PowerShell متغیرهای غیرمحرمانه زیر را به مسیر واقعی تنظیم کنید:

```powershell
$release = 'C:\EventOS\releases\<commit>'
$wslRelease = '/mnt/c/EventOS/releases/<commit>'
$profile = "$release\deployment\windows-iis"
& "$profile\powershell\preflight.ps1" -WslReleasePath $wslRelease -WindowsEnvFile "$profile\.env.production"
```

preflight نصب/شروع/تغییر انجام نمی‌دهد. اگر fail شد رفع پیش‌نیاز در کار جداگانه؛ پورت را خودکار تغییر ندهید. اگر EventOS همین حالا در حال اجرا است، preflight آزاد بودن 18280 عمداً fail می‌شود؛ برای مشاهده از status استفاده کنید، سرویس را برای این check متوقف نکنید.

## 4 — ترتیب شروع اولیه / SAFE CHANGE، فقط پس از مجوز استقرار

دستورهای زیر **در C1 اجرا نشوند**. تمام فراخوانی‌ها root داخل Ubuntu هستند؛ docker.sock/group/TCP API دستکاری نشود. `--project-name` و مسیرهای کامل را حذف نکنید.

```powershell
$compose = @('docker','compose','--project-name','eventos-production','--env-file',"$wslRelease/deployment/windows-iis/.env.production",'-f',"$wslRelease/deployment/windows-iis/compose.production.yaml")
wsl -d Ubuntu -u root -- @compose pull app worker postgres
if ($LASTEXITCODE -ne 0) { throw 'Image pull failed; stop.' }
# preflight دوباره بلافاصله قبل از start؛ اگر 18280 occupied است توقف.
& "$profile\powershell\preflight.ps1" -WslReleasePath $wslRelease -WindowsEnvFile "$profile\.env.production"
wsl -d Ubuntu -u root -- @compose up -d --no-build postgres
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL start failed; stop.' }
# Before continuing, status.ps1 must show postgres healthy.
# control first, then tenant; each command must exit 0 before next command.
wsl -d Ubuntu -u root -- @compose run --rm --no-deps app node --conditions=react-server --import=tsx scripts/db-migrate.ts
if ($LASTEXITCODE -ne 0) { throw 'Control migrations failed; stop.' }
wsl -d Ubuntu -u root -- @compose run --rm --no-deps app node --conditions=react-server --import=tsx scripts/migrate-tenant-databases.ts
if ($LASTEXITCODE -ne 0) { throw 'Tenant migrations failed; stop.' }
```

Postgres init روی volume جدید role separation موجود را ایجاد می‌کند؛ روی volume موجود دوباره اجرا نمی‌شود. منتظر healthy شدن postgres با `status.ps1` باشید. migrations هنگام app startup اجرا نمی‌شوند؛ forward-only، هیچ reset/drop/auto repair ندارند. در صورت خطا ادامه ندهید.

## 5 — Super Admin اولیه / SAFE CHANGE، stdin فقط

اسکریپت existing فقط وقتی هیچ admin وجود ندارد کار می‌کند. رمز 24–128 کاراکتر مستقل، هرگز command argument/env/git/log/transcript نشود. نمونه PowerShell برای اجرای آینده (از Start-Transcript استفاده نکنید؛ history فقط دستورات دارد، نه مقدار Read-Host):

```powershell
$adminEmail = Read-Host 'Admin email'
$adminSecret = Read-Host 'Admin password (24-128 characters)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret)
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $adminPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    "$adminEmail`n$adminPlain" | wsl -d Ubuntu -u root -- @compose run --rm -T --no-deps app node --conditions=react-server --import=tsx scripts/bootstrap-production-admin.ts
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap failed; do not repeat with another identity.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $adminPlain = $null; $adminSecret.Dispose(); $adminSecret = $null
    $OutputEncoding = $previousEncoding
}
```

stdin رمز را transient در حافظه قرار می‌دهد؛ در output چاپ نکنید. بعد از bootstrap موفق:

```powershell
wsl -d Ubuntu -u root -- @compose up -d --no-build --pull never app worker
if ($LASTEXITCODE -ne 0) { throw 'EventOS start failed; stop.' }
& "$profile\powershell\status.ps1" -WslReleasePath $wslRelease
& "$profile\powershell\smoke.ps1"
# tenant فقط پس از provisioning و verify واقعی domain:
& "$profile\powershell\smoke.ps1" -HostName 'event.customer-a.ir'
```

smoke read-only از Windows loopback و Host دقیق استفاده می‌کند. production cookies نیازمند HTTPS هستند؛ loopback smoke آزمون login/session نیست. سپس در کار استقرار مجاز، IIS site/TLS اختصاصی و HTTPS smoke موجود استفاده شود. ابزار Linux smoke/preflight فعلی فرض Caddy/subdomain دارد؛ برای customer domain مستقل آن را بدون بررسی اجرا نکنید.

## 6 — Backup / SAFE CHANGE، بدون overwrite

یک directory خصوصی مستقل مانند `C:\EventOS\backups` با ACL محدود از قبل آماده کنید. هیچ فایل موجود overwrite نمی‌شود؛ timestamp+UUID directory و dump control + تمام tenant DBهای registry همان EventOS + checksum ساخته می‌شود. علاوه بر postgres همین project، در حالت local فقط mount دقیق `eventos-production_media` از app همین EventOS آرشیو می‌شود؛ PricePilot و ServerOps دست‌نخورده‌اند. `media.tar.gz` با checksum و اندازه گزارش می‌شود؛ خطای آرشیو رسانه، کل backup را ناموفق می‌کند.

```powershell
& "$profile\powershell\backup.ps1" -WslReleasePath $wslRelease -WindowsBackupDirectory 'C:\EventOS\backups' # plan only
& "$profile\powershell\backup.ps1" -WslReleasePath $wslRelease -WindowsBackupDirectory 'C:\EventOS\backups' -Apply # confirmation
```

pg_dump هر DB snapshot سازگار دارد؛ snapshot اتمیک چند DB نیست. قبل از update با مجوز جداگانه writes و queue فقط EventOS را quiesce کنید؛ هیچ توقف workload دیگر یا WSL shutdown انجام نشود. restore rehearsal در محیط جدا لازم است؛ archive listing فقط صحت ساختار است. secrets/role configuration را جداگانه در vault نگه دارید، برای s3، object storage را جدا backup/version کنید. برای local، آرشیو رسانه و dumpهای همان backup را با هم در محیط مستقل بازیابی و صحت مجوزها را بررسی کنید؛ اسکریپت restore خودکار وجود ندارد. فایل ناقص خطای backup باقی می‌ماند و success اعلام نمی‌شود.

## 7 — Update و rollback

توسعه محلی → GitHub green → build/publish immutable image → backup → stage release مستقل → explicit control سپس tenant migrations → recreate **فقط app/worker EventOS** → health و smoke → پذیرش ترافیک. با تک پورت ثابت، blue/green بدون downtime ارائه نمی‌شود؛ traffic drain/maintenance فقط سایت EventOS در کار اجرای مجاز لازم است. پیش از اجرای آینده آماده‌سازی image:

```powershell
& "$profile\powershell\prepare-release.ps1" -WslReleasePath $wslRelease -Image 'registry/path/eventos@sha256:<64 hex>' # plan
# -Apply فقط pull می‌کند؛ هیچ کانتینری start نمی‌شود.
```

rollback تنها image برنامه است؛ image قدیمی باید با schema forward-migrated فعلی سازگار باشد. `rollback.ps1 -Image <digest> -SchemaCompatibilityConfirmed -Apply` با confirmation فقط app/worker را با `--no-deps --no-build --pull never` recreate می‌کند؛ postgres/volumes/networks را تغییر نمی‌دهد. env خصوصی را بعداً با digest مصوب هماهنگ کنید و status/smoke بگیرید. دیتابیس خودکار restore/drop نمی‌شود؛ rollback SQL ادعا نمی‌شود. imageهای قبلی را نگه دارید؛ حذف cache سراسری ممنوع.

## DESTRUCTIVE / DO NOT RUN

`docker compose down` (حتی بدون `-v`)، `docker compose down -v`، `docker system prune`، `wsl --shutdown`، `chmod 666 docker.sock`، Docker TCP listener، `git pull` داخل live app، تغییر IIS bindingهای موجود یا rebuild/stop پروژه‌های دیگر. هیچ یک در scripts این بسته اجرا نمی‌شود.

## اعتبارسنجی C1

فقط syntax/static checks، env validator با داده مصنوعی non-production، Compose config، template XML و diff check. هیچ کانتینر production، IIS تغییر، remote command یا application full suite در C1 اجرا نشود. server prerequisites تا زمان اجرای read-only preflight روی سرور واقعی تایید نشده‌اند.

فرمان محلی artifact gate: `node --test deployment/windows-iis/validate.test.mjs`؛ 10/10 passed (C1.1). این تست Docker Compose را فقط به صورت client-side config اجرا می‌کند و WSL را برای تست guard PowerShell mock می‌کند. PowerShell 5.1 guard tests در process محلی با policy موقت همان process اجرا شده‌اند؛ هیچ policy persistent یا server تغییر نکرده است. هر هفت فایل PowerShell syntax صحیح، bash `-n` صحیح، XML template صحیح و lint فقط دو فایل JavaScript جدید صحیح بودند. PSScriptAnalyzer در محیط موجود نبود و نصب نشد. full application suites دوباره اجرا نشدند.


## C1.3 — local media lifecycle and future S3 migration

The app image creates `/app/data/media` owned by `node`, mode 0700, before the Docker named volume is initialized. Media objects are mode 0600, never executable. Do not bind-mount a public directory, mount the volume into another workload, or grant another principal write access. Recreating the app keeps `eventos-production_media`; never delete this volume during release/rollback. The archive is not a live multi-database/filesystem snapshot: quiesce only EventOS writes before an authorized backup. Backups are private, new directories, and must be encrypted offline. A failed partial backup must not be treated as success.

Host **C: physical free space** is authoritative. WSL's apparent 951 GB virtual capacity is not physical free capacity. Preflight warns below **20 GiB** and stops below **10 GiB**. Monitor host storage; there is no automatic deletion/cleanup. Runtime filesystem errors fail uploads instead of claiming success.

Future migration (not executed by this package): configure real external S3 variables in the private env file, while leaving `MEDIA_STORAGE_DRIVER=local`. Run the utility in the existing app container with the same private volume/config:

```bash
# Read-only dry-run by default: validates the local tree/signatures; no remote network or writes.
docker compose --project-name eventos-production --env-file deployment/windows-iis/.env.production -f deployment/windows-iis/compose.production.yaml exec -T app node --conditions=react-server --import=tsx scripts/migrate-local-media-to-s3.ts
# Explicit upload, only after review. Local files and database object keys are preserved.
docker compose --project-name eventos-production --env-file deployment/windows-iis/.env.production -f deployment/windows-iis/compose.production.yaml exec -T app node --conditions=react-server --import=tsx scripts/migrate-local-media-to-s3.ts --apply
```

The validated tree includes current tenant media and certificate objects. Content types are derived from accepted file signatures. Apply compares full size and SHA-256 with existing remote objects, uses conditional `If-None-Match: *` to avoid overwrite races, and re-reads newly uploaded objects to verify size/checksum. A mismatched existing object is counted as a conflict and gives a nonzero exit; verification/network failures also give a nonzero exit. Local files are never removed. Reruns skip identical objects and resume missing ones; no secret values or object names are printed, only summary counts. Providers must support conditional writes and AES256 server-side encryption; unsupported behavior fails closed.

Quiesce writes for the final migration/verification pass. Only after zero conflicts and successful verification should the operator explicitly change `MEDIA_STORAGE_DRIVER=s3`, run preflight, and recreate EventOS app/worker in a separately authorized deployment. Verify authorized media/certificate reads before accepting traffic. Do not remove local copies until a separately approved retention/restore plan exists. No automatic driver switch or database rewrite is performed.

Artifact-only backup validation: `bash deployment/windows-iis/backup.test.sh` uses a temporary directory and a mocked Docker executable; it does not deploy or access real Docker volumes.
