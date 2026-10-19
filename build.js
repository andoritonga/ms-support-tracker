const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const TEMPLATES_DIR = path.join(ROOT_DIR, 'templates');
const STATIC_DIR = path.join(ROOT_DIR, 'static');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

function cleanAndBuild() {
  console.log('🚀 Building static assets for Cloudflare Workers / Pages...');

  // 1. Ensure public directory exists
  if (fs.existsSync(PUBLIC_DIR)) {
    fs.rmSync(PUBLIC_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  // 2. Assemble index.html from templates and partials
  const indexPath = path.join(TEMPLATES_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error('❌ templates/index.html not found!');
    process.exit(1);
  }

  let indexHtml = fs.readFileSync(indexPath, 'utf-8');

  // Replace {% include "partials/..." %} with partial file contents
  const includeRegex = /\{%\s*include\s*["']([^"']+)["']\s*%\}/g;
  indexHtml = indexHtml.replace(includeRegex, (match, partialRelPath) => {
    const partialPath = path.join(TEMPLATES_DIR, partialRelPath);
    if (fs.existsSync(partialPath)) {
      console.log(`  ✓ Included ${partialRelPath}`);
      return fs.readFileSync(partialPath, 'utf-8');
    } else {
      console.warn(`  ⚠️ Warning: partial not found: ${partialPath}`);
      return `<!-- Missing partial: ${partialRelPath} -->`;
    }
  });

  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), indexHtml, 'utf-8');
  console.log('✅ Generated public/index.html');

  // 3. Copy static folder
  const publicStaticDir = path.join(PUBLIC_DIR, 'static');
  if (fs.existsSync(STATIC_DIR)) {
    fs.cpSync(STATIC_DIR, publicStaticDir, { recursive: true });
    console.log('✅ Copied static/ -> public/static/');
  }

  // 4. Copy root assets (manifest.json, sw.js, favicon.ico) for top-level paths
  const rootFiles = ['manifest.json', 'sw.js', 'favicon.ico', 'favicon.png'];
  for (const file of rootFiles) {
    const srcFile = path.join(STATIC_DIR, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(PUBLIC_DIR, file));
      console.log(`✅ Copied static/${file} -> public/${file}`);
    }
  }

  console.log('🎉 Static build completed successfully in ./public');
}

cleanAndBuild();
