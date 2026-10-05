"use client";
import type { ProfileField } from "@/modules/tenant-identity/identity-v2-schema";
export type ProfileValues = Record<
  string,
  string | number | boolean | string[]
>;
export function IdentityProfileFields({
  fields,
  values,
  onChange,
  mode,
}: {
  fields: ProfileField[];
  values: ProfileValues;
  onChange: (values: ProfileValues) => void;
  mode: "signup" | "profile";
}) {
  return (
    <div className="form-grid">
      {fields
        .filter(
          (field) =>
            field.enabled &&
            field.key !== "mobile" &&
            (mode === "signup" ? field.showDuringSignup : field.showInProfile),
        )
        .sort((a, b) => a.order - b.order)
        .map((field) => {
          const value = values[field.key];
          const id = `profile-${field.key}`;
          const disabled = mode === "profile" && !field.userEditable;
          const change = (value: string | number | boolean | string[]) =>
            onChange({ ...values, [field.key]: value });
          return (
            <div className="field" key={field.key}>
              <label htmlFor={id}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
              {field.type === "TEXTAREA" ? (
                <textarea
                  id={id}
                  value={String(value ?? "")}
                  maxLength={2000}
                  disabled={disabled}
                  required={field.required}
                  placeholder={field.placeholder}
                  onChange={(event) => change(event.target.value)}
                />
              ) : field.type === "SELECT" || field.type === "MULTI_SELECT" ? (
                <select
                  id={id}
                  multiple={field.type === "MULTI_SELECT"}
                  value={
                    field.type === "MULTI_SELECT"
                      ? Array.isArray(value)
                        ? value
                        : []
                      : String(value ?? "")
                  }
                  disabled={disabled}
                  required={field.required}
                  onChange={(event) =>
                    change(
                      field.type === "MULTI_SELECT"
                        ? Array.from(
                            event.target.selectedOptions,
                            (option) => option.value,
                          )
                        : event.target.value,
                    )
                  }
                >
                  {field.type === "SELECT" && (
                    <option value="">انتخاب کنید</option>
                  )}
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "CHECKBOX" ? (
                <input
                  id={id}
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  required={field.required}
                  onChange={(event) => change(event.target.checked)}
                />
              ) : (
                <input
                  id={id}
                  type={
                    field.type === "NUMBER"
                      ? "number"
                      : field.type === "DATE"
                        ? "date"
                        : "text"
                  }
                  value={
                    typeof value === "number" || typeof value === "string"
                      ? value
                      : ""
                  }
                  maxLength={500}
                  disabled={disabled}
                  required={field.required}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    change(
                      field.type === "NUMBER"
                        ? event.target.valueAsNumber
                        : event.target.value,
                    )
                  }
                />
              )}{" "}
              {field.helperText && <small>{field.helperText}</small>}
            </div>
          );
        })}
    </div>
  );
}
