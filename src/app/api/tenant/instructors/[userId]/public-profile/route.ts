import {
  getAdminInstructorProfile,
  instructorProfileInput,
  saveInstructorProfile,
} from "@/modules/public-site/instructors";
import { parseJson, withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ userId: string }> };

export function GET(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor) =>
      getAdminInstructorProfile(tenant, actor, (await context.params).userId),
    "instructor.update",
  );
}

export function PUT(request: Request, context: Context): Promise<Response> {
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      saveInstructorProfile(
        tenant,
        actor,
        (await context.params).userId,
        await parseJson(request, instructorProfileInput),
        requestId,
      ),
    "instructor.update",
    { mutation: true },
  );
}
