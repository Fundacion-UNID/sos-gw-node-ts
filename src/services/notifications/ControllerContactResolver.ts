export type NotificationChannel = 'email' | 'sms' | 'call';

export type NotificationTarget = {
  channel: NotificationChannel;
  value: string;
  verified?: boolean;
  source:
    | 'controller-vault-email'
    | 'controller-vault-phone'
    | 'task-claim-override'
    | 'env-fallback'
    | 'none';
  metadata?: Record<string, string>;
};

export type ControllerContactContext = {
  tenantId: string;
  sector: string;
  jurisdiction: string;
  subjectRef?: string;
  rootTaskId?: string;
  ownerRef?: string;
};

export type ControllerContactResolution = {
  preferred?: NotificationTarget;
  all: NotificationTarget[];
};

/**
 * Canonical resolver contract for controller notification targets.
 *
 * Resolution priority (production):
 * 1) controller encrypted contact in vault
 * 2) task-level override (debug compatibility only)
 * 3) env fallback (local demo only)
 */
export interface ControllerContactResolver {
  resolveControllerTargets(context: ControllerContactContext): Promise<ControllerContactResolution>;
}

