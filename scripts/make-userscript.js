var fs = require('fs');
var bundle = fs.readFileSync('dist/index.js', 'utf8');
var css = fs.readFileSync('packages/scripts/assets/css/style.css', 'utf8');
var entry = fs.readFileSync('packages/scripts/entry.js', 'utf8');
var st = 'var STYLE = `' + css.replace(/\/g, '\\').replace(/`/g, '\`').replace(/\$/g, '\$') + '`;\n\n';
var head = '// ==UserScript==\n// @name         OCS (LLM)\n// @version      4.14.0\n// @description  OCS+LLM\n// @author       ocsjs\n// @license      MIT\n// @namespace    https://docs.ocsjs.com\n// @homepage     https://docs.ocsjs.com\n// @connect      *\n// @match        *://*.chaoxing.com/*\n// @match        *://*.zhihuishu.com/*\n// @match        *://*.icve.com.cn/*\n// @match        *://*.icourse163.org/*\n// @match        *://*.yuketang.cn/*\n// @match        *://*.unipus.cn/*\n// @grant        GM_info\n// @grant        GM_getTab\n// @grant        GM_saveTab\n// @grant        GM_setValue\n// @grant        GM_getValue\n// @grant        unsafeWindow\n// @grant        GM_listValues\n// @grant        GM_deleteValue\n// @grant        GM_notification\n// @grant        GM_xmlhttpRequest\n// @grant        GM_getResourceText\n// @grant        GM_addValueChangeListener\n// @grant        GM_removeValueChangeListener\n// @run-at       document-start\n// ==/UserScript==\n';
var out = head + '\n' + st + bundle + '\n' + entry;
fs.writeFileSync('dist/ocs-llm.user.js', out);
console.log('Written, size:', Math.round(out.length/1024), 'KB');
