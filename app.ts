import sourceMapSupport from 'source-map-support';

import Homey from 'homey';

sourceMapSupport.install();

// NOTE: Homey expects CommonJS export for App/Driver/Device classes.
// Avoid `export default` for runtime compatibility.
export = class App extends Homey.App {
  async onInit() {
    this.log('Flexit Nordic app init');

    process.on('uncaughtException', (err) => {
      this.error('Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, _promise) => {
      this.error('Unhandled Rejection:', reason);
    });
  }
};
