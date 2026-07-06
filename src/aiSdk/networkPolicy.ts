import { HarnessCapabilityUnsupportedError, type HarnessV1NetworkPolicy } from '@ai-sdk/harness';

import type { EgressPolicy } from '../types.js';
import { ACA_PROVIDER_ID } from './util.js';

export function toAcaEgressPolicy(policy: HarnessV1NetworkPolicy): EgressPolicy {
  switch (policy.mode) {
    case 'allow-all':
      return { defaultAction: 'Allow' };
    case 'deny-all':
      return { defaultAction: 'Deny' };
    case 'custom': {
      const { allowedCIDRs, allowedHosts, deniedCIDRs } = policy;

      if ((allowedCIDRs?.length ?? 0) > 0 || (deniedCIDRs?.length ?? 0) > 0) {
        throw new HarnessCapabilityUnsupportedError({
          harnessId: ACA_PROVIDER_ID,
          message: 'ACA sandbox network policy mapping currently supports host allow-lists only.',
        });
      }

      if (allowedHosts == null || allowedHosts.length === 0) {
        throw new HarnessCapabilityUnsupportedError({
          harnessId: ACA_PROVIDER_ID,
          message: 'Custom network policy requires at least one allowed host.',
        });
      }
      return {
        defaultAction: 'Deny',
        hostRules: allowedHosts.map((pattern) => ({ pattern, action: 'Allow' })),
      };
    }
  }
}
