import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 比照原本 showdown 的 openLinksInNewWindow：消毒後把連結一律開新分頁
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function htmlConverter(msg) {
  msg = msg === null || msg === undefined ? '**test**' : msg;
  return DOMPurify.sanitize(marked.parse(msg, { async: false, gfm: true }), {
    ADD_ATTR: ['target'],
  });
}
