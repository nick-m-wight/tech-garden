const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const gardenMobile = path.resolve(projectRoot, '../../garden/mobile');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [gardenMobile];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Metro 0.83.x walks into @types/react when resolving 'react' from user-space
// files (outside node_modules). @types/react has "main": "" so Metro throws
// InvalidPackageError (not caught, unlike PackagePathNotExportedError).
// Resolve runtime-only packages to their actual entry points to sidestep this.
const runtimeOverrides = {
  react: require.resolve('react', { paths: [projectRoot] }),
  'react-dom': require.resolve('react-dom', { paths: [projectRoot] }),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (Object.prototype.hasOwnProperty.call(runtimeOverrides, moduleName)) {
    return { type: 'sourceFile', filePath: runtimeOverrides[moduleName] };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
