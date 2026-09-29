import Link from "next/link";
import { RegistrationFormEditor } from "@/app/_components/registration-form-editor";
import { getRunRegistrationForm } from "@/modules/enrollment/form-repository";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function RegistrationFormPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { tenant, actor } = await requireTenantPage("program.update");
  const { runId } = await params;
  const form = await getRunRegistrationForm(
    { tenant, actor, requestId: "registration-form-page" },
    runId,
  );
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ثبت‌نام</div>
          <h1 className="page-title">فرم ثبت‌نام اجرا</h1>
          <p className="page-description">
            سؤال‌های تکمیلی را بدون نیاز به تنظیمات فنی بسازید.
          </p>
        </div>
        <Link href="/runs" className="button button-secondary">
          بازگشت به اجراها
        </Link>
      </div>
      <RegistrationFormEditor runId={runId} initial={form} />
    </main>
  );
}
