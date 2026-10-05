"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, errorMessage } from "./api-client";
import { AdminDialog } from "./admin-ui";

type Venue = {
  id: string;
  name: string;
  address: string;
  city: string;
  description: string;
  active: boolean;
  rooms: {
    id: string;
    name: string;
    capacity: number;
    description: string;
    active: boolean;
  }[];
};
const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
export function VenuesManager({ canManage }: { canManage: boolean }) {
  const [venues, setVenues] = useState<Venue[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showVenue, setShowVenue] = useState(false),
    [roomFor, setRoomFor] = useState("");
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [editingRoom, setEditingRoom] = useState<Venue["rooms"][number] | null>(
    null,
  );
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVenues(await apiRequest<Venue[]>("/api/tenant/venues"));
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function addVenue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest(
        editingVenue
          ? `/api/tenant/venues/${editingVenue.id}`
          : "/api/tenant/venues",
        {
          method: editingVenue ? "PUT" : "POST",
          body: {
            name: value(data, "name"),
            address: value(data, "address"),
            city: value(data, "city"),
            description: value(data, "description"),
            active: data.has("active"),
          },
        },
      );
      setShowVenue(false);
      setEditingVenue(null);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function addRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest(
        editingRoom
          ? `/api/tenant/rooms/${editingRoom.id}`
          : "/api/tenant/rooms",
        {
          method: editingRoom ? "PUT" : "POST",
          body: {
            venueId: roomFor,
            name: value(data, "name"),
            capacity: Number(value(data, "capacity")),
            description: value(data, "description"),
            active: data.has("active"),
          },
        },
      );
      setRoomFor("");
      setEditingRoom(null);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">زیرساخت آموزشی</div>
          <h1 className="page-title">مکان‌ها و کلاس‌ها</h1>
          <p className="page-description">
            ظرفیت کلاس‌ها هنگام ثبت جلسه کنترل می‌شود.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingVenue(null);
              setShowVenue(true);
            }}
          >
            مکان جدید
          </button>
        )}
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <AdminDialog
        open={showVenue}
        title={editingVenue ? "ویرایش مکان" : "مکان جدید"}
        onClose={() => !busy && setShowVenue(false)}
      >
        {showVenue && (
          <section className="card card-pad section">
            <form
              key={editingVenue?.id ?? "new"}
              className="form-grid"
              onSubmit={addVenue}
            >
              <label className="field">
                <span className="label">نام</span>
                <input
                  className="input"
                  name="name"
                  required
                  defaultValue={editingVenue?.name}
                />
              </label>
              <label className="field">
                <span className="label">شهر</span>
                <input
                  className="input"
                  name="city"
                  defaultValue={editingVenue?.city}
                />
              </label>
              <label className="field field-full">
                <span className="label">نشانی</span>
                <input
                  className="input"
                  name="address"
                  defaultValue={editingVenue?.address}
                />
              </label>
              <label className="field field-full">
                <span className="label">توضیح</span>
                <textarea
                  className="textarea"
                  name="description"
                  defaultValue={editingVenue?.description}
                />
              </label>
              <label className="field">
                <span>
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editingVenue?.active ?? true}
                  />{" "}
                  فعال
                </span>
              </label>
              <div className="form-actions field-full">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                >
                  ذخیره
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowVenue(false)}
                >
                  انصراف
                </button>
              </div>
            </form>
          </section>
        )}
      </AdminDialog>
      {loading ? (
        <p>در حال بارگذاری…</p>
      ) : venues.length === 0 ? (
        <section className="card empty">هنوز مکانی ثبت نشده است.</section>
      ) : (
        <div className="grid grid-2">
          {venues.map((venue) => (
            <section className="card card-pad" key={venue.id}>
              <div className="page-heading">
                <div>
                  <h2 className="card-title">{venue.name}</h2>
                  <p className="muted">
                    {venue.city} · {venue.address}
                  </p>
                </div>
                <span
                  className={`badge ${venue.active ? "badge-green" : "badge-gray"}`}
                >
                  {venue.active ? "فعال" : "غیرفعال"}
                </span>
              </div>
              <p className="muted">{venue.description}</p>
              {canManage && (
                <button
                  type="button"
                  className="admin-action admin-action-info"
                  onClick={() => {
                    setEditingVenue(venue);
                    setShowVenue(true);
                  }}
                >
                  ویرایش مکان
                </button>
              )}
              <h3>کلاس‌ها</h3>
              {venue.rooms.length === 0 ? (
                <p className="muted">هنوز کلاسی تعریف نشده است.</p>
              ) : (
                venue.rooms.map((room) => (
                  <div className="check-row" key={room.id}>
                    <span>{room.name}</span>
                    <span>ظرفیت {room.capacity.toLocaleString("fa-IR")}</span>
                    {canManage && (
                      <button
                        type="button"
                        className="admin-action admin-action-info"
                        onClick={() => {
                          setRoomFor(venue.id);
                          setEditingRoom(room);
                        }}
                      >
                        ویرایش
                      </button>
                    )}
                  </div>
                ))
              )}
              {canManage && (
                <button
                  type="button"
                  className="btn btn-small btn-secondary"
                  onClick={() => {
                    setRoomFor(venue.id);
                    setEditingRoom(null);
                  }}
                >
                  افزودن کلاس
                </button>
              )}
              <AdminDialog
                open={roomFor === venue.id}
                title={editingRoom ? "ویرایش کلاس" : "افزودن کلاس"}
                onClose={() => !busy && setRoomFor("")}
              >
                {roomFor === venue.id && (
                  <form
                    key={editingRoom?.id ?? "new"}
                    className="form-grid"
                    onSubmit={addRoom}
                  >
                    <label className="field">
                      <span className="label">نام کلاس</span>
                      <input
                        className="input"
                        name="name"
                        required
                        defaultValue={editingRoom?.name}
                      />
                    </label>
                    <label className="field">
                      <span className="label">ظرفیت</span>
                      <input
                        className="input"
                        name="capacity"
                        type="number"
                        min="1"
                        required
                        defaultValue={editingRoom?.capacity}
                      />
                    </label>
                    <label className="field field-full">
                      <span className="label">توضیح</span>
                      <input
                        className="input"
                        name="description"
                        defaultValue={editingRoom?.description}
                      />
                    </label>
                    <label className="field">
                      <span>
                        <input
                          type="checkbox"
                          name="active"
                          defaultChecked={editingRoom?.active ?? true}
                        />{" "}
                        فعال
                      </span>
                    </label>
                    <div className="form-actions field-full">
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={busy}
                      >
                        ذخیره کلاس
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setRoomFor("")}
                      >
                        انصراف
                      </button>
                    </div>
                  </form>
                )}
              </AdminDialog>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
