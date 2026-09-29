import { z } from "zod";
import { cancelManagedEnrollment } from "@/modules/enrollment/repository";
import { withTenantRoute } from "@/shared/http/tenant-route";

export const runtime = "nodejs";
type Context = { params: Promise<{ enrollmentId: string }> };
export async function POST(
  request: Request,
  { params }: Context,
): Promise<Response> {
  const { enrollmentId } = await params;
  return withTenantRoute(
    request,
    async ({ tenant }, actor, requestId) =>
      cancelManagedEnrollment(
        { tenant, actor, requestId },
        z.uuid().parse(enrollmentId),
      ),
    "enrollment.manage",
    { feature: "registration", mutation: true },
  );
}
