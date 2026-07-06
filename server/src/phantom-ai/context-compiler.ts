import type { ContextCompilerInput, HermesContextPacket } from "./types.js";
import { redactSensitiveText } from "./hermes-ledger.js";

const DEFAULT_MAX_CONTEXT_CHARS = 2800;

export function estimateTokensFromChars(chars: number) {
  return Math.ceil(chars / 4);
}

function summarizeRequest(request: string) {
  const compact = redactSensitiveText(request.replace(/\s+/g, " ").trim());
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function trimToMaxChars(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 32)).trimEnd()}\n[context trimmed]`;
}

export function compileHermesContext(input: ContextCompilerInput): HermesContextPacket {
  const maxChars = input.max_chars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const userRequestSummary = summarizeRequest(input.user_request);
  const moduleLines = input.module_data.flatMap((module) => {
    const items = module.items?.slice(0, 5).map((item) => {
      const status = item.status ? ` (${redactSensitiveText(item.status)})` : "";
      const detail = item.detail ? ` - ${redactSensitiveText(item.detail)}` : "";
      return `  - ${redactSensitiveText(item.title)}${status}${detail}`;
    });

    return [`- ${redactSensitiveText(module.module)}: ${redactSensitiveText(module.summary)}`, ...(items ?? [])];
  });

  const ruleLines = input.relevant_rules.map((rule) => `- ${redactSensitiveText(rule)}`);
  const approvalLines = input.approval_restrictions.map((restriction) => `- ${redactSensitiveText(restriction)}`);
  const rawContext = JSON.stringify({
    business_summary: input.business_summary,
    module_data: input.module_data,
    relevant_rules: input.relevant_rules,
    approval_restrictions: input.approval_restrictions,
    user_request: input.user_request,
  });

  const compactContext = trimToMaxChars(
    [
      `Business: ${input.business_name}`,
      `Tenant: ${input.tenant_id}`,
      `Task: ${input.task_type}`,
      `Sensitivity: ${input.sensitivity_level}`,
      `Route: ${input.provider_route}`,
      `Request: ${userRequestSummary}`,
      "",
      "Business summary:",
      redactSensitiveText(input.business_summary),
      "",
      "Relevant module data:",
      ...moduleLines,
      "",
      "Rules:",
      ...ruleLines,
      "",
      "Approval restrictions:",
      ...approvalLines,
    ].join("\n"),
    maxChars,
  );
  const redactedCompactContext = redactSensitiveText(compactContext);

  return {
    tenant_id: redactSensitiveText(input.tenant_id),
    business_name: redactSensitiveText(input.business_name),
    request_id: redactSensitiveText(input.request_id),
    task_type: redactSensitiveText(input.task_type),
    sensitivity_level: input.sensitivity_level,
    provider_route: input.provider_route,
    user_request_summary: userRequestSummary,
    compact_context: redactedCompactContext,
    context_chars: redactedCompactContext.length,
    estimated_tokens: estimateTokensFromChars(redactedCompactContext.length),
    raw_context_chars: rawContext.length,
    compression_ratio: rawContext.length ? Number((redactedCompactContext.length / rawContext.length).toFixed(3)) : 1,
  };
}
