#!/usr/bin/env node
/**
 * Build every gaiZao feature bundle consumed by the dsh plugin loader.
 *
 *   node gaiZao/scripts/build-features.mjs [feature-id...]
 *
 * For each gaiZao/features/<id> it emits:
 *   index.js   Node half (ESM plugin module), when src/index.ts exists
 *   client.js  browser half (module-loader factory), when src/client/index.ts exists
 *
 * The browser half follows the official dynamic client contract:
 *   window.__ModuleLoader__.load({ id, factory: (require) => ({ apply, inject }) })
 * React and react/jsx-runtime arrive through the factory require (module table).
 * All other code is inlined; CSS Modules are hashed and injected at factory run.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const featuresRoot = path.join(repoRoot, 'gaiZao', 'features');
const uiDir = path.join(featuresRoot, 'velagent-ui');
const esbuildEntry = path.join(uiDir, 'node_modules', 'esbuild', 'lib', 'main.js');
const { build } = await import(pathToFileURL(esbuildEntry).href);

/** CSS Modules: hash class names, inject one style tag, export the class map. */
const cssModules = {
  name: 'velagent-css-modules',
  setup(builder) {
    builder.onResolve({ filter: /\.module\.css$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path),
      namespace: 'velagent-css',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'velagent-css' }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const hash = createHash('sha1').update(source + args.path).digest('hex').slice(0, 6);
      const classes = {};
      const css = source.replace(/(^|[\s,{>+~])\.([A-Za-z_][\w-]*)/g, (match, lead, name) => {
        const hashed = name + '_' + hash;
        classes[name] = hashed;
        return lead + '.' + hashed;
      });
      const js = [
        'const css = ' + JSON.stringify(css) + ';',
        'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-velagent-css]\') === null) {',
        '  const tag = document.createElement(\'style\');',
        '  tag.dataset.velagentCss = \'gaiZao\';',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        'export default ' + JSON.stringify(classes) + ';',
      ].join('\n');
      return { contents: js, loader: 'js' };
    });
  },
};

const requested = process.argv.slice(2);
const ids = requested.length > 0
  ? requested
  : readdirSync(featuresRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(featuresRoot, entry.name, 'package.json')))
      .map((entry) => entry.name);

for (const id of ids) {
  const featureDir = path.join(featuresRoot, id);
  const manifestPath = path.join(featureDir, 'package.json');
  if (!existsSync(manifestPath)) { console.warn('skip ' + id + ': no package.json'); continue; }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.dsh === undefined || manifest.dsh.bundle === undefined) { continue; }
  const hostEntry = path.join(featureDir, 'src', 'index.ts');
  const clientEntryTs = path.join(featureDir, 'src', 'client', 'index.ts');
  const clientEntryTsx = path.join(featureDir, 'src', 'client', 'index.tsx');
  const clientEntry = existsSync(clientEntryTs) ? clientEntryTs : clientEntryTsx;

  if (existsSync(hostEntry)) {
    await build({
      absWorkingDir: featureDir,
      entryPoints: [hostEntry],
      outfile: path.join(featureDir, 'index.js'),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      packages: 'external',
      logLevel: 'warning',
    });
  }
  if (existsSync(clientEntry)) {
    const clientTmp = path.join(featureDir, '.client.bundle.cjs');
    await build({
      absWorkingDir: featureDir,
      entryPoints: [clientEntry],
      outfile: clientTmp,
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      loader: { '.png': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [cssModules],
      logLevel: 'warning',
    });
    const code = readFileSync(clientTmp, 'utf8');
    const wrapped = [
      '// ' + manifest.name + ' browser half: official dynamic client module-loader factory.',
      'window.__ModuleLoader__.load({',
      '  id: ' + JSON.stringify(manifest.name) + ',',
      '  factory: (require) => {',
      '    const module = { exports: {} };',
      '    const exports = module.exports;',
      '    (function (module, exports, require) {',
      code,
      '    })(module, exports, require);',
      '    return module.exports;',
      '  },',
      '});',
    ].join('\n');
    writeFileSync(path.join(featureDir, 'client.js'), wrapped);
    writeFileSync(clientTmp, '');
  }
  const indexBytes = existsSync(path.join(featureDir, 'index.js')) ? readFileSync(path.join(featureDir, 'index.js')).length : 0;
  const clientBytes = existsSync(path.join(featureDir, 'client.js')) ? readFileSync(path.join(featureDir, 'client.js')).length : 0;
  console.log('built ' + id + ': index.js ' + indexBytes + ' B, client.js ' + clientBytes + ' B');
}
