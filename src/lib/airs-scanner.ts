import {
  AISecSDKException,
  Content,
  init,
  Scanner,
  type ScanResponse,
} from "@cdot65/prisma-airs-sdk";

export interface LogInterface {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  error: (obj: unknown, msg: string) => void;
}

export interface ScanResult {
  blocked: boolean;
  blockResponse?: { error: string; message: string; category?: string; scan_id?: string };
}

// AIRS SDK initialization
const airsApiKey = process.env.PANW_AI_SEC_API_KEY || "";
const airsProfileName = process.env.PRISMA_AIRS_PROFILE_NAME || "";
export const airsEnabled = Boolean(airsApiKey && airsProfileName);

if (airsEnabled) {
  init({ apiKey: airsApiKey });
}

const scanner = airsEnabled ? new Scanner() : null;

export function buildMetadata() {
  const agentId = process.env.BEDROCK_AGENT_ID;
  const region = process.env.AWS_REGION || "us-west-2";
  const accountId = process.env.AWS_ACCOUNT_ID;

  return {
    app_name: "recipe-extraction-agent",
    app_user: "anonymous",
    ai_model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    agent_meta: agentId
      ? {
          agent_id: agentId,
          agent_version: process.env.BEDROCK_AGENT_VERSION || "1",
          agent_arn: accountId
            ? `arn:aws:bedrock:${region}:${accountId}:agent/${agentId}`
            : undefined,
        }
      : undefined,
  };
}

export function scanResultFields(scan: ScanResponse) {
  return {
    action: scan.action,
    category: scan.category,
    scanId: scan.scan_id,
    reportId: scan.report_id,
    profileId: scan.profile_id,
    profileName: scan.profile_name,
    trId: scan.tr_id,
    promptDetected: scan.prompt_detected,
    responseDetected: scan.response_detected,
  };
}

export function scanErrorFields(err: unknown) {
  if (err instanceof AISecSDKException) {
    return { err: String(err), errorType: err.errorType };
  }
  return { err: String(err) };
}

export async function preScan(
  prompt: string,
  sessionId: string,
  log: LogInterface,
): Promise<ScanResult> {
  if (!scanner) {
    return { blocked: false };
  }

  const start = Date.now();
  const metadata = buildMetadata();
  log.info(
    { promptLength: prompt.length, profileName: airsProfileName, metadata },
    "AIRS prompt scan starting",
  );

  let promptScan: ScanResponse | undefined;
  try {
    promptScan = await scanner.syncScan(
      { profile_name: airsProfileName },
      new Content({ prompt }),
      { sessionId, metadata },
    );
    log.info(
      { ...scanResultFields(promptScan), durationMs: Date.now() - start },
      "AIRS prompt scan complete",
    );
  } catch (err) {
    log.error(
      { ...scanErrorFields(err), durationMs: Date.now() - start },
      "AIRS prompt scan failed, proceeding unscanned",
    );
  }

  if (promptScan?.action === "block") {
    log.warn(
      { category: promptScan.category, scanId: promptScan.scan_id },
      "Request blocked by AIRS",
    );
    return {
      blocked: true,
      blockResponse: {
        error: "blocked",
        message: "Request blocked by Prisma AIRS security.",
        category: promptScan.category,
        scan_id: promptScan.scan_id,
      },
    };
  }

  return { blocked: false };
}

export async function postScan(
  prompt: string,
  responseBody: string,
  sessionId: string,
  log: LogInterface,
): Promise<ScanResult> {
  if (!scanner) {
    return { blocked: false };
  }

  const metadata = buildMetadata();
  log.info(
    {
      promptLength: prompt.length,
      responseLength: responseBody.length,
      profileName: airsProfileName,
      metadata,
    },
    "AIRS response scan starting",
  );

  let responseScan: ScanResponse | undefined;
  const responseScanStart = Date.now();
  try {
    responseScan = await scanner.syncScan(
      { profile_name: airsProfileName },
      new Content({ prompt, response: responseBody }),
      { sessionId, metadata },
    );
    log.info(
      { ...scanResultFields(responseScan), durationMs: Date.now() - responseScanStart },
      "AIRS response scan complete",
    );
  } catch (err) {
    log.error(
      { ...scanErrorFields(err), durationMs: Date.now() - responseScanStart },
      "AIRS response scan failed, proceeding unscanned",
    );
  }

  if (responseScan?.action === "block") {
    log.warn(
      { category: responseScan.category, scanId: responseScan.scan_id },
      "Response blocked by AIRS",
    );
    return {
      blocked: true,
      blockResponse: {
        error: "blocked",
        message: "Response blocked by Prisma AIRS security.",
        category: responseScan.category,
        scan_id: responseScan.scan_id,
      },
    };
  }

  return { blocked: false };
}
