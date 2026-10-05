import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultProfileFields,
  loginMethodsSchema,
  normalizeIranianPhone,
  normalizeUsername,
  profileFieldsSchema,
  validateProfileValues,
} from "@/modules/tenant-identity/identity-v2-schema";
import { createKavenegarProvider } from "@/modules/sms/kavenegar";
import { SmsDeliveryError } from "@/modules/sms/provider";
import { SmsProviderRegistry } from "@/modules/sms/registry";
import {
  clearTestSms,
  readTestSms,
  testSmsProvider,
} from "@/modules/sms/test-provider";
describe("Identity V2 boundaries", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["09121234567", "9121234567", "+989121234567", "۰۹۱۲۱۲۳۴۵۶۷"])(
    "canonicalizes %s",
    (input) => expect(normalizeIranianPhone(input)).toBe("+989121234567"),
  );
  it.each(["+19999999999", "0912123", "091212345670", "x09121234567"])(
    "rejects invalid phone %s",
    (input) => expect(() => normalizeIranianPhone(input)).toThrow(),
  );
  it("normalizes safe usernames and rejects reserved identifiers", () => {
    expect(normalizeUsername(" Test_User ")).toBe("test_user");
    for (const value of [
      "ADMIN",
      "root",
      "system",
      "support",
      "a",
      "has space",
      "a<script>",
    ])
      expect(() => normalizeUsername(value)).toThrow();
  });
  it("protects required identity fields and caps definitions", () => {
    expect(profileFieldsSchema.parse(defaultProfileFields)).toHaveLength(11);
    expect(() =>
      profileFieldsSchema.parse(
        defaultProfileFields.filter((field) => field.key !== "mobile"),
      ),
    ).toThrow();
    expect(() =>
      profileFieldsSchema.parse(
        Array.from({ length: 41 }, (_, i) => ({
          ...defaultProfileFields[0]!,
          key: `field_${i}`,
        })),
      ),
    ).toThrow();
  });
  it("validates current field requirements, types, and private editing rules", () => {
    const fields = [
      ...defaultProfileFields,
      {
        ...defaultProfileFields[0]!,
        key: "occupation",
        label: "شغل",
        order: 12,
      },
    ].filter(
      (field, index, array) =>
        array.findIndex((entry) => entry.key === field.key) === index,
    );
    const occupation = fields.find((field) => field.key === "occupation");
    if (occupation) {
      occupation.enabled = true;
      occupation.required = true;
    }
    expect(() =>
      validateProfileValues(
        fields,
        { first_name: "A", last_name: "B", mobile: "09121234567" },
        "signup",
      ),
    ).toThrow();
    expect(() =>
      validateProfileValues(
        defaultProfileFields,
        { mobile: "09121234567" },
        "profile",
      ),
    ).toThrow();
    expect(() =>
      validateProfileValues(defaultProfileFields, { unknown: "x" }, "signup"),
    ).toThrow();
  });
  it("rejects disabling every login method", () =>
    expect(() =>
      loginMethodsSchema.parse({
        sms_otp: false,
        username_password: false,
        email_password: false,
        email_otp: false,
        google: false,
      }),
    ).toThrow());
  it("maps Kavenegar VerifyLookup requests without authorization in body", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ return: { status: 200 } })),
      );
    await createKavenegarProvider(fetcher).sendOtp({
      config: { apiKey: "a".repeat(32), otpTemplate: "verify" },
      phone: "+989121234567",
      code: "123456",
      tenantId: "a",
      requestId: "id",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(
      `https://api.kavenegar.com/v1/${"a".repeat(32)}/verify/lookup.json`,
    );
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe(
      "receptor=09121234567&token=123456&template=verify&type=sms",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([401, 429, 500])(
    "normalizes provider HTTP %s safely",
    async (status) => {
      const provider = createKavenegarProvider(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("secret provider response", { status }),
          ),
      );
      await expect(
        provider.sendOtp({
          config: { apiKey: "a".repeat(32), otpTemplate: "verify" },
          phone: "+989121234567",
          code: "123456",
          tenantId: "a",
          requestId: "id",
        }),
      ).rejects.toBeInstanceOf(SmsDeliveryError);
    },
  );
  it("validates all custom field types and permits an unset optional number", () => {
    const base = defaultProfileFields[0];
    if (!base) throw new Error("Missing default field");
    const types = [
      "TEXT",
      "TEXTAREA",
      "NUMBER",
      "SELECT",
      "MULTI_SELECT",
      "CHECKBOX",
      "DATE",
    ] as const;
    const fields = types.map((type, order) => ({
      ...base,
      key: `custom_${order}`,
      type,
      order,
      required: false,
      options:
        type === "SELECT" || type === "MULTI_SELECT" ? ["one", "two"] : [],
    }));
    const values = {
      custom_0: "text",
      custom_1: "long text",
      custom_2: 12,
      custom_3: "one",
      custom_4: ["two"],
      custom_5: false,
      custom_6: "2026-10-05",
    };
    expect(validateProfileValues(fields, values, "profile")).toEqual(values);
    expect(validateProfileValues(fields, { custom_2: "" }, "profile")).toEqual({
      custom_2: "",
    });
    for (const invalid of [
      { custom_2: Infinity },
      { custom_3: "unknown" },
      { custom_4: ["unknown"] },
      { custom_5: "true" },
      { custom_6: "2026-02-30" },
      { custom_0: "x".repeat(501) },
    ])
      expect(() => validateProfileValues(fields, invalid, "profile")).toThrow();
  });
  it("normalizes transport exceptions without leaking URL", async () => {
    const provider = createKavenegarProvider(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("secret-url")),
    );
    await expect(
      provider.sendOtp({
        config: { apiKey: "a".repeat(32), otpTemplate: "verify" },
        phone: "+989121234567",
        code: "123456",
        tenantId: "a",
        requestId: "id",
      }),
    ).rejects.toThrow("ارسال کد با مشکل مواجه شد");
  });
  it("captures test delivery by tenant and rejects production", async () => {
    vi.stubEnv("SMS_TRANSPORT", "test");
    clearTestSms();
    await testSmsProvider.sendOtp({
      config: {},
      phone: "+989121234567",
      code: "123456",
      tenantId: "a",
      requestId: "id",
    });
    expect(readTestSms("b", "+989121234567")).toBeUndefined();
    expect(readTestSms("a", "+989121234567")?.code).toBe("123456");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => readTestSms("a", "+989121234567")).toThrow();
    await expect(
      testSmsProvider.sendOtp({
        config: {},
        phone: "+989121234567",
        code: "123456",
        tenantId: "a",
        requestId: "id",
      }),
    ).rejects.toThrow();
  });
  it("registry requires explicit adapters and prevents duplicates", () => {
    const adapter = createKavenegarProvider();
    const registry = new SmsProviderRegistry([adapter]);
    expect(registry.resolve("KAVENEGAR").capabilities.supportsOtpTemplate).toBe(
      true,
    );
    expect(() => registry.resolve("OTHER_PROVIDER")).toThrow();
    expect(() => new SmsProviderRegistry([adapter, adapter])).toThrow();
  });
});
