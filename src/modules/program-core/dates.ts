const wallPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function wallParts(
  instant: Date,
  timezone: string,
): [number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return [
    value("year"),
    value("month"),
    value("day"),
    value("hour"),
    value("minute"),
  ];
}

export function tenantWallTimeToUtc(value: string, timezone: string): string {
  const match = wallPattern.exec(value);
  if (!match) throw new Error("زمان واردشده معتبر نیست.");
  const numbers: [number, number, number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ];
  const [year, month, day, hour, minute] = numbers;
  const target = Date.UTC(year, month - 1, day, hour, minute);
  if (
    new Date(target).getUTCFullYear() !== year ||
    new Date(target).getUTCMonth() !== month - 1 ||
    new Date(target).getUTCDate() !== day
  ) {
    throw new Error("تاریخ واردشده معتبر نیست.");
  }
  const candidates = new Set<number>();
  for (const sample of [target - 86_400_000, target, target + 86_400_000]) {
    const offsetParts = wallParts(new Date(sample), timezone);
    const wallEpoch = Date.UTC(
      offsetParts[0],
      offsetParts[1] - 1,
      offsetParts[2],
      offsetParts[3],
      offsetParts[4],
    );
    const candidate = target - (wallEpoch - sample);
    if (
      wallParts(new Date(candidate), timezone).every(
        (part, index) => part === numbers[index],
      )
    ) {
      candidates.add(candidate);
    }
  }
  if (candidates.size !== 1)
    throw new Error("این زمان در منطقه زمانی سازمان نامعتبر یا مبهم است.");
  const candidate = candidates.values().next().value;
  if (candidate === undefined) throw new Error("زمان واردشده معتبر نیست.");
  return new Date(candidate).toISOString();
}

export function formatTenantDate(
  value: string | Date,
  timezone: string,
): string {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatTenantWallInput(
  value: string | Date,
  timezone: string,
): string {
  const [year, month, day, hour, minute] = wallParts(new Date(value), timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const persianCalendar = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
export const persianMonths = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

export function gregorianWallToJalali(value: string): {
  year: number;
  month: number;
  day: number;
  time: string;
} {
  const match = wallPattern.exec(value);
  if (!match) throw new Error("تاریخ و ساعت معتبر نیست.");
  const instant = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`);
  if (Number.isNaN(instant.getTime())) throw new Error("تاریخ معتبر نیست.");
  const parts = persianCalendar.formatToParts(instant);
  const number = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    time: `${match[4]}:${match[5]}`,
  };
}

export function jalaliWallToGregorian(
  year: number,
  month: number,
  day: number,
  time: string,
): string {
  if (
    !Number.isInteger(year) ||
    year < 1200 ||
    year > 1600 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 31 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error("تاریخ و ساعت معتبر نیست.");
  for (let offset = 0; offset < 370; offset++) {
    const candidate = new Date(Date.UTC(year + 621, 2, 1 + offset, 12));
    const parts = persianCalendar.formatToParts(candidate);
    const number = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    if (
      number("year") === year &&
      number("month") === month &&
      number("day") === day
    )
      return `${candidate.toISOString().slice(0, 10)}T${time}`;
  }
  throw new Error("این روز در تقویم خورشیدی وجود ندارد.");
}
