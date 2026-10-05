"use client";

import { useState } from "react";
import type { InstructorContent } from "@/modules/public-site/instructors";
import { AdminButton, AdminDialog, StatusBadge } from "./admin-ui";
import { InstructorPublicEditor } from "./instructor-public-editor";

type Profile = {
  id: string;
  slug: string;
  published: boolean;
  content: InstructorContent;
};
export function InstructorProfileWorkspace({
  userId,
  initial,
}: {
  userId: string;
  initial: Profile;
}) {
  const [profile, setProfile] = useState(initial);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <>
      <section className="card card-pad admin-profile-summary">
        <div>
          <span className="eyebrow">وضعیت پروفایل عمومی</span>
          <h2 className="card-title">{profile.content.name}</h2>
          <p>{profile.content.title || "عنوان حرفه‌ای هنوز ثبت نشده است."}</p>
          <StatusBadge status={profile.published ? "PUBLISHED" : "DRAFT"} />
        </div>
        <div className="admin-row-actions">
          <AdminButton
            type="button"
            tone="info"
            icon="edit"
            onClick={() => {
              setNotice("");
              setOpen(true);
            }}
          >
            ویرایش پروفایل
          </AdminButton>
          {profile.published && (
            <a
              className="admin-action admin-action-neutral"
              href={`/instructors/${profile.slug}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              مشاهده صفحه عمومی
            </a>
          )}
        </div>
      </section>
      {notice && (
        <p role="status" className="alert alert-success">
          {notice}
        </p>
      )}
      <AdminDialog
        open={open}
        wide
        title="ویرایش پروفایل مدرس"
        description="اطلاعات منتشرشده در صفحه عمومی مدرس را مدیریت کنید."
        onClose={() => setOpen(false)}
      >
        {open && (
          <InstructorPublicEditor
            userId={userId}
            initial={profile}
            onSaved={(saved) => {
              setProfile(saved);
              setOpen(false);
              setNotice("تغییرات با موفقیت ذخیره شد.");
            }}
          />
        )}
      </AdminDialog>
    </>
  );
}
