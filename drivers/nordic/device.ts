import {
  Registry,
  FlexitDevice,
} from '../../lib/UnitRegistry';
import { FlexitNordicBaseDevice } from '../../lib/FlexitNordicBaseDevice';

const CONNECTION_LABEL_SETTING_KEYS = ['ip', 'bacnetPort', 'serial', 'mac'] as const;
const CAPABILITY_OPERATION_WARNING_MS = 5_000;

export = class FlexitNordicDevice extends FlexitNordicBaseDevice {
  async onInit() {
    this.log('Nordic device init', this.getName());
    await this.initSharedCapabilities();
    await this.normalizeConnectionLabelSettings();

    const { unitId } = this.getData();
    try {
      Registry.register(unitId, this as unknown as FlexitDevice);
    } catch (e) {
      this.error('Failed to register with Registry:', e);
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
      this.error(
        `Capability '${capability}' ${actionDescription} is still pending after ${Date.now() - startedAt}ms`
        + ` for unit ${unitId}; external callers may time out before the BACnet write completes.`,
      );
    }, CAPABILITY_OPERATION_WARNING_MS);

    try {
      const result = await action();
      const elapsedMs = Date.now() - startedAt;
      if (!warningLogged && elapsedMs >= CAPABILITY_OPERATION_WARNING_MS) {
        warningLogged = true;
        this.error(
          `Capability '${capability}' ${actionDescription} is still pending after ${elapsedMs}ms`
          + ` for unit ${unitId}; external callers may time out before the BACnet write completes.`,
        );
      }
      if (warningLogged) {
        this.log(
          `Capability '${capability}' ${actionDescription} completed after ${elapsedMs}ms`
          + ` for unit ${unitId}`,
        );
      }
      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const surfacedError = this.buildCapabilityOperationError(
        unitId, actionDescription, error,
      );
      this.error(
        `Capability '${capability}' ${actionDescription} failed after ${elapsedMs}ms`
        + ` for unit ${unitId}; returning error: ${surfacedError.message}`,
        error,
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
      this.log('Normalized legacy connection settings:', updates);
    } catch (error) {
      this.error('Failed to normalize legacy connection settings:', error, updates);
    }
  }
};
