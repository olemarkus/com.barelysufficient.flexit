import Homey from 'homey';
import { FlexitCloudClient, CloudToken } from '../../lib/flexitCloudClient';
import { Registry } from '../../lib/UnitRegistry';

export = class FlexitNordicCloudDriver extends Homey.Driver {
  private resolveRepairToken(device: any, token: CloudToken): CloudToken {
    if (token.refreshToken) {
      return token;
    }

    const storedRefreshToken = device.getStoreValue('cloudRefreshToken') as string | null;
    if (!storedRefreshToken) {
      throw new Error('Authentication succeeded, but no refresh token is available for this device.');
    }

    return {
      ...token,
      refreshToken: storedRefreshToken,
    };
  }

  async onInit() {
    const appVersion = this.homey?.manifest?.version ?? this.manifest?.version ?? 'unknown';
    this.log(`Flexit Nordic Cloud driver init (app v${appVersion})`);
  }

  async onPair(session: any) {
    let pairedToken: CloudToken | null = null;

    session.setHandler(
      'login',
      async (data: { username: string; password: string }) => {
        const client = new FlexitCloudClient();
        try {
          pairedToken = await client.authenticateWithPassword(
            data.username,
            data.password,
          );
          return true;
        } catch (err) {
          this.error('[Pair] Cloud authentication failed:', err);
          throw new Error('Authentication failed. Check your credentials.');
        }
      },
    );

    session.setHandler('list_devices', async () => {
      if (!pairedToken) {
        throw new Error('Not authenticated. Please log in first.');
      }
      const token = pairedToken;

      const client = new FlexitCloudClient();
      client.restoreToken(token);
      const plants = await client.findPlants();

      this.log(`[Pair] Found ${plants.length} plant(s) in Flexit cloud`);

      return plants.map((plant) => ({
        name: plant.name || `Flexit ${plant.serialNumber || plant.id}`,
        data: {
          id: plant.id,
          unitId: plant.id,
          plantId: plant.id,
        },
        settings: {
          plantId: plant.id,
        },
        store: {
          cloudAccessToken: token.accessToken,
          cloudRefreshToken: token.refreshToken,
          cloudTokenExpiresAt: token.expiresAt,
        },
      }));
    });
  }

  async onRepair(session: any, device: any) {
    session.setHandler(
      'login',
      async (data: { username: string; password: string }) => {
        const client = new FlexitCloudClient();
        let token: CloudToken;
        try {
          token = await client.authenticateWithPassword(
            data.username,
            data.password,
          );
        } catch (err) {
          this.error('[Repair] Cloud authentication failed:', err);
          throw new Error('Authentication failed. Check your credentials.');
        }

        const { unitId, plantId } = device.getData();
        const isRegistered = Registry.hasCloudUnit(unitId);
        const repairedToken = isRegistered ? token : this.resolveRepairToken(device, token);

        await device.setStoreValue('cloudAccessToken', token.accessToken);
        if (token.refreshToken) {
          await device.setStoreValue('cloudRefreshToken', token.refreshToken);
        }
        await device.setStoreValue('cloudTokenExpiresAt', token.expiresAt);

        if (isRegistered) {
          Registry.restoreCloudAuth(unitId, token);
        } else {
          this.log(`[Repair] Unit ${unitId} not in registry, registering`);
          const repairClient = new FlexitCloudClient();
          repairClient.restoreToken(repairedToken);
          const activeClient = Registry.registerCloud(unitId, device, { plantId, client: repairClient });
          activeClient.onTokenRefreshed((t: CloudToken) => {
            device.setStoreValue('cloudAccessToken', t.accessToken).catch((err: any) => {
              this.error('[Repair] Failed to persist cloud access token:', err);
            });
            if (t.refreshToken) {
              device.setStoreValue('cloudRefreshToken', t.refreshToken).catch((err: any) => {
                this.error('[Repair] Failed to persist cloud refresh token:', err);
              });
            }
            device.setStoreValue('cloudTokenExpiresAt', t.expiresAt).catch((err: any) => {
              this.error('[Repair] Failed to persist cloud token expiry:', err);
            });
          });
        }

        this.log(`[Repair] Successfully re-authenticated device ${unitId}`);
        return true;
      },
    );
  }
};
