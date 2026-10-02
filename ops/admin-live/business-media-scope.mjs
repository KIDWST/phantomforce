// This gateway's CLI/Hermes credentials belong to PhantomForce only.
// Other businesses must use their own authenticated provider connection.
export function ownerMediaScope(headers = {}, payload = {}) {
  const selected = headers["x-phantomforce-business"] || payload.tenant_id || "phantomforce";
  if (!["phantomforce", "phantomforce-owner", "phantomforce-internal"].includes(selected)
    || (payload.tenant_id && payload.tenant_id !== selected)) {
    throw Object.assign(new Error("Connect a media provider dedicated to this business."), { code: "business_media_connection_required", statusCode: 409 });
  }
  return selected;
}

export function canReadMediaJob(job, tenantId, sessionId) {
  return Boolean(job && job.tenantId === tenantId && job.sessionId === sessionId);
}
