export const DATA_PLANE_SCOPE = 'https://dynamicsessions.io/.default';
export const DATA_PLANE_BASE = 'https://management.azuredevcompute.io';
export const ARM_SCOPE = 'https://management.azure.com/.default';
export const ARM_BASE = 'https://management.azure.com';
export const DEFAULT_API_VERSION = '2026-02-01-preview';

export enum ApiVersion {
  V2026_02_01_PREVIEW = '2026-02-01-preview',
}

export function endpointForRegion(region: string): string {
  if (!region || /[/:\\\s]/.test(region)) {
    throw new Error("region must be a non-empty Azure region name, such as 'eastus2'.");
  }
  return `https://management.${region}.azuredevcompute.io`;
}

export function regionFromEndpoint(endpoint: string): string | undefined {
  return /^https:\/\/management\.([^.]+)\.azuredevcompute\.io\/?$/i.exec(endpoint)?.[1];
}
