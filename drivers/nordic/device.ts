import {
  Registry,
  FlexitDevice,
} from '../../lib/UnitRegistry';
import { FlexitNordicBaseDevice } from '../../lib/FlexitNordicBaseDevice';

const CONNECTION_LABEL_SETTING_KEYS = ['ip', 'bacnetPort', 'serial', 'mac'] as const;
const CAPABILITY_OPERATION_WARNING_MS = 5_000;

export = class FlexitNordicDevice extends FlexitNordicBaseDevice {
  protected getLogBindings() {
    return {
      ...super.getLogBindings(),
      transport: 'bacnet',
    };
  }

  async onInit() {
    this.getLogger().info('device.init', 'BACnet device initialized');
    await this.initSharedCapabilities();
    await this.normalizeConnectionLabelSettings();

    const { unitId } = this.getData();
    try {
      Registry.register(unitId, this as unknown as FlexitDevice);
    } catch (e) {
      this.getLogger().error('device.registry.register.failed', 'Failed to register BACnet device with registry', e);
    }

    this.registerSharedCapabilityListeners(unitId);
  }

  protected async runCapabilityAction<T>(
    capability: string,
    unitId: string,
    actionDescription: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    let warningLogged = false;
    const warningTimer = setTimeout(() => {
      warningLogged = true;
      this.getLogger().error(
        'device.capability.slow',
        'BACnet capability action is still pending',
        undefined,
        { capability, actionDescription, elapsedMs: Date.now() - startedAt, unitId },
      );
    }, CAPABILITY_OPERATION_WARNING_MS);

    try {
      const result = await action();
      const elapsedMs = Date.now() - startedAt;
      if (!warningLogged && elapsedMs >= CAPABILITY_OPERATION_WARNING_MS) {
        warningLogged = true;
        this.getLogger().error(
          'device.capability.slow',
          'BACnet capability action exceeded the warning threshold before completion',
          undefined,
          { capability, actionDescription, elapsedMs, unitId },
        );
      }
      if (warningLogged) {
        this.getLogger().info(
          'device.capability.completed_after_warning',
          'BACnet capability action completed after a slow-operation warning',
          { capability, actionDescription, elapsedMs, unitId },
        );
      }
      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const surfacedError = this.buildCapabilityOperationError(
        unitId, actionDescription, error,
      );
      this.getLogger().error(
        'device.capability.failed',
        'BACnet capability action failed',
        error,
        { capability, actionDescription, elapsedMs, unitId, surfacedError: surfacedError.message },
      );
      throw surfacedError;
    } finally {
      clearTimeout(warningTimer);
    }
  }

  private buildCapabilityOperationError(
    unitId: string,
    actionDescription: string,
    error: unknown,
  ): Error {
    const deviceLabel = this.getCapabilityOperationDeviceLabel(unitId);
    if (this.isTimeoutError(error)) {
      return new Error(
        `Timed out ${actionDescription} for ${deviceLabel};`
        + ' the BACnet unit did not respond in time.',
      );
    }

    const detail = this.describeCapabilityOperationError(error);
    return new Error(`Failed ${actionDescription} for ${deviceLabel}: ${detail}`);
  }

  private getCapabilityOperationDeviceLabel(unitId: string) {
    const ip = this.getSetting('ip');
    const ipLabel = typeof ip === 'string' && ip.length > 0 ? `, ip ${ip}` : '';
    return `${this.getName()} (unit ${unitId}${ipLabel})`;
  }

  private isTimeoutError(error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    const message = this.describeCapabilityOperationError(error);
    return code === 'ERR_TIMEOUT' || /\btimeout\b/i.test(message);
  }

  private describeCapabilityOperationError(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (typeof error === 'number' || typeof error === 'boolean' || error == null) {
      return String(error);
    }
    if (typeof error === 'object') {
      const message = 'message' in error
        && typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message?: unknown }).message)
        : '';
      if (message) return message;
      try {
        return JSON.stringify(error);
      } catch (_jsonError) {
        return Object.prototype.toString.call(error);
      }
    }
    return String(error);
  }

  private async normalizeConnectionLabelSettings() {
    const updates: Record<string, string> = {};
    for (const key of CONNECTION_LABEL_SETTING_KEYS) {
      const value = this.getSetting(key);
      if (typeof value === 'string') continue;
      if (value === null || value === undefined) continue;
      updates[key] = String(value);
    }
    if (Object.keys(updates).length === 0) return;

    try {
      await this.setSettings(updates);
      this.getLogger().info(
        'device.settings.legacy_connection_normalized',
        'Normalized legacy BACnet connection settings',
        { updates },
      );
    } catch (error) {
      this.getLogger().error(
        'device.settings.legacy_connection_normalize.failed',
        'Failed to normalize legacy BACnet connection settings',
        error,
        { updates },
      );
    }
  }
};
