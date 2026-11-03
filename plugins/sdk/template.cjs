// Called by your application's extension activation hook. No polling or global shortcuts.
const {startPlugin} = require('./sdk/index.cjs');
const manifest = require('./beaconhop.plugin.json');
exports.connect = async function connect(application) {
  return startPlugin({
    manifest,
    // IDs must identify exact windows/items, never just their titles or filenames.
    list: ({signal}) => application.listContexts({signal}),
    activate: async (target, {signal}) => {
      await application.selectItem(target.context, target.item, {signal});
      if (signal.aborted) throw Error('Activation cancelled');
      const selected = await application.selectedItem({signal});
      if (selected.context !== target.context || selected.item !== target.item) throw Error('Selection could not be verified');
      return {...target, verified:true};
    },
    onError: error => application.log?.(error.message),
  });
};
// Retain the returned connection and await connection.dispose() in deactivation.
// Use the host application's event loop; the SDK does not keep standalone scripts alive.
