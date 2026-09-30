"use client";

import { useState } from "react";
import {
  gregorianWallToJalali,
  jalaliWallToGregorian,
  persianMonths,
} from "@/modules/program-core/dates";

export function JalaliDateTimeInput({
  name,
  defaultValue,
  required = false,
}: {
  name: string;
  defaultValue?: string | undefined;
  required?: boolean;
}) {
  const now = gregorianWallToJalali(
    `${new Date().toISOString().slice(0, 10)}T12:00`,
  );
  const initial = defaultValue
    ? gregorianWallToJalali(defaultValue)
    : { year: now.year, month: now.month, day: now.day, time: "09:00" };
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const [time, setTime] = useState(initial.time);
  const [selected, setSelected] = useState(Boolean(defaultValue));
  let canonical = "";
  try {
    if (selected) canonical = jalaliWallToGregorian(year, month, day, time);
  } catch {
    /* invalid day remains visibly invalid until corrected */
  }
  return (
    <div className="jalali-picker" dir="rtl">
      <select
        aria-label="سال خورشیدی"
        value={year}
        onChange={(event) => {
          setYear(Number(event.target.value));
          setSelected(true);
        }}
      >
        {Array.from({ length: 12 }, (_, offset) => now.year - 2 + offset).map(
          (option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ),
        )}
      </select>
      <select
        aria-label="ماه خورشیدی"
        value={month}
        onChange={(event) => {
          setMonth(Number(event.target.value));
          setSelected(true);
        }}
      >
        {persianMonths.map((label, index) => (
          <option key={label} value={index + 1}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="روز خورشیدی"
        value={day}
        onChange={(event) => {
          setDay(Number(event.target.value));
          setSelected(true);
        }}
      >
        {Array.from({ length: 31 }, (_, index) => index + 1).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <input
        aria-label="ساعت"
        type="time"
        value={time}
        onChange={(event) => {
          setTime(event.target.value);
          setSelected(true);
        }}
      />
      {!required && (
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={() => setSelected(false)}
        >
          پاک کردن
        </button>
      )}
      <input type="hidden" name={name} value={canonical} required={required} />
      {selected && !canonical && (
        <span role="alert">این روز در تقویم خورشیدی معتبر نیست.</span>
      )}
    </div>
  );
}
