import { z } from "zod";

export const attendanceStatus = z.enum([
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
]);

export const attendanceMarkInput = z.strictObject({
  records: z
    .array(
      z.strictObject({
        participantId: z.string().min(1).max(64),
        status: attendanceStatus,
        notes: z.string().trim().max(500).nullable().default(null),
      }),
    )
    .min(1)
    .max(200),
});

export const attendanceCheckInInput = z.strictObject({
  token: z.string().min(40).max(1024),
});

export type AttendanceMarkInput = z.infer<typeof attendanceMarkInput>;
export type AttendanceStatus = z.infer<typeof attendanceStatus>;

export function attendancePercentage(attended: number, total: number) {
  return total === 0 ? 0 : Math.round((attended / total) * 100);
}
