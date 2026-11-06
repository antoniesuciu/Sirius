// The app shares packages/contracts and packages/client as source. Every dependency, theirs
// included, resolves from this app's node_modules, so there is one React and one React Query.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = ['packages/contracts', 'packages/client', 'packages/ui/src/avatar'].map((p) =>
  path.join(root, p),
);
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  '@sirius/contracts': path.join(root, 'packages/contracts'),
  '@sirius/client': path.join(root, 'packages/client'),
};
module.exports = config;
