const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// Garden mobile screens are re-exported by route files in this project
const gardenMobile = path.resolve(projectRoot, '../../garden/mobile');

const config = getDefaultConfig(projectRoot);

// Watch garden mobile source so Metro tracks changes to re-exported screens
config.watchFolders = [gardenMobile];

// All module lookups (including from garden mobile files) resolve through
// base mobile's node_modules — it is the single source of installed packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Proxy fallback: any module not found by traversal resolves here too
config.resolver.extraNodeModules = new Proxy(
  {},
  { get: (_t, name) => path.join(projectRoot, 'node_modules', name.toString()) },
);

module.exports = config;
