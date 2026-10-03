import Link from "next/link";

export default function TenantNotFound() {
  return (
    <main className="content">
      <section className="card card-pad">
        <h1 className="page-title">سازمان پیدا نشد</h1>
        <p>این سازمان وجود ندارد یا نشانی آن قدیمی است.</p>
        <Link className="btn btn-secondary" href="/platform/tenants">
          بازگشت به سازمان‌ها
        </Link>
      </section>
    </main>
  );
}
