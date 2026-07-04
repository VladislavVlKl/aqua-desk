#!/usr/bin/env node
// Прод-сборка AquaDesk (вызывается из .github/workflows/deploy.yml и локально для проверки).
//
//   node scripts/build.js [выходная_папка]   # по умолчанию _site
//
// Что делает:
//   1. Копирует frontend/ в выходную папку (как прежний rsync).
//   2. Склеивает локальные js/*.js СТРОГО в порядке подключения из index.html
//      (порядок критичен — см. ARCHITECTURE.md) и минифицирует esbuild-ом.
//      БЕЗ переименования идентификаторов: inline-обработчики onclick="doLogWorkout()"
//      ссылаются на имена функций строками, переименование сломало бы приложение.
//   3. То же с css/*.css.
//   4. Пишет dist/app-<hash>.js|css (хэш содержимого = вечный кеш без ручного ?v=)
//      и переписывает index.html выходной папки на бандл.
//
// Исходники в репо не меняются; локальная разработка живёт на отдельных файлах.
// Откат: убрать шаг сборки из deploy.yml — index.html в репо по-прежнему рабочий.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'frontend');
const OUT  = path.resolve(process.argv[2] || path.join(ROOT, '_site'));
const ESBUILD = 'npx --yes esbuild@0.25.5'; // версия зафиксирована для воспроизводимости

function die(msg) { console.error('BUILD FAIL: ' + msg); process.exit(1); }

// 1. Копия сайта
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

// 2. Собираем списки локальных подключений в порядке появления
const jsFiles  = [...html.matchAll(/<script src="(js\/[^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(m => m[1]);
const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="(css\/[^"?]+)(?:\?[^"]*)?">/g)].map(m => m[1]);
if (jsFiles.length < 10) die('найдено подозрительно мало js-файлов: ' + jsFiles.length);
for (const f of [...jsFiles, ...cssFiles])
  if (!fs.existsSync(path.join(SRC, f))) die('файл из index.html не найден: ' + f);

const distDir = path.join(OUT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const tmp = p => path.join(distDir, p);

function bundle(files, ext) {
  const concat = files.map(f =>
    `/* ── ${f} ── */\n` + fs.readFileSync(path.join(SRC, f), 'utf8')
  ).join('\n;\n');
  fs.writeFileSync(tmp('_concat.' + ext), ext === 'css' ? concat.replace(/\n;\n/g, '\n') : concat);
  execSync(`${ESBUILD} ${tmp('_concat.' + ext)} --minify-whitespace --minify-syntax --outfile=${tmp('_min.' + ext)}`,
           { stdio: 'inherit', cwd: ROOT });
  const code = fs.readFileSync(tmp('_min.' + ext));
  const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
  const name = `app-${hash}.${ext}`;
  fs.writeFileSync(path.join(distDir, name), code);
  fs.unlinkSync(tmp('_concat.' + ext));
  fs.unlinkSync(tmp('_min.' + ext));
  return name;
}

const jsName  = bundle(jsFiles, 'js');
const cssName = bundle(cssFiles, 'css');

// 3. Переписываем index.html выходной папки: первый локальный тег → бандл, остальные — убрать
let first = true;
html = html.replace(/[ \t]*<script src="js\/[^"]+"><\/script>\r?\n?/g, m => {
  if (first) { first = false; return `  <script src="dist/${jsName}"></script>\n`; }
  return '';
});
first = true;
html = html.replace(/[ \t]*<link rel="stylesheet" href="css\/[^"]+">\r?\n?/g, m => {
  if (first) { first = false; return `  <link rel="stylesheet" href="dist/${cssName}">\n`; }
  return '';
});
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// 4. Контроль: бандл синтаксически валиден и ключевые глобальные имена на месте
execSync(`node --check ${path.join(distDir, jsName)}`, { stdio: 'inherit' });
const bundled = fs.readFileSync(path.join(distDir, jsName), 'utf8');
for (const name of ['doLogWorkout', 'renderPinEntry', 'calcSalary', 'monthFirstDayStr', 'CONFIG'])
  if (!bundled.includes(name)) die('в бандле пропало имя: ' + name);

const kb = n => Math.round(fs.statSync(n).size / 1024) + ' KB';
console.log(`OK: ${jsFiles.length} js → dist/${jsName} (${kb(path.join(distDir, jsName))}), ` +
            `${cssFiles.length} css → dist/${cssName} (${kb(path.join(distDir, cssName))})`);
