import { CertificateManager } from "@/app/_components/certificate-manager";
import {
  listCertificates,
  listIssueCandidates,
  listTemplates,
} from "@/modules/certificates/repository";
import { requireTenantPage } from "@/modules/tenant-identity/page-auth";

export default async function CertificatesPage() {
  const { tenant, actor } = await requireTenantPage("certificate.read");
  const scope = { tenant, actor, requestId: "certificates-page" };
  const canManageTemplates = actor.permissions.has(
    "certificate.template.manage",
  );
  const canIssue = actor.permissions.has("certificate.issue");
  const [certificates, templates, candidates] = await Promise.all([
    listCertificates(scope),
    canManageTemplates || canIssue ? listTemplates(scope) : Promise.resolve([]),
    canIssue ? listIssueCandidates(scope) : Promise.resolve([]),
  ]);
  return (
    <CertificateManager
      certificates={certificates}
      templates={templates}
      candidates={candidates}
      canManageTemplates={canManageTemplates}
      canIssue={canIssue}
      canRevoke={actor.permissions.has("certificate.revoke")}
    />
  );
}
