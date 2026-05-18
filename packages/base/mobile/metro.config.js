const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// Monorepo root — Metro must watch garden mobile files referenced by re-export routes
const monorepoRoot = path.resolve(projectRoot, '../../..');

const config = getDefaultConfig(projectRoot);

// Watch files outside the project root (garden mobile screens)
config.watchFolders = [monorepoRoot];

// When resolving modules from files outside projectRoot, look in base mobile's
// node_modules first so react, react-native, expo-router etc. are always found
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

module.exports = config;
