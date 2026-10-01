import { z } from "zod";

export const resourceId = z.uuid();
export const programTypes = [
  "COURSE",
  "WORKSHOP",
  "SEMINAR",
  "WEBINAR",
  "CONFERENCE",
  "BOOTCAMP",
  "PRIVATE_CLASS",
  "EXAM",
  "MEETING",
  "EVENT",
] as const;
export const deliveryModes = ["IN_PERSON", "ONLINE", "HYBRID"] as const;
export const programInput = z.strictObject({
  type: z.enum(programTypes),
  title: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  shortDescription: z.string().trim().max(500).default(""),
  description: z.string().trim().max(10000).default(""),
  category: z.string().trim().max(120).default(""),
  level: z.string().trim().max(80).default(""),
  objectives: z.string().trim().max(5000).default(""),
  prerequisites: z.string().trim().max(5000).default(""),
  intendedAudience: z.string().trim().max(5000).default(""),
  defaultDurationMinutes: z
    .number()
    .int()
    .positive()
    .max(525600)
    .nullable()
    .default(null),
});
export type ProgramInput = z.infer<typeof programInput>;

export const venueInput = z.strictObject({
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().max(500).default(""),
  city: z.string().trim().max(120).default(""),
  description: z.string().trim().max(1000).default(""),
  active: z.boolean().default(true),
});
export const roomInput = z.strictObject({
  venueId: resourceId,
  name: z.string().trim().min(1).max(160),
  capacity: z.number().int().positive().max(100000),
  description: z.string().trim().max(1000).default(""),
  active: z.boolean().default(true),
});

const isoInstant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));
export const runInput = z
  .strictObject({
    programId: resourceId,
    title: z.string().trim().min(2).max(200),
    startsAt: isoInstant,
    endsAt: isoInstant,
    registrationStartsAt: isoInstant.nullable().default(null),
    registrationEndsAt: isoInstant.nullable().default(null),
    deliveryMode: z.enum(deliveryModes),
    capacity: z.number().int().positive().max(100000),
    priceAmount: z.number().int().min(0).max(1_000_000_000_000).default(0),
    priceCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("IRR"),
    minimumCapacity: z
      .number()
      .int()
      .positive()
      .max(100000)
      .nullable()
      .default(null),
    waitlistEnabled: z.boolean().default(false),
    venueId: resourceId.nullable().default(null),
    instructorIds: z
      .array(resourceId.or(z.string().min(1).max(64)))
      .max(20)
      .default([]),
    notes: z.string().trim().max(5000).default(""),
  })
  .refine((value) => value.startsAt < value.endsAt, {
    message: "INVALID_RUN_TIME",
    path: ["endsAt"],
  })
  .refine(
    (value) =>
      value.minimumCapacity === null || value.minimumCapacity <= value.capacity,
    { message: "INVALID_CAPACITY", path: ["minimumCapacity"] },
  )
  .refine(
    (value) =>
      value.registrationStartsAt === null ||
      value.registrationEndsAt === null ||
      value.registrationStartsAt < value.registrationEndsAt,
    { message: "INVALID_REGISTRATION_TIME", path: ["registrationEndsAt"] },
  );
export type RunInput = z.infer<typeof runInput>;

export const sessionInput = z
  .strictObject({
    runId: resourceId,
    title: z.string().trim().min(2).max(200),
    startsAt: isoInstant,
    endsAt: isoInstant,
    timezone: z.string().min(1).max(80),
    deliveryMode: z.enum(deliveryModes),
    venueId: resourceId.nullable().default(null),
    roomId: resourceId.nullable().default(null),
    instructorIds: z.array(z.string().min(1).max(64)).max(20).default([]),
    notes: z.string().trim().max(5000).default(""),
  })
  .refine((value) => value.startsAt < value.endsAt, {
    message: "INVALID_SESSION_TIME",
    path: ["endsAt"],
  });
export type SessionInput = z.infer<typeof sessionInput>;
