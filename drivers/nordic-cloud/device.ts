import {
  Registry,
  FlexitDevice,
} from '../../lib/UnitRegistry';
import { FlexitNordicBaseDevice } from '../../lib/FlexitNordicBaseDevice';
import { FlexitCloudClient, AuthenticationError, CloudToken } from '../../lib/flexitCloudClient';

export = class FlexitNordicCloudDevice extends FlexitNordicBaseDevice {
  protected getLogBindings() {
    const data = this.getData();
    return {
      ...super.getLogBindings(),
      transport: 'cloud',
      plantId: data.plantId,
    };
  }

  async onInit() {
    this.getLogger().info('device.init', 'Cloud device initialized');
    await this.initSharedCapabilities();

    const { unitId, plantId } = this.getData();

    const client = new FlexitCloudClient({
      logger: this.getLogger().child({ scope: 'cloud_client' }),
    });
    const storedToken = await this.restoreCloudToken(client);
    if (!storedToken) return;

    let activeClient: FlexitCloudClient;
    try {
      activeClient = Registry.registerCloud(unitId, this as unknown as FlexitDevice, {
        plantId,
        client,
      });
    } catch (e) {
      if (e instanceof AuthenticationError) {
        this.getLogger().error(
          'device.cloud_auth.failed',
          'Cloud authentication failed during device initialization',
          e,
        );
        await this.setUnavailable(
          'Cloud authentication failed. Please repair the device.',
        );
        return;
      }
      this.getLogger().error(
        'device.registry.register.failed',
        'Failed to register cloud device with registry',
        e,
      );
      await this.setUnavailable('Failed to initialize cloud connection.');
      return;
    }

    activeClient.onTokenRefreshed((token: CloudToken) => {
      this.persistCloudToken(token);
    });

    this.registerSharedCapabilityListeners(unitId);
  }

  private async restoreCloudToken(client: FlexitCloudClient): Promise<CloudToken | null> {
    const refreshToken = this.getStoreValue('cloudRefreshToken') as string | null;
    const accessToken = this.getStoreValue('cloudAccessToken') as string | null;
    const expiresAt = this.getStoreValue('cloudTokenExpiresAt') as number | null;

    if (!refreshToken) {
      this.getLogger().error(
        'device.token_restore.missing_refresh_token',
        'Cloud refresh token was not found in device store',
      );
      await this.setUnavailable('Cloud credentials missing. Please repair the device.');
      return null;
    }

    const token: CloudToken = {
      accessToken: accessToken ?? '',
      refreshToken,
      expiresAt: expiresAt ?? 0,
    };
    client.restoreToken(token);
    return token;
  }

  private persistCloudToken(token: CloudToken) {
    this.setStoreValue('cloudAccessToken', token.accessToken).catch((err) => {
      this.getLogger().error(
        'device.token_persist.access.failed',
        'Failed to persist cloud access token',
        err,
      );
    });
    if (token.refreshToken) {
      this.setStoreValue('cloudRefreshToken', token.refreshToken).catch((err) => {
        this.getLogger().error(
          'device.token_persist.refresh.failed',
          'Failed to persist cloud refresh token',
          err,
        );
      });
    }
    this.setStoreValue('cloudTokenExpiresAt', token.expiresAt).catch((err) => {
      this.getLogger().error(
        'device.token_persist.expiry.failed',
        'Failed to persist cloud token expiry',
        err,
      );
    });
  }
};
