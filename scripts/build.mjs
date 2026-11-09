/**
 * dist を作り直す（CommonJS の JavaScript と型定義）。
 *   npm run build            → dist へ出力
 *   node scripts/build.mjs <出力先>  → 指定したフォルダへ出力
 */
import {execFileSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(packageRoot, process.argv[2] ?? 'dist');

rmSync(outDir, {recursive: true, force: true});
execFileSync(
    resolve(packageRoot, 'node_modules/.bin/tsc'),
    ['-p', resolve(packageRoot, 'tsconfig.build.json'), '--outDir', outDir],
    {stdio: 'inherit'}
);
