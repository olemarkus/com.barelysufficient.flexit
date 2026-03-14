import Homey from 'homey';
import { FlexitCloudClient, CloudToken } from '../../lib/flexitCloudClient';

export = class FlexitNordicCloudDriver extends Homey.Driver {
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
};
