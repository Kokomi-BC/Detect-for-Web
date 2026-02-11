// 自动为脚本中的顶层函数和变量添加 window 挂载，以支持 renameGlobals: true 后的 HTML onclick 调用
const fs = require('fs');
const path = require('path');

const files = [
    'client-src/js/admin.js',
    'client-src/js/mobile.js',
    'client-src/js/theme-loader.js'
];

files.forEach(fileRelPath => {
    const filePath = path.join(process.cwd(), fileRelPath);
    if (!fs.existsSync(filePath)) return;
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // 匹配常规函数定义: function name(...) {
    const funcRegex = /^function\s+([a-zA-Z0-9_$]+)\s*\(/gm;
    let match;
    const exports = [];
    
    while ((match = funcRegex.exec(content)) !== null) {
        exports.push(match[1]);
    }
    
    // 匹配异步函数定义: async function name(...) {
    const asyncFuncRegex = /^async\s+function\s+([a-zA-Z0-9_$]+)\s*\(/gm;
    while ((match = asyncFuncRegex.exec(content)) !== null) {
        exports.push(match[1]);
    }

    if (exports.length > 0) {
        content += '\n\n// --- Build-time Global Exports ---\n';
        const uniqueExports = [...new Set(exports)];
        uniqueExports.forEach(name => {
            content += `window['${name}'] = ${name};\n`;
        });
        fs.writeFileSync(filePath, content);
        console.log(`Exported ${uniqueExports.length} globals in ${fileRelPath}`);
    }
});
