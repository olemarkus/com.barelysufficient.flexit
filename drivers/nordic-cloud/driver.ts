import Homey from 'homey';
import { FlexitCloudClient, CloudToken } from '../../lib/flexitCloudClient';
import { Registry } from '../../lib/UnitRegistry';
import { createRuntimeLogger, RuntimeLogger, runWithLogContext } from '../../lib/logging';

export = class FlexitNordicCloudDriver extends Homey.Driver {
  private runtimeLogger?: RuntimeLogger;

  private getLogger() {
    if (!this.runtimeLogger) {
      this.runtimeLogger = createRuntimeLogger(this, {
        component: 'driver',
        transport: 'cloud',
      });
    }
    return this.runtimeLogger;
  }

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
    this.getLogger().info('driver.init', 'Flexit Nordic cloud driver initialized', { appVersion });
  }

  async onPair(session: any) {
    let pairedToken: CloudToken | null = null;
    const logger = this.getLogger().child({ pairing: true });

    session.setHandler(
      'login',
      async (data: { username: string; password: string }) => {
        const client = new FlexitCloudClient({
          logger: logger.child({ component: 'cloud_client' }),
        });
        try {
          pairedToken = await runWithLogContext({ operation: 'pair-login' }, () => client.authenticateWithPassword(
            data.username,
            data.password,
          ));
          logger.info('driver.pair.login.succeeded', 'Cloud pairing authentication succeeded');
          return true;
        } catch (err) {
          logger.error(
            'driver.pair.login.failed',
            'Cloud pairing authentication failed',
            err,
          );
          throw new Error('Authentication failed. Check your credentials.');
        }
      },
    );

    session.setHandler('list_devices', async () => {
      if (!pairedToken) {
        throw new Error('Not authenticated. Please log in first.');
      }
      const token = pairedToken;

      const client = new FlexitCloudClient({
        logger: logger.child({ component: 'cloud_client' }),
      });
      client.restoreToken(token);
      const plants = await runWithLogContext({ operation: 'pair-list-devices' }, () => client.findPlants());

      logger.info('driver.pair.devices.listed', 'Listed cloud plants for pairing', {
        plantCount: plants.length,
        plants: plants.map((plant) => ({
          plantId: plant.id,
          name: plant.name,
          serialNumber: plant.serialNumber,
          isOnline: plant.isOnline,
        })),
      });

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
    const logger = this.getLogger().child({ repair: true });
    session.setHandler(
      'login',
      async (data: { username: string; password: string }) => {
        const client = new FlexitCloudClient({
          logger: logger.child({ component: 'cloud_client' }),
        });
        let token: CloudToken;
        try {
          token = await runWithLogContext({ operation: 'repair-login' }, () => client.authenticateWithPassword(
            data.username,
            data.password,
          ));
        } catch (err) {
          logger.error('driver.repair.login.failed', 'Cloud repair authentication failed', err);
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
          logger.info('driver.repair.registry.registering', 'Repairing cloud device by re-registering it', {
            unitId,
            plantId,
          });
          const repairClient = new FlexitCloudClient({
            logger: logger.child({ component: 'cloud_client', unitId, plantId }),
          });
          repairClient.restoreToken(repairedToken);
          const activeClient = Registry.registerCloud(unitId, device, { plantId, client: repairClient });
          activeClient.onTokenRefreshed((t: CloudToken) => {
            device.setStoreValue('cloudAccessToken', t.accessToken).catch((err: any) => {
              logger.error(
                'driver.repair.token_persist.access.failed',
                'Failed to persist repaired cloud access token',
                err,
                { unitId, plantId },
              );
            });
            if (t.refreshToken) {
              device.setStoreValue('cloudRefreshToken', t.refreshToken).catch((err: any) => {
                logger.error(
                  'driver.repair.token_persist.refresh.failed',
                  'Failed to persist repaired cloud refresh token',
                  err,
                  { unitId, plantId },
                );
              });
            }
            device.setStoreValue('cloudTokenExpiresAt', t.expiresAt).catch((err: any) => {
              logger.error(
                'driver.repair.token_persist.expiry.failed',
                'Failed to persist repaired cloud token expiry',
                err,
                { unitId, plantId },
              );
            });
          });
        }

        logger.info('driver.repair.login.succeeded', 'Cloud device repair authentication succeeded', {
          unitId,
          plantId,
          restoredExistingRegistration: isRegistered,
        });
        return true;
      },
    );
  }
};
