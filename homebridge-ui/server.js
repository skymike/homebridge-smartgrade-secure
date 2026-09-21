const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const { SetupController } = require('../dist/ui.js');
const { CloudError } = require('../dist/protocol.js');
class Server extends HomebridgePluginUiServer {
  constructor() {
    super();
    const controller = new SetupController(this.homebridgeStoragePath, this.homebridgeConfigPath);
    const handle = fn => async payload => {
      try { return await fn(payload); }
      catch (error) { throw new RequestError(error instanceof CloudError ? error.message : 'Setup failed. Check the private bootstrap file and try again.', { code: error instanceof CloudError ? error.code : 'SETUP' }); }
    };
    this.onRequest('/status', handle(() => controller.status()));
    this.onRequest('/request-code', handle(p => controller.requestCode(p?.phone)));
    this.onRequest('/verify-code', handle(p => controller.verify(p?.code)));
    this.onRequest('/discover', handle(() => controller.discover()));
    process.on('disconnect', () => controller.close());
    this.ready();
  }
}
new Server();
